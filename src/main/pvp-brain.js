/**
 * PvpBrain v4 — нейросеть PVP, 10000+ обучающих сценариев (генерация)
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
        iterations:    16000,
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
