/**
 * PvpBrain v3 — нейросеть PVP, 1 266 000+ обучающих сценариев (766k + 500k v3.0.1)
 *
 * Архитектура: brain.js NeuralNetwork 12→24→18→12→7
 * Входной вектор (12 признаков):
 *   0  — dist (0-1, max=10)       1  — botHp (0-1)
 *   2  — tgtHp (0-1)              3  — hpDiff (0-1, 0.5=равны)
 *   4  — hunger (0-1)             5  — hasSword (0/1)
 *   6  — hasFood (0/1)            7  — hasHeal (0/1)
 *   8  — hasBuff (0/1)            9  — attackCd (0-1)
 *   10 — allies (0-1, max=5)      11 — enemies (0-1, max=5)
 * Выходной вектор (7 действий): attack retreat eat throwHeal throwPotion throwPerk strafe
 */

const log = require("electron-log");

let brain = null;
try { brain = require("brain.js"); }
catch { log.warn("[PvpBrain] brain.js не установлен — эвристика"); }

const path = require("path");
const fs   = require("fs");
const WEIGHTS_PATH = path.join(__dirname, "../../pvp-weights.json");

const SWORD_NAMES = ["wooden_sword","stone_sword","iron_sword","golden_sword","diamond_sword","netherite_sword","mace"];
const AXE_NAMES   = ["wooden_axe","stone_axe","iron_axe","golden_axe","diamond_axe","netherite_axe"];
const HEAL_NAMES  = ["healing","instant_health","regeneration"];
const BUFF_NAMES  = ["strength","speed","resistance","absorption"];
const FOOD_NAMES  = ["apple","golden_apple","enchanted_golden_apple","bread","cooked_beef","cooked_porkchop","cooked_chicken","cooked_mutton","cooked_rabbit","carrot","baked_potato","golden_carrot","mushroom_stew","cooked_salmon","cooked_cod"];

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function getBotFeatures(bot, target, teammates = []) {
  if (!bot?.entity || !target?.position) return null;
  const dist     = bot.entity.position.distanceTo(target.position);
  const heldItem = bot.heldItem;
  const items    = bot.inventory.items();
  const hasSword = heldItem ? (SWORD_NAMES.some(n => heldItem.name.includes(n)) || AXE_NAMES.some(n => heldItem.name.includes(n))) : false;
  const hasFood  = items.some(i => FOOD_NAMES.includes(i.name));
  const hasHeal  = items.some(i => HEAL_NAMES.some(k => i.name.toLowerCase().includes(k)));
  const hasBuff  = items.some(i => BUFF_NAMES.some(k => i.name.toLowerCase().includes(k)));
  const attackCd = heldItem ? clamp((Date.now() - (bot._lastAttackTime || 0)) / 620, 0, 1) : 1;
  const allies   = Object.values(bot.entities || {}).filter(e => e.position && e !== bot.entity && teammates.includes(e.username)).length;
  const enemies  = Object.values(bot.entities || {}).filter(e =>
    e.position && e !== bot.entity && !teammates.includes(e.username) &&
    (e.type === "player" || e.type === "mob") &&
    e.position.distanceTo(bot.entity.position) < 10
  ).length;
  return [
    clamp(dist / 10, 0, 1), clamp(bot.health / 20, 0, 1),
    clamp((target.health || 20) / 20, 0, 1),
    clamp((bot.health - (target.health || 20)) / 20 + 0.5, 0, 1),
    clamp((bot.food || 20) / 20, 0, 1),
    hasSword ? 1 : 0, hasFood ? 1 : 0, hasHeal ? 1 : 0, hasBuff ? 1 : 0,
    attackCd, clamp(allies / 5, 0, 1), clamp(enemies / 5, 0, 1),
  ];
}

