/**
 * PvpBrain v5 — нейросеть PVP, 100000+ обучающих сценариев (генерация)
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

  log.info(`[PvpBrain] Сгенерировано ${data.length} обучающих сценариев`);
  return data;
}

// ─── Класс PvpBrain ───────────────────────────────────────────────────────
class PvpBrain {
  constructor() {
    this.net = null;
    this._initNet();
  }

  _initNet() {
    if (!brain) { this.net = null; return; }
    this.net = new brain.NeuralNetwork({
      hiddenLayers:    [24, 18, 12],
      activation:      "sigmoid",
      learningRate:    0.05,
      momentum:        0.1,
      errorThresh:     0.003,
    });

    // Загружаем сохранённые веса
    try {
      if (fs.existsSync(WEIGHTS_PATH)) {
        const w = JSON.parse(fs.readFileSync(WEIGHTS_PATH, "utf8"));
        this.net.fromJSON(w);
        log.info("[PvpBrain] Загружены веса из файла");
        return;
      }
    } catch (e) {
      log.warn("[PvpBrain] Не удалось загрузить веса:", e.message);
    }

    // Обучение
    log.info("[PvpBrain] Запускаем обучение (10000+ сценариев)...");
    const data = buildSeedData();
    try {
      this.net.train(data, {
        iterations:    25000,
        errorThresh:   0.003,
        logPeriod:     4000,
        log: (s) => log.info("[PvpBrain] train:", s),
      });
      // Сохраняем веса
      try {
        fs.writeFileSync(WEIGHTS_PATH, JSON.stringify(this.net.toJSON()), "utf8");
        log.info("[PvpBrain] Веса сохранены →", WEIGHTS_PATH);
      } catch (e) { log.warn("[PvpBrain] Не сохранить веса:", e.message); }
    } catch (e) {
      log.error("[PvpBrain] Ошибка обучения:", e.message);
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