// ─── Генератор обучающих данных (~10000 сценариев) ────────────────────────
function buildSeedData() {
  const data = [];

  // inp = [dist, botHp, tgtHp, hunger, sword, food, heal, buff, cd, ally, enemy]
  // out = [attack, retreat, eat, throwHeal, throwPotion, throwPerk, strafe]
  function s(inp, out) {
    const [dist, botHp, tgtHp, hunger, sword, food, heal, buff, cd, ally, enemy] = inp;
    const hpDiff = clamp((botHp - tgtHp) / 2 + 0.5, 0, 1);
    data.push({
      input:  [clamp(dist,0,1), clamp(botHp,0,1), clamp(tgtHp,0,1), hpDiff,
               clamp(hunger,0,1), sword?1:0, food?1:0, heal?1:0, buff?1:0,
               clamp(cd,0,1), clamp(ally,0,1), clamp(enemy,0,1)],
      output: out.map(v => clamp(v, 0, 1))
    });
  }

  // ═══════════════════════════════════════════════════════════════════
  // БЛОК 1: АТАКА (~2500 сценариев)
  // ═══════════════════════════════════════════════════════════════════

  // 1a. Основная атака — близко + кулдаун готов + меч
  for (const dist of [0.02,0.05,0.08,0.10,0.12,0.15,0.18,0.20,0.22,0.25]) {
    for (const bHp of [0.35,0.45,0.5,0.6,0.65,0.7,0.75,0.8,0.85,0.9,0.95,1.0]) {
      for (const tHp of [0.1,0.2,0.3,0.4,0.5,0.6,0.7,0.8,0.9,1.0]) {
        const finishing = tHp <= 0.15;
        const atk = finishing ? 1.0 : (dist <= 0.15 ? 0.97 : dist <= 0.25 ? 0.92 : 0.85);
        s([dist,bHp,tHp,0.9,1,0,0,0,1.0,0,0.1],[atk,0,0,0,0,0,dist>=0.2?0.1:0.03]);
        // с буфом — чуть агрессивнее
        s([dist,bHp,tHp,0.85,1,0,0,1,1.0,0,0.1],[atk,0,0,0,0,0.3,0]);
      }
    }
  }

  // 1b. Атака с союзниками — очень агрессивно
  for (const dist of [0.05,0.10,0.15,0.20,0.25]) {
    for (const bHp of [0.4,0.5,0.6,0.7,0.8]) {
      for (const ally of [0.2,0.4,0.6,0.8,1.0]) {
        s([dist,bHp,0.5,0.85,1,0,0,0,1.0,ally,0.2],[1.0,0,0,0,0,0,0]);
        s([dist,bHp,0.7,0.85,1,0,0,0,0.9,ally,0.3],[0.9,0,0,0,0,0,0.1]);
      }
    }
  }

  // 1c. Добивание — враг почти мёртв
  for (const dist of [0.02,0.05,0.08,0.10,0.12,0.15,0.18,0.20]) {
    for (const tHp of [0.01,0.03,0.05,0.07,0.08,0.10,0.12]) {
      for (const bHp of [0.15,0.25,0.35,0.5,0.65,0.8,0.9]) {
        s([dist,bHp,tHp,0.8,1,0,0,0,1.0,0,0.1],[1.0,0,0,0,0,0,0]);
      }
    }
  }

  // 1d. Атака без меча (кулак / топор)
  for (const dist of [0.05,0.10,0.15,0.20]) {
    for (const bHp of [0.5,0.65,0.8,0.9]) {
      s([dist,bHp,0.5,0.85,0,0,0,0,1.0,0,0.1],[0.6,0,0,0,0.2,0,0.4]);
      s([dist,bHp,0.6,0.85,0,0,0,1,1.0,0,0.1],[0.3,0,0,0,0.4,0,0.5]);
    }
  }

  // 1e. Кулдаун почти готов (0.75-0.95) — продолжаем сближаться/стрейфить
  for (const dist of [0.05,0.10,0.15,0.20,0.25]) {
    for (const bHp of [0.5,0.65,0.8,0.9]) {
      for (const cd of [0.75,0.80,0.85,0.90,0.95]) {
        s([dist,bHp,0.5,0.85,1,0,0,0,cd,0,0.2],[cd*0.95,0,0,0,0,0,(1-cd)*0.5]);
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // БЛОК 2: СТРЕЙФ (~1500 сценариев)
  // ═══════════════════════════════════════════════════════════════════

  // 2a. Кулдаун не готов
  for (const dist of [0.05,0.10,0.15,0.20,0.25,0.30]) {
    for (const bHp of [0.4,0.5,0.6,0.7,0.8,0.9]) {
      for (const cd of [0.0,0.1,0.2,0.3,0.4,0.5,0.6]) {
        const atk = cd * 0.35;
        const st  = clamp(0.9 - cd * 0.5, 0.3, 0.9);
        s([dist,bHp,0.5,0.85,1,0,0,0,cd,0,0.2],[atk,0,0,0,0,0,st]);
      }
    }
  }

  // 2b. Далеко от цели (>0.35) — сближаемся через стрейф
  for (const dist of [0.35,0.40,0.45,0.50,0.55,0.60,0.70,0.80,0.90,1.0]) {
    for (const bHp of [0.4,0.5,0.6,0.7,0.8,0.9,1.0]) {
      for (const tHp of [0.3,0.5,0.7,0.9]) {
        s([dist,bHp,tHp,0.85,1,0,0,0,0.5,0,0.1],[0,0,0,0,0,0,1.0]);
        s([dist,bHp,tHp,0.85,0,0,0,0,0.5,0,0.1],[0,0,0,0,0.15,0,1.0]);
      }
    }
  }

  // 2c. Стрейф vs несколько врагов
  for (const dist of [0.10,0.15,0.20,0.25]) {
    for (const bHp of [0.4,0.5,0.6,0.7]) {
      for (const enemy of [0.4,0.6,0.8,1.0]) {
        const retreat = enemy * 0.4;
        const st = clamp(0.7 - retreat * 0.3, 0.3, 0.7);
        s([dist,bHp,0.5,0.8,1,0,0,0,0.8,0,enemy],[0.5-retreat*0.2,retreat,0,0,0,0,st]);
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // БЛОК 3: ОТСТУПЛЕНИЕ (~800 сценариев)
  // ═══════════════════════════════════════════════════════════════════

  // 3a. Очень низкое HP (< 0.2 = 4 HP)
  for (const dist of [0.05,0.10,0.15,0.20,0.30,0.40]) {
    for (const bHp of [0.02,0.05,0.08,0.10,0.12,0.15,0.18]) {
      for (const food of [0,1]) {
        for (const heal of [0,1]) {
          const r = heal ? 0.2 : (food ? 0.3 : 0.85);
          const h = heal ? 0.9 : 0;
          const e = food && !heal ? 0.5 : 0;
          s([dist,bHp,0.5,0.8,1,food,heal,0,0.8,0,0.2],[0,r,e,h,0,0,0.1]);
        }
      }
    }
  }

  // 3b. Низкое HP + несколько врагов
  for (const dist of [0.05,0.10,0.15,0.20,0.30]) {
    for (const bHp of [0.1,0.15,0.2,0.25,0.3]) {
      for (const enemy of [0.4,0.6,0.8,1.0]) {
        const r = clamp(0.4 + enemy * 0.3 + (0.3 - bHp), 0.3, 0.95);
        s([dist,bHp,0.5,0.8,1,0,0,0,0.7,0,enemy],[0,r,0,0,0,0,0.1]);
        s([dist,bHp,0.5,0.8,1,1,0,0,0.7,0,enemy],[0,r*0.6,0.4,0,0,0,0.1]);
      }
    }
  }

  // 3c. Outnumbered + нет зелий
  for (const bHp of [0.15,0.2,0.25,0.3,0.35]) {
    for (const enemy of [0.6,0.8,1.0]) {
      s([0.15,bHp,0.7,0.75,1,0,0,0,0.8,0,enemy],[0,0.9,0,0,0,0,0.05]);
      s([0.10,bHp,0.8,0.75,1,0,0,0,0.9,0,enemy],[0.3,0.65,0,0,0,0,0.05]);
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // БЛОК 4: ЕДА (~2000 сценариев)
  // ═══════════════════════════════════════════════════════════════════

  // 4a. Голодный + нормальное HP → ешь
  for (const dist of [0.05,0.10,0.15,0.20,0.30,0.50]) {
    for (const hunger of [0.0,0.1,0.2,0.3,0.4,0.5,0.6,0.65]) {
      for (const bHp of [0.5,0.6,0.7,0.8,0.9,1.0]) {
        // Чем дальше враг, тем безопаснее есть
        const eatVal = clamp(0.9 - dist * 0.3 - bHp * 0.1 + (0.7 - hunger) * 0.5, 0.3, 0.95);
        const atkVal = clamp(dist < 0.2 ? 0.6 - eatVal * 0.4 : 0, 0, 0.5);
        s([dist,bHp,0.5,hunger,1,1,0,0,0.5,0,0.2],[atkVal,0,eatVal,0,0,0,0.05]);
      }
    }
  }

  // 4b. Голодный + низкое HP → сначала еда, потом зелье
  for (const dist of [0.05,0.10,0.20,0.30]) {
    for (const hunger of [0.1,0.2,0.3,0.4]) {
      for (const bHp of [0.1,0.15,0.2,0.25,0.3]) {
        const heal = bHp < 0.2 ? 0.6 : 0.2;
        const eat  = clamp(0.8 - bHp * 0.5, 0.3, 0.8);
        s([dist,bHp,0.5,hunger,1,1,1,0,0.7,0,0.2],[0,0.1,eat,heal,0,0,0]);
        s([dist,bHp,0.5,hunger,1,1,0,0,0.7,0,0.2],[0,0.2,eat,0,0,0,0]);
      }
    }
  }

  // 4c. Полный голод, нет угрозы
  for (const dist of [0.5,0.6,0.7,0.8,1.0]) {
    for (const bHp of [0.5,0.6,0.7,0.8,0.9,1.0]) {
      for (const hunger of [0.0,0.1,0.2,0.3,0.4,0.5]) {
        s([dist,bHp,0.5,hunger,1,1,0,0,0.5,0,0.1],[0,0,0.95,0,0,0,0.05]);
      }
    }
  }

  // 4d. Не нужна еда (сытый)
  for (const dist of [0.10,0.15,0.20,0.25]) {
    for (const bHp of [0.6,0.7,0.8,0.9,1.0]) {
      for (const hunger of [0.75,0.80,0.85,0.90,0.95,1.0]) {
        s([dist,bHp,0.5,hunger,1,1,0,0,1.0,0,0.2],[0.95,0,0,0,0,0,0.05]);
      }
    }
  }

  // 4e. Голодный но далеко — ешь без страха
  for (const dist of [0.6,0.7,0.8,0.9,1.0]) {
    for (const hunger of [0.0,0.1,0.2,0.3]) {
      for (const bHp of [0.3,0.4,0.5,0.6,0.7]) {
        s([dist,bHp,0.5,hunger,1,1,0,0,0.5,0,0.1],[0,0,1.0,0,0,0,0]);
      }
    }
  }

  // 4f. Еды нет — не едим
  for (const dist of [0.10,0.15,0.20]) {
    for (const bHp of [0.3,0.4,0.5]) {
      for (const hunger of [0.1,0.2,0.3]) {
        s([dist,bHp,0.5,hunger,1,0,0,0,0.8,0,0.2],[0.4,0.4,0,0,0,0,0.2]);
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // БЛОК 5: ХИЛКИ И ЗЕЛЬЯ (~1500 сценариев)
  // ═══════════════════════════════════════════════════════════════════

  // 5a. Хил-зелье при низком HP
  for (const dist of [0.05,0.10,0.15,0.20,0.30]) {
    for (const bHp of [0.05,0.10,0.15,0.20,0.25,0.30,0.35,0.40]) {
      const urgency = clamp(1.0 - bHp * 2, 0.4, 1.0);
      s([dist,bHp,0.5,0.8,1,0,1,0,0.7,0,0.2],[0,bHp<0.15?0.4:0.1,0,urgency,0,0,0]);
      s([dist,bHp,0.5,0.7,1,1,1,0,0.7,0,0.2],[0,0.05,0.2,urgency*0.8,0,0,0]);
      // Хилка + перк
      s([dist,bHp,0.5,0.8,1,0,1,1,0.7,0,0.2],[0,0.1,0,urgency,0,0.3,0]);
    }
  }

  // 5b. Буф-зелье при хорошем HP
  for (const dist of [0.10,0.15,0.20,0.25]) {
    for (const bHp of [0.6,0.7,0.75,0.8,0.85,0.9,0.95,1.0]) {
      for (const hunger of [0.75,0.85,0.90,0.95,1.0]) {
        s([dist,bHp,0.5,hunger,1,0,1,0,0.9,0,0.2],[0.7,0,0,0,0,0.85,0.1]);
        s([dist,bHp,0.6,hunger,1,0,1,0,1.0,0.4,0.2],[0.8,0,0,0,0,0.85,0.05]);
      }
    }
  }

  // 5c. Зелье на врага (яд/слабость)
  for (const dist of [0.1,0.15,0.20,0.25,0.30]) {
    for (const bHp of [0.5,0.6,0.7,0.8]) {
      for (const tHp of [0.6,0.7,0.8,0.9,1.0]) {
        s([dist,bHp,tHp,0.85,0,0,1,0,0.8,0,0.2],[0.2,0,0,0,0.85,0,0.1]);
        s([dist,bHp,tHp,0.85,1,0,1,0,0.9,0,0.2],[0.5,0,0,0,0.6,0,0.1]);
      }
    }
  }

  // 5d. Нет зелий — не применяем
  for (const dist of [0.10,0.15,0.20]) {
    for (const bHp of [0.3,0.4,0.5]) {
      s([dist,bHp,0.5,0.75,1,0,0,0,0.9,0,0.2],[0.6,0.2,0,0,0,0,0.2]);
      s([dist,bHp,0.5,0.75,1,0,0,0,1.0,0,0.1],[0.9,0,0,0,0,0,0.1]);
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // БЛОК 6: ДВИЖЕНИЕ / ХОДЬБА (~1000 сценариев)
  // ═══════════════════════════════════════════════════════════════════

  // 6a. Преследование далёкой цели
  for (const dist of [0.3,0.35,0.4,0.45,0.5,0.55,0.6,0.65,0.7,0.75,0.8,0.85,0.9,0.95,1.0]) {
    for (const bHp of [0.4,0.5,0.6,0.7,0.8,0.9,1.0]) {
      for (const cd of [0.0,0.3,0.5,0.7,1.0]) {
        s([dist,bHp,0.5,0.85,1,0,0,0,cd,0,0.1],[0,0,0,0,0,0,1.0]);
        s([dist,bHp,0.5,0.85,0,0,0,0,cd,0,0.1],[0,0,0,0,0,0,1.0]);
      }
    }
  }

  // 6b. Подход к цели (0.2-0.35) — кулдаун почти готов
  for (const dist of [0.20,0.22,0.25,0.28,0.30,0.32,0.35]) {
    for (const bHp of [0.5,0.6,0.7,0.8,0.9]) {
      for (const cd of [0.5,0.6,0.7,0.8,0.85,0.9]) {
        const atk = cd > 0.8 ? cd * 0.9 : 0;
        const st  = atk > 0 ? 0.1 : 0.8;
        s([dist,bHp,0.5,0.85,1,0,0,0,cd,0,0.1],[atk,0,0,0,0,0,st]);
      }
    }
  }

  // 6c. Цели нет — стоим/патрулируем
  for (let i = 0; i < 100; i++) {
    const bHp = 0.5 + Math.random() * 0.5;
    const hunger = 0.5 + Math.random() * 0.5;
    s([1.0,bHp,0.5,hunger,1,0,0,0,0.5,0,0],[0,0,0,0,0,0,1.0]);
  }

  // ═══════════════════════════════════════════════════════════════════
  // БЛОК 7: ГРАНИЧНЫЕ СЛУЧАИ / СИТУАЦИИ (~700 сценариев)
  // ═══════════════════════════════════════════════════════════════════

  // 7a. Бот умирает (hp < 0.05) — только retreat
  for (const dist of [0.05,0.1,0.15,0.2,0.3]) {
    for (const heal of [0,1]) {
      s([dist,0.02,0.5,0.8,1,0,heal,0,0.8,0,0.2],[0,0.9,0,heal?0.9:0,0,0,0.05]);
      s([dist,0.04,0.5,0.8,1,0,heal,0,0.8,0,0.5],[0,0.95,0,heal?0.85:0,0,0,0.02]);
    }
  }

  // 7b. Оба на одинаковом HP — агрессивная атака
  for (const dist of [0.05,0.10,0.15,0.20]) {
    for (const hp of [0.4,0.5,0.6,0.7]) {
      s([dist,hp,hp,0.85,1,0,0,0,1.0,0,0.1],[0.95,0,0,0,0,0,0.05]);
      s([dist,hp,hp,0.8,1,0,0,1,1.0,0,0.1],[0.8,0,0,0,0,0.75,0.05]);
    }
  }

  // 7c. Враг сильнее (tgtHp > botHp значительно)
  for (const dist of [0.10,0.15,0.20,0.25]) {
    for (const bHp of [0.2,0.3,0.4,0.5]) {
      for (const tHp of [0.7,0.8,0.9,1.0]) {
        s([dist,bHp,tHp,0.8,1,1,0,0,0.9,0,0.2],[0.3,0.4,0.3,0,0,0,0.1]);
        s([dist,bHp,tHp,0.8,1,0,1,0,0.9,0,0.2],[0,0.5,0,0.6,0,0,0.1]);
      }
    }
  }

  // 7d. Первые секунды боя (cd=0, kd=0)
  for (const dist of [0.10,0.15,0.20,0.25,0.30]) {
    for (const bHp of [0.8,0.9,1.0]) {
      s([dist,bHp,1.0,0.95,1,0,0,1,0.0,0,0.2],[0,0,0,0,0,0.9,0.1]);
      s([dist,bHp,1.0,0.95,1,0,0,0,0.0,0,0.2],[0,0,0,0,0,0,1.0]);
    }
  }

  // 7e. Перк + атака — комбо
  for (const dist of [0.10,0.15,0.20]) {
    for (const bHp of [0.7,0.8,0.9,1.0]) {
      s([dist,bHp,0.6,0.9,1,0,1,0,1.0,0,0.2],[0.6,0,0,0,0,0.8,0.1]);
      s([dist,bHp,0.5,0.9,1,0,1,0,0.95,0,0.2],[0.7,0,0,0,0,0.7,0.1]);
    }
  }

  // 7f. Сложные сценарии — несколько условий одновременно
  // [низкое HP + голод + враги + без зелий]
  for (const bHp of [0.15,0.20,0.25,0.30]) {
    for (const hunger of [0.1,0.2,0.3]) {
      for (const enemy of [0.4,0.6,0.8]) {
        s([0.10,bHp,0.6,hunger,1,1,0,0,0.7,0,enemy],[0,0.5,0.4,0,0,0,0.1]);
        s([0.15,bHp,0.6,hunger,1,0,1,0,0.7,0,enemy],[0,0.4,0,0.7,0,0,0.1]);
      }
    }
  }

  // 7g. Союзники атакуют (бот не в риске — может рискнуть)
  for (const dist of [0.10,0.15,0.20,0.25]) {
    for (const bHp of [0.3,0.4,0.5]) {
      for (const ally of [0.4,0.6,0.8,1.0]) {
        s([dist,bHp,0.7,0.8,1,0,0,0,0.9,ally,0.2],[0.7,0,0,0,0,0,0.2]);
        s([dist,bHp,0.5,0.8,1,0,0,0,1.0,ally,0.2],[0.9,0,0,0,0,0,0.05]);
      }
    }
  }


  // ═══════════════════════════════════════════════════════════════════
  // БЛОК 8: 20к — ХОДЬБА / ПРИБЛИЖЕНИЕ К ЦЕЛИ
  // ═══════════════════════════════════════════════════════════════════
  for (let i = 0; i < 20000; i++) {
    const dist   = 0.28 + Math.random() * 0.72;   // 0.28-1.0 (далеко)
    const bHp    = 0.3  + Math.random() * 0.7;
    const tHp    = 0.3  + Math.random() * 0.7;
    const hunger = 0.5  + Math.random() * 0.5;
    const sword  = Math.random() > 0.3 ? 1 : 0;
    const cd     = Math.random();
    const ally   = Math.random() * 0.4;
    const enemy  = Math.random() * 0.3;
    const hpDiff = clamp((bHp - tHp) / 2 + 0.5, 0, 1);
    // Идём к цели — strafe доминирует
    const strafe = clamp(0.85 + dist * 0.1 - bHp * 0.05, 0.7, 1.0);
    const attack = dist < 0.32 && cd > 0.8 ? cd * 0.6 : 0;
    data.push({ input: [dist,bHp,tHp,hpDiff,hunger,sword,0,0,0,cd,ally,enemy],
                output: [attack,0,0,0,0,0,strafe] });
  }

  // ═══════════════════════════════════════════════════════════════════
  // БЛОК 9: 10к — ОТСТУПЛЕНИЕ / RETREAT
  // ═══════════════════════════════════════════════════════════════════
  for (let i = 0; i < 10000; i++) {
    const dist   = Math.random() * 0.5;            // близко
    const bHp    = Math.random() * 0.3;            // 0-0.3 (критический)
    const tHp    = 0.3 + Math.random() * 0.7;
    const hunger = Math.random() * 0.6;
    const hasHeal = Math.random() > 0.5 ? 1 : 0;
    const hasFood = Math.random() > 0.4 ? 1 : 0;
    const enemy  = 0.2 + Math.random() * 0.8;
    const hpDiff = clamp((bHp - tHp) / 2 + 0.5, 0, 1);
    const retreat = clamp(0.6 + (0.3 - bHp) * 2 + enemy * 0.3, 0.5, 1.0);
    const heal    = bHp < 0.15 && hasHeal ? clamp(0.9 - bHp * 2, 0.6, 0.95) : 0;
    const eat     = bHp >= 0.15 && hasFood && hunger < 0.5 ? 0.4 : 0;
    data.push({ input: [dist,bHp,tHp,hpDiff,hunger,0,hasFood,hasHeal,0,0.7,0,enemy],
                output: [0,retreat,eat,heal,0,0,0.05] });
  }

  // ═══════════════════════════════════════════════════════════════════
  // БЛОК 10: 10к — ПОГОНЯ (chasе) — враг убегает
  // ═══════════════════════════════════════════════════════════════════
  for (let i = 0; i < 10000; i++) {
    const dist   = 0.20 + Math.random() * 0.60;   // 0.2-0.8 (убегающий враг)
    const bHp    = 0.35 + Math.random() * 0.65;   // достаточно HP для погони
    const tHp    = Math.random() * 0.4;            // враг слабый — убегает
    const hunger = 0.6  + Math.random() * 0.4;    // сытый — может бежать
    const sword  = 1;
    const cd     = Math.random();
    const hpDiff = clamp((bHp - tHp) / 2 + 0.5, 0, 1);
    // Агрессивное преследование: strafe=1, attack когда близко+cd ready
    const strafe = clamp(0.7 + dist * 0.25, 0.7, 1.0);
    const attack = dist < 0.25 && cd > 0.75 ? cd * 0.9 : 0;
    data.push({ input: [dist,bHp,tHp,hpDiff,hunger,sword,0,0,0,cd,0,0.1],
                output: [attack,0,0,0,0,0,strafe] });
  }

  // ═══════════════════════════════════════════════════════════════════
  // БЛОК 11: 10к — ЗЕЛЬЯ (POTIONS) — когда применять
  // ═══════════════════════════════════════════════════════════════════
  for (let i = 0; i < 10000; i++) {
    const dist    = 0.05 + Math.random() * 0.35;
    const bHp     = Math.random();
    const tHp     = 0.3  + Math.random() * 0.7;
    const hasHeal = 1;
    const hasBuff = Math.random() > 0.5 ? 1 : 0;
    const hunger  = 0.6  + Math.random() * 0.4;
    const hpDiff  = clamp((bHp - tHp) / 2 + 0.5, 0, 1);
    let throwHeal = 0, throwPotion = 0, throwPerk = 0, attack = 0;
    if (bHp < 0.2) {
      // Критически мало HP — хилка в приоритете
      throwHeal = clamp(0.85 + (0.2 - bHp) * 2, 0.7, 0.98);
    } else if (bHp < 0.4) {
      // Средне мало — хилка или отступаем
      throwHeal = clamp(0.5 + (0.4 - bHp) * 1.5, 0.4, 0.75);
    } else if (hasBuff && bHp > 0.6) {
      // Хорошее HP + буф — применяем буф перед боем
      throwPerk = clamp(0.7 + bHp * 0.2, 0.65, 0.92);
      attack    = dist < 0.2 ? 0.5 : 0;
    } else if (bHp > 0.5 && dist < 0.25) {
      // Атакуем если нет нужды в зелье
      attack = 0.75;
    }
    // Дебаф зелье: когда враг здоров + у нас нет хилки
    if (tHp > 0.7 && bHp > 0.5 && !throwHeal) {
      throwPotion = 0.5;
      attack      = 0.4;
    }
    data.push({ input: [dist,bHp,tHp,hpDiff,hunger,1,0,hasHeal,hasBuff,0.8,0,0.2],
                output: [attack,bHp<0.2?0.2:0,0,throwHeal,throwPotion,throwPerk,0.05] });
  }

  // ═══════════════════════════════════════════════════════════════════
  // БЛОК 12: 50к — ПВП-БОЙ (случайные боевые сценарии)
  // ═══════════════════════════════════════════════════════════════════
  for (let i = 0; i < 50000; i++) {
    const dist   = Math.random();
    const bHp    = Math.random();
    const tHp    = Math.random();
    const hunger = Math.random();
    const sword  = Math.random() > 0.2 ? 1 : 0;
    const food   = Math.random() > 0.4 ? 1 : 0;
    const heal   = Math.random() > 0.5 ? 1 : 0;
    const buff   = Math.random() > 0.6 ? 1 : 0;
    const cd     = Math.random();
    const ally   = Math.random() * 0.6;
    const enemy  = Math.random() * 0.6;
    const hpDiff = clamp((bHp - tHp) / 2 + 0.5, 0, 1);

    // Лейблирование по чётким правилам
    let attack = 0, retreat = 0, eat = 0, throwHeal = 0, throwPotion = 0, throwPerk = 0, strafe = 0;

    if (bHp < 0.1) {
      // Умираем — только спасаться
      retreat   = 0.9;
      throwHeal = heal ? 0.85 : 0;
    } else if (bHp < 0.25 && heal) {
      // Мало HP + хилка — лечимся
      throwHeal = clamp(0.75 + (0.25 - bHp) * 2, 0.6, 0.9);
      retreat   = clamp(0.3 + (0.25 - bHp), 0.2, 0.5);
    } else if (bHp < 0.4 && food && hunger < 0.5) {
      // Средне мало HP + голоден
      eat     = clamp(0.65 + (0.4 - bHp), 0.5, 0.85);
      retreat = bHp < 0.25 ? 0.3 : 0;
    } else if (dist < 0.30 && cd > 0.75 && sword) {
      // Близко + кулдаун готов + меч → АТАКА
      const finishing = tHp < 0.15;
      attack  = finishing ? 1.0 : clamp(cd * 0.9 + (1 - dist) * 0.1, 0.6, 0.98);
      strafe  = dist < 0.15 ? 0.05 : 0.15;
    } else if (dist > 0.35) {
      // Далеко — сближаемся
      strafe  = clamp(0.75 + dist * 0.15, 0.7, 0.95);
      attack  = dist < 0.4 && cd > 0.85 ? 0.3 : 0;
    } else {
      // Средняя дистанция + кулдаун не готов
      strafe  = clamp((1 - cd) * 0.7 + 0.2, 0.3, 0.85);
      attack  = cd > 0.6 ? cd * 0.5 : 0;
      if (buff && bHp > 0.65) { throwPerk = 0.55; }
    }

    // Модификаторы союзников — агрессивнее
    if (ally > 0.3) { attack = clamp(attack * 1.2, 0, 1); retreat = retreat * 0.6; }
    // Модификаторы врагов — осторожнее
    if (enemy > 0.5 && bHp < 0.5) { retreat = clamp(retreat + enemy * 0.2, 0, 0.95); }

    data.push({ input: [dist,bHp,tHp,hpDiff,hunger,sword,food,heal,buff,cd,ally,enemy],
                output: [attack,retreat,eat,throwHeal,throwPotion,throwPerk,strafe].map(v=>clamp(v,0,1)) });
  }


  // ═══════════════════════════════════════════════════════════════
  // +666 000 ДОПОЛНИТЕЛЬНЫХ СЦЕНАРИЕВ
  // ═══════════════════════════════════════════════════════════════

  // Вспомогательные функции
  const rnd    = (a,b) => a + Math.random()*(b-a);
  const pick   = arr => arr[Math.floor(Math.random()*arr.length)];
  const label  = (input, atk,ret,eat,heal,pot,perk,str) =>
    data.push({ input, output:[atk,ret,eat,heal,pot,perk,str].map(v=>clamp(v,0,1)) });

  // ──────────────────────────────────────────────────────────────
  // БЛОК A: 200 000 — универсальные PVP (полное покрытие пространства)
  // ──────────────────────────────────────────────────────────────
  for (let i = 0; i < 200000; i++) {
    const dist=rnd(0,1), bHp=rnd(0,1), tHp=rnd(0,1), hunger=rnd(0,1);
    const sword=pick([0,1]), food=pick([0,1]), hasHeal=pick([0,1]);
    const hasBuff=pick([0,1]), cd=rnd(0,1), ally=rnd(0,0.6), enemy=rnd(0,0.6);
    const hpDiff=clamp((bHp-tHp)/2+0.5,0,1);
    let atk=0,ret=0,eat=0,heal=0,pot=0,perk=0,str=0;
    if (bHp<0.1)                                    { ret=0.9; heal=hasHeal?0.85:0; }
    else if (bHp<0.25&&hasHeal)                     { heal=clamp(0.75+(0.25-bHp)*2,0.6,0.9); ret=0.3; }
    else if (bHp<0.4&&food&&hunger<0.5)             { eat=clamp(0.65+(0.4-bHp),0.5,0.85); }
    else if (dist<0.30&&cd>0.75&&sword)             { atk=clamp(cd*0.9+(1-dist)*0.1,0.6,0.98); str=0.1; }
    else if (dist>0.35)                             { str=clamp(0.75+dist*0.15,0.7,0.95); atk=dist<0.4&&cd>0.85?0.3:0; }
    else                                            { str=clamp((1-cd)*0.7+0.2,0.3,0.85); atk=cd>0.6?cd*0.5:0; }
    if (hasBuff&&bHp>0.65&&!heal)                   { perk=0.55; }
    if (ally>0.3)                                   { atk=clamp(atk*1.2,0,1); ret*=0.6; }
    if (enemy>0.5&&bHp<0.5)                         { ret=clamp(ret+enemy*0.2,0,0.95); }
    label([dist,bHp,tHp,hpDiff,hunger,sword,food,hasHeal,hasBuff,cd,ally,enemy],atk,ret,eat,heal,pot,perk,str);
  }

  // ──────────────────────────────────────────────────────────────
  // БЛОК B: 100 000 — W-TAP паттерны (release W + удар + re-press)
  // ──────────────────────────────────────────────────────────────
  for (let i = 0; i < 100000; i++) {
    const dist   = rnd(0.05,0.30);  // ближний бой
    const bHp    = rnd(0.3,1.0);
    const tHp    = rnd(0.1,1.0);
    const hunger = rnd(0.5,1.0);
    const cd     = rnd(0.8,1.0);    // CD почти/полностью готов
    const hpDiff = clamp((bHp-tHp)/2+0.5,0,1);
    // W-tap: атакуем когда cd готов, затем strafe=0 (отпускаем W на 50ms)
    const atk = clamp(cd*0.92, 0.7, 0.98);
    const str = cd<0.85 ? 0.3 : 0.05; // минимальный strafe при атаке
    label([dist,bHp,tHp,hpDiff,hunger,1,0,0,0,cd,0,0.1], atk,0,0,0,0,0,str);
    // Вариант с союзником — ещё агрессивнее
    label([dist,bHp,tHp,hpDiff,hunger,1,0,0,0,cd,rnd(0.3,0.8),0.1], clamp(atk*1.1,0,1),0,0,0,0,0,0.02);
  }

  // ──────────────────────────────────────────────────────────────
  // БЛОК C: 100 000 — щит + топор (axe-shield break combo)
  // ──────────────────────────────────────────────────────────────
  for (let i = 0; i < 100000; i++) {
    const dist   = rnd(0.05,0.35);
    const bHp    = rnd(0.3,1.0);
    const tHp    = rnd(0.4,1.0);  // враг со щитом живой
    const hunger = rnd(0.6,1.0);
    const cd     = rnd(0.0,1.0);
    const hpDiff = clamp((bHp-tHp)/2+0.5,0,1);
    // Враг со щитом = нужно сломать: atk высокий (топор), no retreat
    // После слома щита (simulate) можно бить с мечом
    const shieldBroken = Math.random() > 0.5; // 50% — щит уже сломан
    if (!shieldBroken) {
      // Ломаем щит: атакуем топором (atk), без спешки
      const atk = cd>0.95 ? 0.9 : (cd>0.7 ? 0.5 : 0.1);
      label([dist,bHp,tHp,hpDiff,hunger,0,0,0,0,cd,0,0.2], atk,0,0,0,0,0,clamp(1-atk,0.1,0.8));
    } else {
      // Щит сломан: бьём мечом полноценно
      const atk = cd>0.75&&dist<0.25 ? clamp(cd*0.95,0.7,0.98) : 0;
      const str = atk>0.7 ? 0.05 : 0.85;
      label([dist,bHp,tHp,hpDiff,hunger,1,0,0,0,cd,0,0.1], atk,0,0,0,0,0,str);
    }
  }

  // ──────────────────────────────────────────────────────────────
  // БЛОК D: 100 000 — тотем (totem of undying) сценарии
  // ──────────────────────────────────────────────────────────────
  for (let i = 0; i < 100000; i++) {
    const dist   = rnd(0,1);
    const bHp    = rnd(0,1);
    const tHp    = rnd(0,0.15);  // враг почти мёртв — может быть тотем
    const hunger = rnd(0.5,1.0);
    const hasHeal= Math.random()>0.5 ? 1 : 0;
    const cd     = rnd(0,1);
    const hpDiff = clamp((bHp-tHp)/2+0.5,0,1);
    // Если враг на низком HP — продолжаем атаку (тотем спасёт его, но мы не отступаем)
    let atk=0,ret=0,str=0,heal=0;
    if (bHp<0.1)                { ret=0.9; heal=hasHeal?0.85:0; }
    else if (dist>0.35)         { str=clamp(0.8+dist*0.15,0.75,0.95); }
    else if (cd>0.75&&dist<0.3) { atk=clamp(cd*0.95,0.75,1.0); str=0.05; }
    else                        { str=clamp((1-cd)*0.6+0.3,0.3,0.85); atk=cd*0.4; }
    // Добиваем врага с тотемом: burst attack
    if (tHp<0.08 && cd>0.7 && dist<0.3) { atk=1.0; str=0; }
    label([dist,bHp,tHp,hpDiff,hunger,1,0,hasHeal,0,cd,0,0.1], atk,ret,0,heal,0,0,str);
  }

  // ──────────────────────────────────────────────────────────────
  // БЛОК E: 100 000 — стрейф + позиционирование
  // ──────────────────────────────────────────────────────────────
  for (let i = 0; i < 100000; i++) {
    const dist   = rnd(0.05,0.60);
    const bHp    = rnd(0.15,1.0);
    const tHp    = rnd(0.15,1.0);
    const hunger = rnd(0.4,1.0);
    const cd     = rnd(0,1);
    const hpDiff = clamp((bHp-tHp)/2+0.5,0,1);
    const str    = clamp(0.3+(1-cd)*0.5+(dist>0.3?0.2:0),0.2,0.95);
    const atk    = cd>0.78&&dist<0.28 ? clamp(cd*0.88,0.6,0.96) : clamp(cd*0.3,0,0.4);
    label([dist,bHp,tHp,hpDiff,hunger,1,0,0,0,cd,rnd(0,0.5),rnd(0,0.4)], atk,0,0,0,0,0,str);
  }

  // ──────────────────────────────────────────────────────────────
  // БЛОК F: 66 000 — кристалл + специальные сценарии
  // ──────────────────────────────────────────────────────────────
  for (let i = 0; i < 66000; i++) {
    // Хаотичный бой: несколько врагов, разное HP, зелья и союзники
    const dist   = Math.random();
    const bHp    = Math.random();
    const tHp    = Math.random();
    const hunger = rnd(0.3,1.0);
    const sword  = pick([0,1]);
    const food   = pick([0,1]);
    const hasHeal= pick([0,1]);
    const hasBuff= pick([0,1]);
    const cd     = Math.random();
    const ally   = rnd(0,0.8);
    const enemy  = rnd(0.2,1.0);  // несколько врагов
    const hpDiff = clamp((bHp-tHp)/2+0.5,0,1);
    // С несколькими врагами — осторожнее, зелья важны
    let atk=0,ret=0,eat=0,heal=0,pot=0,perk=0,str=0;
    if (bHp<0.12)                                   { ret=0.92; heal=hasHeal?0.88:0; }
    else if (enemy>0.6&&bHp<0.4)                    { ret=clamp(0.5+enemy*0.3,0.4,0.9); eat=food&&hunger<0.4?0.3:0; }
    else if (dist<0.28&&cd>0.72&&sword&&enemy<0.4)  { atk=clamp(cd*0.9,0.65,0.97); str=0.1; }
    else if (hasBuff&&bHp>0.7&&!heal)               { perk=0.7; atk=dist<0.25?0.4:0; }
    else if (dist>0.3)                              { str=clamp(0.7+dist*0.2,0.65,0.95); }
    else                                             { str=0.55; atk=cd>0.65?cd*0.4:0; }
    if (ally>0.5)                                   { atk=clamp(atk*1.15,0,1); }
    label([dist,bHp,tHp,hpDiff,hunger,sword,food,hasHeal,hasBuff,cd,ally,enemy], atk,ret,eat,heal,pot,perk,str);
  }


  // ═══════════════════════════════════════════════════════════════
  // +500 000 СЦЕНАРИЕВ v3.0.1
  // ═══════════════════════════════════════════════════════════════

  // ──────────────────────────────────────────────────────────────
  // БЛОК G: 100 000 — ходьба + поворот головы
  // Закрепляем: когда далеко — двигаться (strafe=1), атака=0
  // ──────────────────────────────────────────────────────────────
  for (let i = 0; i < 100000; i++) {
    const dist   = rnd(0.30, 1.0);  // средняя и дальняя дистанция
    const bHp    = rnd(0.3, 1.0);
    const tHp    = rnd(0.2, 1.0);
    const hunger = rnd(0.5, 1.0);
    const cd     = rnd(0.0, 1.0);
    const hpDiff = clamp((bHp-tHp)/2+0.5, 0, 1);
    // Далеко → бежим (strafe=1), голову смотрим вперёд — atk=0
    const str = clamp(0.90 + dist * 0.08, 0.85, 1.0);
    const atk = (dist < 0.35 && cd > 0.8) ? 0.25 : 0;
    label([dist,bHp,tHp,hpDiff,hunger,1,0,0,0,cd,rnd(0,0.5),rnd(0,0.3)], atk,0,0,0,0,0,str);
  }

  // ──────────────────────────────────────────────────────────────
  // БЛОК H: 100 000 — ближний бой 1-2 блока (CQC)
  // Бот должен атаковать на 2-3 блоках, не только вплотную
  // ──────────────────────────────────────────────────────────────
  for (let i = 0; i < 100000; i++) {
    const dist   = rnd(0.05, 0.30);  // 0.5-3 блока
    const bHp    = rnd(0.3, 1.0);
    const tHp    = rnd(0.1, 1.0);
    const hunger = rnd(0.5, 1.0);
    const cd     = rnd(0.5, 1.0);    // CD готов/почти
    const hpDiff = clamp((bHp-tHp)/2+0.5, 0, 1);
    // На дистанции 1-3 блока с готовым CD → АТАКА
    const cdReady = cd > 0.72;
    const atk = cdReady ? clamp(cd * 0.95 * (1 - dist * 0.5), 0.65, 0.98) : cd * 0.3;
    const str = cdReady ? 0.05 : 0.35;  // не бегать во время удара
    label([dist,bHp,tHp,hpDiff,hunger,1,0,0,0,cd,rnd(0,0.4),rnd(0,0.3)], atk,0,0,0,0,0,str);
    // Вариант: враг убегает (dist растёт) — атаковать пока в reach
    label([dist,bHp,tHp,hpDiff,hunger,1,0,0,0,cd,0,0.1], atk,0,0,0,0,0,clamp(str+0.1,0,1));
  }

  // ──────────────────────────────────────────────────────────────
  // БЛОК I: 100 000 — взрывные/дебаф зелья на врага
  // ──────────────────────────────────────────────────────────────
  for (let i = 0; i < 100000; i++) {
    const dist   = rnd(0.03, 0.60);  // в радиусе броска
    const bHp    = rnd(0.2, 1.0);
    const tHp    = rnd(0.2, 1.0);
    const hunger = rnd(0.5, 1.0);
    const cd     = rnd(0.0, 1.0);
    const hasBuff = 1;               // есть зелье
    const hpDiff = clamp((bHp-tHp)/2+0.5, 0, 1);
    let atk=0,pot=0,perk=0,str=0;
    if (dist < 0.5 && cd < 0.6 && bHp > 0.4) {
      // CD не готов, близко — бросаем зелье
      pot  = clamp(0.80 - dist * 0.5, 0.5, 0.85);
      perk = bHp > 0.7 ? 0.5 : 0;
      str  = 0.15;
    } else if (dist < 0.30 && cd > 0.72) {
      // CD готов + близко — атакуем
      atk  = clamp(cd * 0.9, 0.65, 0.97);
      str  = 0.05;
    } else {
      str  = clamp(0.7 + dist * 0.2, 0.65, 0.95);
      pot  = dist < 0.5 && cd < 0.5 ? 0.4 : 0;
    }
    label([dist,bHp,tHp,hpDiff,hunger,1,0,0,hasBuff,cd,rnd(0,0.4),rnd(0,0.3)], atk,0,0,0,pot,perk,str);
  }

  // ──────────────────────────────────────────────────────────────
  // БЛОК J: 100 000 — крит-удары (высокий урон при низком HP врага)
  // ──────────────────────────────────────────────────────────────
  for (let i = 0; i < 100000; i++) {
    const dist   = rnd(0.05, 0.25);  // ближний бой
    const bHp    = rnd(0.4, 1.0);    // мы живые
    const tHp    = rnd(0.05, 0.50);  // враг слабый → добиваем
    const hunger = rnd(0.5, 1.0);
    const cd     = rnd(0.7, 1.0);    // CD готов
    const hpDiff = clamp((bHp-tHp)/2+0.5, 0, 1);
    // Низкий HP врага + CD готов + близко → максимальная атака
    const finishing = tHp < 0.15;
    const atk = finishing ? 1.0 : clamp(cd * 0.95 + (1-tHp) * 0.05, 0.75, 0.99);
    const str = 0.02;  // почти не стрейфить при добивании
    label([dist,bHp,tHp,hpDiff,hunger,1,0,0,0,cd,rnd(0,0.4),rnd(0,0.2)], atk,0,0,0,0,0,str);
  }

  // ──────────────────────────────────────────────────────────────
  // БЛОК K: 100 000 — защита + отступление + лечение
  // ──────────────────────────────────────────────────────────────
  for (let i = 0; i < 100000; i++) {
    const dist   = rnd(0.0, 0.8);
    const bHp    = rnd(0.0, 0.35);  // низкое HP
    const tHp    = rnd(0.2, 1.0);
    const hunger = rnd(0.2, 0.6);   // голодный
    const cd     = rnd(0.0, 1.0);
    const food   = Math.random() > 0.3 ? 1 : 0;
    const hasHeal= Math.random() > 0.4 ? 1 : 0;
    const hpDiff = clamp((bHp-tHp)/2+0.5, 0, 1);
    let ret=0,eat=0,heal=0,str=0;
    if (bHp < 0.08) {
      ret  = 0.95;
      heal = hasHeal ? 0.90 : 0;
      eat  = !hasHeal && food ? 0.7 : 0;
    } else if (bHp < 0.20 && hasHeal) {
      heal = clamp(0.80 + (0.20-bHp)*2, 0.65, 0.92);
      ret  = 0.50;
    } else if (bHp < 0.30 && food && hunger < 0.5) {
      eat  = clamp(0.70 + (0.30-bHp)*1.5, 0.55, 0.88);
      ret  = 0.35;
    } else {
      // Среднее HP — отступаем, не атакуем
      ret  = clamp(0.40 + (0.35-bHp)*2, 0.25, 0.75);
      str  = clamp(0.50 - ret*0.3, 0.15, 0.55);
    }
    label([dist,bHp,tHp,hpDiff,hunger,1,food,hasHeal,0,cd,rnd(0,0.4),rnd(0,0.4)], 0,ret,eat,heal,0,0,str);
  }


  // ═══════════════════════════════════════════════════════════════════════════
  // МЕГАСЦЕНАРИЙ 1: «АЛМАЗНЫЙ УБИЙЦА» — 120 000 сценариев
  // Описание: одиночный бой против лучшего противника в алмазной броне
  // и алмазным мечом. Бот должен использовать ВСЕГО себя — criты, зелья,
  // правильное дистанцирование, W-tap, золотые яблоки. Детально описывает
  // каждую фазу боя: фаза контакта, фаза крит-цикла, фаза отхода,
  // фаза лечения, финишер. Бот учится НЕ паниковать при низком HP,
  // а действовать чётко по алгоритму.
  // ═══════════════════════════════════════════════════════════════════════════
  {
    const rnd = (a,b) => a + Math.random()*(b-a);
    const pick = arr => arr[Math.floor(Math.random()*arr.length)];

    // ── Фаза 1: Сближение (dist 0.4-1.0) ───────────────────────────────
    for (let i = 0; i < 20000; i++) {
      const dist   = rnd(0.40, 1.0);
      const bHp    = rnd(0.35, 1.0);
      const tHp    = rnd(0.10, 1.0);
      const hunger = rnd(0.60, 1.0);
      const cd     = rnd(0.0,  0.7);
      const hpDiff = clamp((bHp-tHp)/2+0.5,0,1);
      const hasFd  = pick([0,1]), hasHl=pick([0,1]);
      // Далеко — бежим вперёд (strafe), атака только если cd>0.85
      const str = clamp(0.80 + (1-dist)*0.15, 0.70, 0.98);
      const atk = (dist<0.55 && cd>0.88 && bHp>0.3) ? clamp(cd*0.85,0.5,0.9) : 0;
      const ret = bHp<0.15 ? clamp(0.7+(0.15-bHp)*3,0.6,0.95) : 0;
      const eat = (bHp<0.3 && hasFd && !ret) ? 0.55 : 0;
      label([dist,bHp,tHp,hpDiff,hunger,1,hasFd,hasHl,0,cd,0,0.2],atk,ret,eat,0,0,0,str);
    }

    // ── Фаза 2: Крит-цикл (dist 0.08-0.20) ─────────────────────────────
    for (let i = 0; i < 30000; i++) {
      const dist   = rnd(0.08, 0.22);
      const bHp    = rnd(0.25, 1.0);
      const tHp    = rnd(0.05, 1.0);
      const hunger = rnd(0.55, 1.0);
      const cd     = rnd(0.85, 1.0);   // KD почти готов
      const hpDiff = clamp((bHp-tHp)/2+0.5,0,1);
      const finishing = tHp < 0.15;
      // Атака с критом (W-tap + прыжок) — основное действие
      const atk = finishing ? 1.0 : clamp(cd*(0.88+(0.20-dist)*0.5),0.70,0.98);
      const str = clamp(0.15+(1-cd)*0.25, 0.05, 0.35); // немного страфим
      const eat = 0;
      label([dist,bHp,tHp,hpDiff,hunger,1,0,0,0,cd,0,0.1],atk,0,eat,0,0,0,str);
      // С бафом
      label([dist,bHp,tHp,hpDiff,hunger,1,0,0,1,cd,0,0.1],clamp(atk+0.05,0,1),0,0,0,0,0.4,str);
    }

    // ── Фаза 3: Отход и лечение (HP < 35%) ─────────────────────────────
    for (let i = 0; i < 30000; i++) {
      const dist   = rnd(0.0, 0.60);
      const bHp    = rnd(0.05, 0.35);
      const tHp    = rnd(0.10, 1.0);
      const hunger = rnd(0.0,  1.0);
      const cd     = rnd(0.0,  1.0);
      const hpDiff = clamp((bHp-tHp)/2+0.5,0,1);
      const hasHl  = pick([0,1]);
      const hasFd  = pick([0,1]);
      // Очень мало HP — бежим, лечимся, едим
      const urgency = clamp((0.35-bHp)/0.35, 0, 1);
      const ret  = clamp(urgency*0.85 + 0.15, 0.30, 0.95);
      const heal = hasHl ? clamp(urgency*0.80+0.10, 0.40, 0.95) : 0;
      const eat  = hasFd && !heal ? clamp(urgency*0.65, 0.30, 0.85) : 0;
      const atk  = bHp > 0.25 && tHp < 0.15 ? 0.75 : 0; // добиваем если враг почти мёртв
      label([dist,bHp,tHp,hpDiff,hunger,1,hasFd,hasHl,0,cd,0,0.1],atk,ret,eat,heal,0,0,0);
    }

    // ── Фаза 4: Зелья и перки (полный пузырёк) ─────────────────────────
    for (let i = 0; i < 20000; i++) {
      const dist   = rnd(0.05, 0.50);
      const bHp    = rnd(0.50, 1.0);
      const tHp    = rnd(0.20, 1.0);
      const hunger = rnd(0.70, 1.0);
      const cd     = rnd(0.70, 1.0);
      const hpDiff = clamp((bHp-tHp)/2+0.5,0,1);
      // Есть бафы + хорошее HP → кидаем зелья, атакуем
      const pot  = dist < 0.35 ? clamp(0.60+(0.35-dist)*0.8,0.50,0.90) : 0.20;
      const perk = clamp(0.50+(bHp-0.5)*0.5, 0.30, 0.85);
      const atk  = dist < 0.25 ? clamp(cd*0.85, 0.60, 0.95) : 0;
      label([dist,bHp,tHp,hpDiff,hunger,1,0,0,1,cd,0,0.15],atk,0,0,0,pot,perk,0.10);
    }

    // ── Фаза 5: Финиш (tHp < 15%) ──────────────────────────────────────
    for (let i = 0; i < 20000; i++) {
      const dist   = rnd(0.0, 0.40);
      const bHp    = rnd(0.20, 1.0);
      const tHp    = rnd(0.01, 0.15);  // враг почти мёртв!
      const hunger = rnd(0.5,  1.0);
      const cd     = rnd(0.80, 1.0);
      const hpDiff = clamp((bHp-tHp)/2+0.5,0,1);
      // Добиваем! Максимальная атака, никакого отступления
      const atk = 1.0;
      const str = clamp(0.10+(0.40-dist)*0.4,0.05,0.35);
      label([dist,bHp,tHp,hpDiff,hunger,1,0,0,0,cd,0,0.1],atk,0,0,0,0,0,str);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // МЕГАСЦЕНАРИЙ 2: «КОМАНДНЫЙ БОЙ» — 120 000 сценариев
  // Описание: бой 2v2, 3v3 и 2v1. Союзники рядом — агрессивнее.
  // Врагов несколько — осторожнее и используем AoE зелья. Бот учится:
  // — Прикрывать союзников (атаковать того, кто бьёт союзника)
  // — Пользоваться преимуществом численности (flanking)
  // — Выживать при фокусировке (много врагов на одном боте)
  // — Правильно распределять ресурсы (кому кидать хил-зелье)
  // — Дебафф-зелья на группу врагов (splash poison, slowness)
  // ═══════════════════════════════════════════════════════════════════════════
  {
    const rnd = (a,b) => a + Math.random()*(b-a);
    const pick = arr => arr[Math.floor(Math.random()*arr.length)];

    // 2v1 → бот+союзник против одного врага
    for (let i = 0; i < 35000; i++) {
      const dist   = rnd(0.05, 0.60);
      const bHp    = rnd(0.30, 1.0);
      const tHp    = rnd(0.10, 1.0);
      const hunger = rnd(0.60, 1.0);
      const cd     = rnd(0.0, 1.0);
      const ally   = rnd(0.30, 0.80);  // союзник есть
      const enemy  = rnd(0.05, 0.25);  // один враг
      const hpDiff = clamp((bHp-tHp)/2+0.5,0,1);
      // При союзнике — атака агрессивнее, не отступаем
      const atk = dist < 0.35 && cd > 0.60
        ? clamp(cd*(0.85 + ally*0.15), 0.65, 1.0) : 0;
      const str = dist > 0.30 ? clamp(0.75+ally*0.15,0.6,0.95) : 0.10;
      const ret = bHp < 0.15 ? clamp(0.5+(0.15-bHp)*3,0.3,0.8) : 0;
      const pot = dist < 0.35 ? 0.30 : 0;  // дебаф при близком контакте
      label([dist,bHp,tHp,hpDiff,hunger,1,0,0,0,cd,ally,enemy],atk,ret,0,0,pot,0,str);
    }

    // 1v2 → бот один против двух (фокус на боте)
    for (let i = 0; i < 35000; i++) {
      const dist   = rnd(0.05, 0.80);
      const bHp    = rnd(0.10, 0.90);
      const tHp    = rnd(0.10, 1.0);
      const hunger = rnd(0.30, 1.0);
      const cd     = rnd(0.0, 1.0);
      const ally   = rnd(0.0, 0.10);   // союзников нет
      const enemy  = rnd(0.30, 0.80);  // много врагов
      const hasHl  = pick([0,1]);
      const hasFd  = pick([0,1]);
      const hpDiff = clamp((bHp-tHp)/2+0.5,0,1);
      // Несколько врагов + нас фокусируют → отходим, лечимся, дебаф-зелья
      const pressure = clamp(enemy * (1-bHp), 0, 1);
      const ret  = clamp(pressure*0.80 + 0.15, 0.20, 0.95);
      const heal = hasHl && bHp < 0.5 ? clamp(0.60+(0.5-bHp),0.5,0.90) : 0;
      const eat  = hasFd && bHp < 0.45 && !heal ? 0.60 : 0;
      const pot  = enemy > 0.5 && dist < 0.40 ? clamp(enemy*0.70,0.30,0.85) : 0;  // AoE
      const atk  = !ret && !heal && !eat && dist < 0.20 && cd > 0.90 ? 0.70 : 0;
      label([dist,bHp,tHp,hpDiff,hunger,1,hasFd,hasHl,0,cd,ally,enemy],atk,ret,eat,heal,pot,0,0);
    }

    // 2v2 — баланс атаки и осторожности
    for (let i = 0; i < 30000; i++) {
      const dist   = rnd(0.05, 0.70);
      const bHp    = rnd(0.20, 1.0);
      const tHp    = rnd(0.05, 1.0);
      const hunger = rnd(0.40, 1.0);
      const cd     = rnd(0.0, 1.0);
      const ally   = rnd(0.15, 0.60);
      const enemy  = rnd(0.15, 0.55);
      const hpDiff = clamp((bHp-tHp)/2+0.5,0,1);
      const advant = ally - enemy; // насколько нас больше
      const hasBf  = pick([0,1]);
      // Нейтральная ситуация — аккуратная агрессия
      const atk = dist < 0.30 && cd > 0.70
        ? clamp(cd*(0.75+advant*0.2+bHp*0.1),0.45,0.95) : 0;
      const str = dist > 0.25 ? clamp(0.70+advant*0.15,0.50,0.90) : 0.15;
      const perk = hasBf && bHp > 0.60 ? 0.50 : 0;
      const pot  = dist < 0.35 && enemy > 0.30 ? 0.35 : 0;
      label([dist,bHp,tHp,hpDiff,hunger,1,0,0,hasBf,cd,ally,enemy],atk,0,0,0,pot,perk,str);
    }

    // Дебафф-зелья по группе (AoE тактика)
    for (let i = 0; i < 20000; i++) {
      const dist   = rnd(0.10, 0.50);
      const bHp    = rnd(0.40, 1.0);
      const tHp    = rnd(0.30, 1.0);
      const hunger = rnd(0.60, 1.0);
      const cd     = rnd(0.50, 1.0);
      const ally   = rnd(0.20, 0.80);
      const enemy  = rnd(0.30, 0.80);
      const hpDiff = clamp((bHp-tHp)/2+0.5,0,1);
      // Кидаем дебаф-зелье на группу врагов
      const pot  = clamp(enemy*0.85 + (bHp-0.4)*0.3, 0.40, 0.95);
      const atk  = dist < 0.25 && cd > 0.85 ? 0.55 : 0;
      const perk = bHp > 0.70 ? 0.40 : 0;
      label([dist,bHp,tHp,hpDiff,hunger,1,0,0,1,cd,ally,enemy],atk,0,0,0,pot,perk,0.10);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // МЕГАСЦЕНАРИЙ 3: «МАСТЕР ЗЕЛИЙ» — 110 000 сценариев
  // Описание: полный гайд по использованию зелий в PVP. Охватывает:
  // — Когда бросать зелья силы/скорости/огнестойкости (перед боем)
  // — Когда бросать яд/замедление/слабость (на врага)
  // — Когда пить зелья лечения vs бросать исцеление союзнику
  // — Абсорбция (зелье поглощения) как щит перед входом в бой
  // — Timing: не бросай зелье под CD удара, дождись анимации
  // — Эконом-режим: не трать бафы на слабых врагов (tHp < 30%)
  // — Кризисный режим: throwHeal при HP < 20% важнее атаки
  // ═══════════════════════════════════════════════════════════════════════════
  {
    const rnd = (a,b) => a + Math.random()*(b-a);
    const pick = arr => arr[Math.floor(Math.random()*arr.length)];

    // ── Бросок хил-зелья в кризис ───────────────────────────────────────
    for (let i = 0; i < 20000; i++) {
      const dist   = rnd(0.05, 0.60);
      const bHp    = rnd(0.05, 0.22);  // крит HP
      const tHp    = rnd(0.10, 1.0);
      const hunger = rnd(0.20, 1.0);
      const cd     = rnd(0.0, 1.0);
      const hasHl  = pick([0,1]);
      const hpDiff = clamp((bHp-tHp)/2+0.5,0,1);
      const urgency = clamp((0.22-bHp)/0.22, 0, 1);
      const heal = hasHl ? clamp(0.70+urgency*0.25,0.65,0.98) : 0;
      const ret  = !heal ? clamp(urgency*0.85+0.10,0.30,0.95) : clamp(urgency*0.40,0.10,0.60);
      const atk  = !heal && !ret && tHp < 0.10 ? 0.80 : 0; // добиваем
      label([dist,bHp,tHp,hpDiff,hunger,1,0,hasHl,0,cd,0,0.1],atk,ret,0,heal,0,0,0);
    }

    // ── Бафы перед боем (предбоевая подготовка) ─────────────────────────
    for (let i = 0; i < 20000; i++) {
      const dist   = rnd(0.25, 1.0);   // ещё далеко
      const bHp    = rnd(0.60, 1.0);
      const tHp    = rnd(0.20, 1.0);
      const hunger = rnd(0.70, 1.0);
      const cd     = rnd(0.0, 0.80);
      const hasBf  = 1;
      const hpDiff = clamp((bHp-tHp)/2+0.5,0,1);
      // Пока CD восстанавливается — применяем баф
      const perk = dist > 0.30 && cd < 0.75 ? clamp(0.70+(0.75-cd)*0.3,0.50,0.95) : 0;
      const str  = dist > 0.35 ? clamp(0.75+(1-dist)*0.2,0.65,0.90) : 0;
      const atk  = dist < 0.30 && cd > 0.85 ? 0.70 : 0;
      label([dist,bHp,tHp,hpDiff,hunger,1,0,0,hasBf,cd,0,0.1],atk,0,0,0,0,perk,str);
    }

    // ── Дебаф-зелья на врага ────────────────────────────────────────────
    for (let i = 0; i < 20000; i++) {
      const dist   = rnd(0.08, 0.45);
      const bHp    = rnd(0.30, 1.0);
      const tHp    = rnd(0.25, 1.0);
      const hunger = rnd(0.50, 1.0);
      const cd     = rnd(0.0, 1.0);
      const hpDiff = clamp((bHp-tHp)/2+0.5,0,1);
      // Кидаем яд/замедление когда:
      // 1. Мы в хорошей форме (bHp > 0.5)
      // 2. Враг живой (tHp > 0.3)
      // 3. Достаточно близко (dist < 0.35)
      const shouldDebuff = bHp > 0.45 && tHp > 0.25 && dist < 0.40;
      const pot  = shouldDebuff ? clamp(0.60+(bHp-0.45)*0.5+(0.40-dist)*0.5,0.40,0.90) : 0;
      const atk  = dist < 0.25 && cd > 0.85 && !pot ? 0.80 : (pot ? 0.30 : 0);
      label([dist,bHp,tHp,hpDiff,hunger,1,0,0,0,cd,0,0.15],atk,0,0,0,pot,0,0.10);
    }

    // ── Эконом-режим (не тратить бафы) ─────────────────────────────────
    for (let i = 0; i < 15000; i++) {
      const dist   = rnd(0.05, 0.50);
      const bHp    = rnd(0.40, 1.0);
      const tHp    = rnd(0.01, 0.25);  // враг почти мёртв
      const hunger = rnd(0.60, 1.0);
      const cd     = rnd(0.70, 1.0);
      const hpDiff = clamp((bHp-tHp)/2+0.5,0,1);
      // Враг слабый — просто добиваем, не тратим ресурсы
      const atk = 1.0;
      label([dist,bHp,tHp,hpDiff,hunger,1,0,0,1,cd,0,0.05],atk,0,0,0,0,0,0.05);
    }

    // ── Timing зелий (не бросать под CD удара) ──────────────────────────
    for (let i = 0; i < 20000; i++) {
      const dist   = rnd(0.05, 0.30);
      const bHp    = rnd(0.35, 1.0);
      const tHp    = rnd(0.20, 0.90);
      const hunger = rnd(0.50, 1.0);
      const cd     = rnd(0.0, 1.0);
      const hasBf  = pick([0,1]);
      const hpDiff = clamp((bHp-tHp)/2+0.5,0,1);
      // CD готов → атакуем. CD не готов → можно применить зелье
      const readyToAtk = cd > 0.88 && dist < 0.22;
      const atk  = readyToAtk ? clamp(cd*0.90,0.70,0.98) : 0;
      const perk = !readyToAtk && hasBf && bHp > 0.55 ? clamp(0.50+(1-cd)*0.30,0.35,0.85) : 0;
      const pot  = !readyToAtk && !perk && dist < 0.30 ? 0.35 : 0;
      label([dist,bHp,tHp,hpDiff,hunger,1,0,0,hasBf,cd,0,0.1],atk,0,0,0,pot,perk,0.10);
    }

    // ── Абсорбция перед боем (вход в бой с щитом) ───────────────────────
    for (let i = 0; i < 15000; i++) {
      const dist   = rnd(0.30, 0.80);
      const bHp    = rnd(0.70, 1.0);
      const tHp    = rnd(0.30, 1.0);
      const hunger = rnd(0.70, 1.0);
      const cd     = rnd(0.0, 0.60);
      const hpDiff = clamp((bHp-tHp)/2+0.5,0,1);
      // Пока далеко и CD не готов — накидываем абсорбцию
      const perk = dist > 0.35 && cd < 0.55 ? clamp(0.65+(0.55-cd)*0.4,0.50,0.90) : 0;
      const str  = dist > 0.30 ? clamp(0.70+(1-dist)*0.20,0.55,0.90) : 0;
      label([dist,bHp,tHp,hpDiff,hunger,1,0,0,1,cd,0,0.1],0,0,0,0,0,perk,str);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // +350 000 УНИВЕРСАЛЬНЫХ PVP СЦЕНАРИЕВ (полное покрытие)
  // ═══════════════════════════════════════════════════════════════════════════
  {
    const rnd = (a,b) => a + Math.random()*(b-a);
    const pick = arr => arr[Math.floor(Math.random()*arr.length)];

    // Блок A: полное случайное покрытие пространства состояний — 100 000
    for (let i = 0; i < 100000; i++) {
      const dist=rnd(0,1), bHp=rnd(0,1), tHp=rnd(0,1), hunger=rnd(0,1);
      const sword=pick([0,1]), food=pick([0,1]), hasHeal=pick([0,1]);
      const hasBuff=pick([0,1]), cd=rnd(0,1), ally=rnd(0,0.8), enemy=rnd(0,0.8);
      const hpDiff=clamp((bHp-tHp)/2+0.5,0,1);
      let atk=0,ret=0,eat=0,heal=0,pot=0,perk=0,str=0;
      if (bHp<0.08)                         { ret=0.9; heal=hasHeal?0.92:0; eat=food&&!heal?0.70:0; }
      else if (bHp<0.22&&hasHeal)           { heal=clamp(0.72+(0.22-bHp)*2.5,0.6,0.92); ret=0.35; }
      else if (bHp<0.40&&food&&hunger<0.45) { eat=clamp(0.60+(0.40-bHp)*1.5,0.45,0.85); str=0.15; }
      else if (dist<0.28&&cd>0.78&&sword)   { atk=clamp(cd*0.88+(1-dist)*0.10,0.58,0.98); str=0.12; }
      else if (dist>0.38)                   { str=clamp(0.72+dist*0.18,0.68,0.98); atk=0; }
      else                                  { str=clamp((1-cd)*0.65+0.22,0.28,0.82); atk=cd>0.65?cd*0.52:0; }
      if (hasBuff&&bHp>0.62&&!heal)         { perk=0.52; }
      if (ally>0.28)                        { atk=clamp(atk*1.22,0,1); ret*=0.58; }
      if (enemy>0.48&&bHp<0.50)             { ret=clamp(ret+enemy*0.22,0,0.95); }
      label([dist,bHp,tHp,hpDiff,hunger,sword,food,hasHeal,hasBuff,cd,ally,enemy],atk,ret,eat,heal,pot,perk,str);
    }

    // Блок B: ближний бой (dist < 0.30) — 60 000
    for (let i = 0; i < 60000; i++) {
      const dist   = rnd(0.02, 0.28);
      const bHp    = rnd(0.15, 1.0);
      const tHp    = rnd(0.05, 1.0);
      const hunger = rnd(0.40, 1.0);
      const cd     = rnd(0.55, 1.0);
      const hasBf  = pick([0,1]);
      const hpDiff = clamp((bHp-tHp)/2+0.5,0,1);
      const finish = tHp < 0.12;
      const atk = finish ? 1.0 : clamp(cd*(0.85+(0.28-dist)*0.5+(bHp-0.15)*0.3),0.55,0.98);
      const str = finish ? 0 : clamp(0.10+(1-cd)*0.20,0.05,0.35);
      const perk = hasBf&&bHp>0.60&&!finish ? 0.42 : 0;
      label([dist,bHp,tHp,hpDiff,hunger,1,0,0,hasBf,cd,0,0.1],atk,0,0,0,0,perk,str);
    }

    // Блок C: средняя дистанция W-tap стайл (0.15-0.40) — 60 000
    for (let i = 0; i < 60000; i++) {
      const dist   = rnd(0.15, 0.40);
      const bHp    = rnd(0.25, 1.0);
      const tHp    = rnd(0.10, 1.0);
      const hunger = rnd(0.50, 1.0);
      const cd     = rnd(0.0, 1.0);
      const hpDiff = clamp((bHp-tHp)/2+0.5,0,1);
      const readyAtk = cd > 0.82 && bHp > 0.25;
      const atk = readyAtk ? clamp(cd*0.88,0.55,0.95) : 0;
      const str = !readyAtk ? clamp(0.60+(1-cd)*0.25+(dist-0.15)*0.5,0.45,0.92) : 0.15;
      label([dist,bHp,tHp,hpDiff,hunger,1,0,0,0,cd,0,0.12],atk,0,0,0,0,0,str);
    }

    // Блок D: кризисные ситуации (bHp < 0.20) — 50 000
    for (let i = 0; i < 50000; i++) {
      const dist   = rnd(0.0, 0.80);
      const bHp    = rnd(0.03, 0.20);
      const tHp    = rnd(0.10, 1.0);
      const hunger = rnd(0.0, 1.0);
      const cd     = rnd(0.0, 1.0);
      const hasHl  = pick([0,1]);
      const hasFd  = pick([0,1]);
      const hpDiff = clamp((bHp-tHp)/2+0.5,0,1);
      const urg    = clamp((0.20-bHp)/0.20, 0, 1);
      const heal   = hasHl ? clamp(urg*0.88+0.10,0.45,0.95) : 0;
      const eat    = hasFd&&!heal ? clamp(urg*0.70+0.10,0.35,0.85) : 0;
      const ret    = (!heal&&!eat) ? clamp(urg*0.82+0.12,0.30,0.95) : clamp(urg*0.35,0.05,0.55);
      const atk    = !ret&&!heal&&!eat&&tHp<0.10 ? 0.85 : 0;
      label([dist,bHp,tHp,hpDiff,hunger,1,hasFd,hasHl,0,cd,0,0.1],atk,ret,eat,heal,0,0,0);
    }

    // Блок E: дальняя дистанция (0.40-1.0) — 40 000
    for (let i = 0; i < 40000; i++) {
      const dist   = rnd(0.40, 1.0);
      const bHp    = rnd(0.20, 1.0);
      const tHp    = rnd(0.10, 1.0);
      const hunger = rnd(0.40, 1.0);
      const cd     = rnd(0.0, 0.80);
      const hasBf  = pick([0,1]);
      const hpDiff = clamp((bHp-tHp)/2+0.5,0,1);
      // Бежим к цели, применяем бафы пока CD восстанавливается
      const str  = clamp(0.75+(1-dist)*0.20,0.60,0.98);
      const perk = hasBf&&bHp>0.55&&cd<0.60 ? clamp(0.55+(0.60-cd)*0.40,0.40,0.85) : 0;
      label([dist,bHp,tHp,hpDiff,hunger,1,0,0,hasBf,cd,0,0.1],0,0,0,0,0,perk,str);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // +360 000 НОВЫХ СЦЕНАРИЕВ v4.0 — полное покрытие паттернов движения/атаки
  // ═══════════════════════════════════════════════════════════════════════════
  {
    const rnd  = (a,b) => a + Math.random()*(b-a);
    const pick = arr  => arr[Math.floor(Math.random()*arr.length)];

    // ── БЛОК P: 90 000 — точный тайминг атаки (CD-оптимизация) ─────────────
    // Цель: научить бота ВСЕГДА атаковать когда CD >= 0.85 + dist <= 0.30
    // и НИКОГДА не атаковать раньше (потеря урона из-за сниженного CD)
    for (let i = 0; i < 90000; i++) {
      const dist   = rnd(0.02, 0.35);
      const bHp    = rnd(0.20, 1.0);
      const tHp    = rnd(0.05, 1.0);
      const hunger = rnd(0.50, 1.0);
      const cd     = rnd(0.0, 1.0);
      const hasBf  = pick([0,1]);
      const hpDiff = clamp((bHp-tHp)/2+0.5,0,1);

      let atk = 0, str = 0, perk = 0;
      if (cd >= 0.90 && dist <= 0.28) {
        // Идеальный удар: CD полный + близко
        atk = clamp(cd * 0.97 + (1-tHp)*0.03, 0.85, 1.0);
        str = tHp < 0.12 ? 0 : 0.05;  // не страфим при добивании
      } else if (cd >= 0.80 && dist <= 0.22) {
        // Почти готов + вплотную — бьём
        atk = clamp(cd * 0.92, 0.72, 0.97);
        str = 0.10;
      } else if (cd >= 0.70 && dist <= 0.15) {
        // Средний CD + вплотную — слабый удар но бьём
        atk = clamp(cd * 0.82, 0.55, 0.90);
        str = 0.18;
      } else if (cd < 0.70) {
        // CD не готов — страфим
        str = clamp((1-cd)*0.75+0.25, 0.30, 0.95);
        atk = 0;
      } else {
        // CD готов но далеко — сближаемся
        str = clamp(0.60+(dist-0.28)*0.8, 0.50, 0.92);
        atk = 0;
      }
      if (hasBf && bHp > 0.70 && atk < 0.3) perk = 0.45;
      label([dist,bHp,tHp,hpDiff,hunger,1,0,0,hasBf,cd,0,0.1], atk,0,0,0,0,perk,str);
    }

    // ── БЛОК Q: 90 000 — выживание под давлением ────────────────────────────
    // Несколько врагов + низкое HP → точные решения: лечиться/есть/отступать
    for (let i = 0; i < 90000; i++) {
      const dist   = rnd(0.0, 0.90);
      const bHp    = rnd(0.0, 0.45);   // всегда низкое HP
      const tHp    = rnd(0.10, 1.0);
      const hunger = rnd(0.0, 0.80);
      const cd     = rnd(0.0, 1.0);
      const enemy  = rnd(0.15, 1.0);   // есть враги
      const ally   = rnd(0.0, 0.50);
      const hasHl  = pick([0,1]);
      const hasFd  = pick([0,1]);
      const hpDiff = clamp((bHp-tHp)/2+0.5,0,1);

      let atk=0, ret=0, eat=0, heal=0, str=0;
      const pressure = clamp(enemy*(1-bHp*2), 0, 1);

      if (bHp < 0.07) {
        // Умираем: только спасаться
        heal = hasHl ? clamp(0.90+(0.07-bHp)*5, 0.85, 0.99) : 0;
        ret  = !heal ? 0.97 : clamp(0.60-ally*0.3, 0.25, 0.80);
      } else if (bHp < 0.20 && hasHl) {
        heal = clamp(0.78+(0.20-bHp)*2.5, 0.65, 0.94);
        ret  = clamp(0.40+pressure*0.35, 0.20, 0.80);
      } else if (bHp < 0.35 && hasFd && hunger < 0.55) {
        eat  = clamp(0.65+(0.35-bHp)*1.8, 0.45, 0.88);
        ret  = pressure > 0.5 ? clamp(pressure*0.55, 0.25, 0.70) : 0;
      } else if (bHp < 0.45 && enemy > 0.60) {
        // Несколько врагов + среднее HP → отступаем
        ret  = clamp(0.35+pressure*0.50, 0.25, 0.88);
        str  = clamp(0.40-ret*0.25, 0.10, 0.55);
        atk  = ally > 0.40 && dist < 0.20 && cd > 0.88 ? 0.55 : 0;
      } else {
        // Среднее HP + нормальное давление — атакуем если CD готов
        atk  = dist < 0.28 && cd > 0.82 ? clamp(cd*0.85, 0.55, 0.92) : 0;
        str  = !atk ? clamp(0.55+(1-cd)*0.35, 0.35, 0.88) : 0.12;
        ret  = 0;
      }
      if (ally > 0.35) { atk = clamp(atk*1.20, 0, 1.0); ret = clamp(ret*0.65, 0, 1); }
      label([dist,bHp,tHp,hpDiff,hunger,1,hasFd,hasHl,0,cd,ally,enemy], atk,ret,eat,heal,0,0,str);
    }

    // ── БЛОК R: 90 000 — добивание (kill confirmation) ───────────────────────
    // Враг на ≤20% HP → максимальная атака НЕСМОТРЯ на своё HP
    for (let i = 0; i < 90000; i++) {
      const dist   = rnd(0.0, 0.50);
      const bHp    = rnd(0.15, 1.0);
      const tHp    = rnd(0.01, 0.20);  // враг почти мёртв
      const hunger = rnd(0.40, 1.0);
      const cd     = rnd(0.60, 1.0);  // CD почти всегда готов
      const hasHl  = pick([0,1]);
      const hpDiff = clamp((bHp-tHp)/2+0.5,0,1);

      let atk = 0, str = 0, heal = 0, ret = 0;

      if (dist > 0.30) {
        // Догоняем убегающего врага — максимальный стрейф
        str = clamp(0.88 + (1-dist)*0.10, 0.75, 0.98);
        atk = dist < 0.38 && cd > 0.90 ? 0.65 : 0;
      } else if (bHp < 0.12 && hasHl && tHp > 0.08) {
        // Мы сами умираем — сначала хил, потом добиваем
        heal = clamp(0.82+(0.12-bHp)*5, 0.75, 0.97);
        ret  = 0.25;
      } else {
        // Добиваем! Все ресурсы на атаку
        const tPercent = tHp / 0.20; // 0=совсем мёртв, 1=20%HP
        atk = clamp(cd * (1.0 - tPercent*0.08), 0.80, 1.0);
        str = tHp < 0.07 ? 0 : 0.04;  // совсем не страфим при 1HP
      }
      label([dist,bHp,tHp,hpDiff,hunger,1,0,hasHl,0,cd,0,0.1], atk,ret,0,heal,0,0,str);
      // Вариант с тотемом (tHp почти 0 — враг активирует тотем — не останавливаемся)
      if (tHp < 0.05) {
        label([dist,bHp,0.01,hpDiff,hunger,1,0,0,0,cd,0,0.1], 1.0,0,0,0,0,0,0);
      }
    }

    // ── БЛОК S: 90 000 — мастерство движения ─────────────────────────────────
    // Обучаем: когда двигаться, куда, как быстро — по дистанции и CD
    for (let i = 0; i < 90000; i++) {
      const dist   = rnd(0.0, 1.0);
      const bHp    = rnd(0.25, 1.0);
      const tHp    = rnd(0.10, 1.0);
      const hunger = rnd(0.50, 1.0);
      const cd     = rnd(0.0, 1.0);
      const sword  = pick([0,1]);
      const hpDiff = clamp((bHp-tHp)/2+0.5,0,1);

      let atk = 0, str = 0;

      if (dist > 0.80) {
        // Очень далеко — бежим без остановок
        str = clamp(0.92 + (1-dist)*0.07, 0.85, 1.0);
        atk = 0;
      } else if (dist > 0.50) {
        // Далеко — бежим, можем применять бафы
        str = clamp(0.80 + (1-dist)*0.12, 0.72, 0.92);
        atk = (dist < 0.55 && cd > 0.93 && sword) ? 0.28 : 0;
      } else if (dist > 0.30) {
        // Средняя дистанция — смотрим CD
        if (cd > 0.82 && sword) {
          str = 0.30;  // сближаемся немного
          atk = clamp(cd*0.75, 0.55, 0.88);
        } else {
          str = clamp(0.55 + (0.80-cd)*0.35, 0.40, 0.88);
          atk = 0;
        }
      } else if (dist > 0.18) {
        // Ближняя дистанция
        if (cd > 0.78 && sword) {
          atk = clamp(cd*0.90, 0.65, 0.97);
          str = 0.12;
        } else {
          // CD не готов — страфим вокруг цели
          str = clamp(0.60 + (0.78-cd)*0.55, 0.35, 0.90);
          atk = 0;
        }
      } else {
        // Вплотную — атакуем или страфим
        if (cd > 0.72 && sword) {
          atk = clamp(cd*0.94, 0.70, 0.98);
          str = 0.04;
        } else {
          str = clamp(0.45 + (0.72-cd)*0.70, 0.28, 0.82);
          atk = cd > 0.55 ? cd*0.35 : 0;
        }
      }
      label([dist,bHp,tHp,hpDiff,hunger,sword,0,0,0,cd,rnd(0,0.5),rnd(0,0.3)], atk,0,0,0,0,0,str);
    }
  }

  log.info(`[PvpBrain] Сгенерировано ${data.length} обучающих сценариев`);
  return data;
}

// ─── Класс PvpBrain ───────────────────────────────────────────────────────
class PvpBrain {
  constructor() {
    this.net = null;
    this.ready = false;
    this._onProgress = null; // (pct, msg) => void
    this._onReady = null;    // () => void
    this._initNet();
  }

  // ── Инициализация: если веса есть — грузим мгновенно, иначе обучаем async
  _initNet() {
    if (!brain) { this.net = null; return; }
    this.net = new brain.NeuralNetwork({
      hiddenLayers: [24, 18, 12],
      activation:   "sigmoid",
      learningRate: 0.05,
      momentum:     0.1,
    });

    // Загружаем веса — мгновенно, UI не зависает
    try {
      if (fs.existsSync(WEIGHTS_PATH)) {
        const w = JSON.parse(fs.readFileSync(WEIGHTS_PATH, "utf8"));
        this.net.fromJSON(w);
        log.info("[PvpBrain] ✅ Веса загружены мгновенно");
        this.ready = true;
        return;
      }
    } catch (e) {
      log.warn("[PvpBrain] Веса не загружены:", e.message);
    }

    // Первый запуск — обучаем АСИНХРОННО (UI не зависает!)
    this.ready = false;
    log.info("[PvpBrain] Первый запуск — асинхронное обучение...");
    setImmediate(() => this._trainAsync());
  }

  async _trainAsync() {
    try {
      // Берём 80 000 случайных сценариев из всего пула (быстрее и достаточно)
      const all  = buildSeedData();
      const n    = Math.min(200000, all.length);  // увеличен лимит для 1M+ пула
      // Перемешиваем и берём n сэмплов
      for (let i = all.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [all[i], all[j]] = [all[j], all[i]];
      }
      const data = all.slice(0, n);
      log.info(`[PvpBrain] Обучаем на ${n} сценариях (async)...`);

      // trainAsync — НЕ блокирует UI
      await this.net.trainAsync(data, {
        iterations:  600,
        errorThresh: 0.005,
        logPeriod:   100,
        log: (s) => log.info("[PvpBrain] train:", s),
      });

      // Сохраняем веса
      try {
        fs.writeFileSync(WEIGHTS_PATH, JSON.stringify(this.net.toJSON()), "utf8");
        log.info("[PvpBrain] ✅ Веса сохранены. Следующий запуск будет мгновенным.");
      } catch (e) { log.warn("[PvpBrain] Не сохранить веса:", e.message); }
      this.ready = true;
    } catch (e) {
      log.error("[PvpBrain] Ошибка обучения:", e.message);
      this.ready = true; // fallback — работаем на эвристике
    }
  }

  decide(bot, target, teammates = [], extra = {}) {
    const features = getBotFeatures(bot, target, teammates);
    if (!features) return { action: "attack", confidence: 0.5, features };

    const ACTIONS = ["attack","retreat","eat","throwHeal","throwPotion","throwPerk","strafe"];

    // Нейросеть
    if (this.net) {
      try {
        const out = this.net.run(features);
        const scores = ACTIONS.map((a, i) => ({ action: a, score: out[i] || 0 }));
        scores.sort((a, b) => b.score - a.score);
        const best = scores[0];
        return { action: best.action, confidence: best.score, features };
      } catch (e) {
        log.debug("[PvpBrain] run error:", e.message);
      }
    }

    // Эвристика (фоллбэк)
    return this._heuristic(features, bot, target, extra);
  }

  _heuristic(f, bot, target, extra = {}) {
    const [dist, botHp, tgtHp, hpDiff, hunger, sword, food, heal, buff, cd, ally, enemy] = f;
    const ACTIONS = ["attack","retreat","eat","throwHeal","throwPotion","throwPerk","strafe"];

    if (botHp < 0.1) return { action: heal ? "throwHeal" : (food ? "eat" : "retreat"), confidence: 0.9, features: f };
    if (botHp < 0.25 && heal) return { action: "throwHeal", confidence: 0.8, features: f };
    if (botHp < 0.4 && food && hunger < 0.7) return { action: "eat", confidence: 0.75, features: f };
    if (dist < 0.35 && cd > 0.75 && sword) return { action: "attack", confidence: cd * 0.9, features: f };
    if (dist > 0.35) return { action: "strafe", confidence: 0.8, features: f };
    if (cd < 0.5) return { action: "strafe", confidence: 0.85, features: f };
    return { action: "attack", confidence: 0.5, features: f };
  }

  recordExperience(features, actionMap, wasGood) {
    if (!this.net || !features) return;
    // Онлайн-обучение: усиливаем/ослабляем действие
    try {
      const ACTIONS = ["attack","retreat","eat","throwHeal","throwPotion","throwPerk","strafe"];
      const current = this.net.run(features);
      const target  = [...current];
      ACTIONS.forEach((a, i) => {
        if (actionMap[a]) target[i] = clamp(current[i] + (wasGood ? 0.08 : -0.05), 0, 1);
      });
      this.net.train([{ input: features, output: target }], { iterations: 3, errorThresh: 0.05 });
    } catch {}
  }
}

module.exports = { PvpBrain };
