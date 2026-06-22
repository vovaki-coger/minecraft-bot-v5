/**
 * PvpBrain v3 — нейросеть PVP, 500 обучающих сценариев
 *
 * Архитектура: brain.js NeuralNetwork 12→24→18→12→7
 * Входной вектор (12 признаков):
 *   0  — дистанция (норм 0-1, max=10)
 *   1  — HP бота (0-1)
 *   2  — HP цели (0-1)
 *   3  — HP разница бот-цель (0..1, 0.5 = равны)
 *   4  — голод бота (0-1)
 *   5  — есть ли меч/топор в руке (0/1)
 *   6  — есть ли еда в инвентаре (0/1)
 *   7  — есть ли хил-зелье (0/1)
 *   8  — есть ли бафф-зелье (0/1)
 *   9  — кулдаун атаки (0-1, 1=готов)
 *   10 — союзники рядом (0-1, max=5)
 *   11 — враги рядом (0-1, max=5)
 *
 * Выходной вектор (7 действий):
 *   0 — attack       1 — retreat
 *   2 — eat          3 — throwHeal
 *   4 — throwPotion  5 — throwPerk
 *   6 — strafe
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
const HEAL_NAMES  = ["potion_of_healing","splash_potion_of_healing","potion_of_regeneration","splash_potion_of_regeneration","potion_of_instant_health"];
const BUFF_NAMES  = ["potion_of_strength","splash_potion_of_strength","potion_of_speed","splash_potion_of_speed"];
const FOOD_NAMES  = ["apple","golden_apple","enchanted_golden_apple","bread","cooked_beef","cooked_porkchop","cooked_chicken","cooked_mutton","cooked_rabbit","carrot","baked_potato","cookie","melon_slice","pumpkin_pie","mushroom_stew","cooked_salmon","cooked_cod"];

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function getBotFeatures(bot, target, teammates = []) {
  if (!bot?.entity || !target?.position) return null;

  const dist     = bot.entity.position.distanceTo(target.position);
  const heldItem = bot.heldItem;

  const items   = bot.inventory.items();
  const hasSword = heldItem
    ? (SWORD_NAMES.some(n => heldItem.name.includes(n)) || AXE_NAMES.some(n => heldItem.name.includes(n)))
    : false;
  const hasFood  = items.some(i => FOOD_NAMES.includes(i.name));
  const hasHeal  = items.some(i => HEAL_NAMES.some(n => i.name.includes(n.replace("potion_of_","").replace("splash_",""))));
  const hasBuff  = items.some(i => BUFF_NAMES.some(n => i.name.includes(n.replace("potion_of_","").replace("splash_",""))));

  const attackCd = heldItem
    ? clamp((Date.now() - (bot._lastAttackTime || 0)) / 620, 0, 1)
    : 1;

  const allies = Object.values(bot.entities || {}).filter(e => {
    if (!e.position || e === bot.entity) return false;
    return teammates.includes(e.username);
  }).length;

  const enemies = Object.values(bot.entities || {}).filter(e => {
    if (!e.position || e === bot.entity) return false;
    if (teammates.includes(e.username)) return false;
    return (e.type === "player" || e.type === "mob") &&
      e.position.distanceTo(bot.entity.position) < 10;
  }).length;

  return [
    clamp(dist / 10, 0, 1),
    clamp(bot.health / 20, 0, 1),
    clamp((target.health || 20) / 20, 0, 1),
    clamp((bot.health - (target.health || 20)) / 20 + 0.5, 0, 1),
    clamp((bot.food || 20) / 20, 0, 1),
    hasSword ? 1 : 0,
    hasFood  ? 1 : 0,
    hasHeal  ? 1 : 0,
    hasBuff  ? 1 : 0,
    attackCd,
    clamp(allies  / 5, 0, 1),
    clamp(enemies / 5, 0, 1),
  ];
}

// ─── 500 обучающих сценариев ──────────────────────────────────────────────
function buildSeedData() {
  const data = [];

  // [dist,botHp,tgtHp,hpDiff,hunger,sword,food,heal,buff,cd,ally,enemy]
  // output: [attack,retreat,eat,throwHeal,throwPotion,throwPerk,strafe]
  function s(input, output) {
    const hpDiff = clamp((input[1] - input[2]) / 2 + 0.5, 0, 1);
    const inp = [
      clamp(input[0],0,1), // dist
      clamp(input[1],0,1), // botHp
      clamp(input[2],0,1), // tgtHp
      hpDiff,              // hpDiff
      clamp(input[3],0,1), // hunger
      input[4] ? 1 : 0,   // sword
      input[5] ? 1 : 0,   // food
      input[6] ? 1 : 0,   // heal
      input[7] ? 1 : 0,   // buff
      clamp(input[8],0,1), // cd
      clamp(input[9],0,1), // ally
      clamp(input[10],0,1),// enemy
    ];
    data.push({ input: inp, output: output.map(v => clamp(v, 0, 1)) });
  }
  // shorthand: s([dist, botHp, tgtHp, hunger, sword, food, heal, buff, cd, ally, enemy], [a,r,e,h,p,k,st])

  // ════════════════════════════════════════════════════════════════════
  // 1. АТАКА — близко + кулдаун готов + меч + достаточно HP (~130)
  // ════════════════════════════════════════════════════════════════════

  // Классическая атака: близко, кулдаун готов
  for (const d of [0.05, 0.1, 0.15, 0.2, 0.25, 0.3]) {
    for (const bHp of [0.6, 0.7, 0.8, 0.9, 1.0]) {
      for (const tHp of [0.2, 0.4, 0.6, 0.8, 1.0]) {
        const finish = tHp <= 0.15;
        const atk = finish ? 1.0 : (d <= 0.2 ? 0.95 : 0.85);
        const strf = d >= 0.25 ? 0.2 : 0.05;
        s([d, bHp, tHp, 0.85, true, false, false, false, 1.0, 0, 0.2],
          [atk, 0, 0, 0, 0, 0, strf]);
      }
    }
  }

  // Кулдаун почти готов (0.8-0.95)
  for (const d of [0.1, 0.15, 0.2]) {
    for (const bHp of [0.7, 0.8, 0.9]) {
      for (const cd of [0.8, 0.85, 0.9, 0.95]) {
        s([d, bHp, 0.5, 0.8, true, false, false, false, cd, 0, 0.2],
          [cd * 0.95, 0, 0, 0, 0, 0, (1 - cd) * 0.5]);
      }
    }
  }

  // Добивание — цель почти мертва
  for (const d of [0.05, 0.1, 0.12, 0.18, 0.2]) {
    for (const tHp of [0.05, 0.08, 0.1, 0.12]) {
      for (const bHp of [0.3, 0.5, 0.7, 0.9]) {
        s([d, bHp, tHp, 0.8, true, false, false, false, 1.0, 0, 0.1],
          [1.0, 0, 0, 0, 0, 0, 0]);
      }
    }
  }

  // С союзниками — агрессивнее
  for (const d of [0.1, 0.15, 0.2]) {
    for (const ally of [0.2, 0.4, 0.6]) {
      s([d, 0.7, 0.5, 0.85, true, false, false, false, 1.0, ally, 0.2],
        [1.0, 0, 0, 0, 0, 0, 0.1]);
      s([d, 0.8, 0.6, 0.85, true, false, false, false, 0.9, ally, 0.2],
        [0.9, 0, 0, 0, 0, 0, 0.2]);
    }
  }

  // Атака с перком
  for (const d of [0.1, 0.15, 0.2]) {
    for (const bHp of [0.7, 0.8, 0.9]) {
      s([d, bHp, 0.5, 0.85, true, false, false, true, 1.0, 0, 0.2],
        [0.9, 0, 0, 0, 0, 0.85, 0.1]);
      s([d, bHp, 0.4, 0.85, true, false, false, true, 0.9, 0, 0.2],
        [0.8, 0, 0, 0, 0, 0.7, 0.2]);
    }
  }

  // ════════════════════════════════════════════════════════════════════
  // 2. СТРЕЙФ — кулдаун не готов / далеко от цели (~90)
  // ════════════════════════════════════════════════════════════════════

  // Кулдаун не готов — ждём и стрейфим
  for (const d of [0.1, 0.15, 0.2, 0.25]) {
    for (const bHp of [0.6, 0.7, 0.8, 0.9]) {
      for (const cd of [0.0, 0.1, 0.2, 0.3, 0.4]) {
        const atk = cd * 0.3;
        s([d, bHp, 0.5, 0.8, true, false, false, false, cd, 0, 0.2],
          [atk, 0, 0, 0, 0, 0, 1.0 - cd * 0.5]);
      }
    }
  }

  // Далеко — сближаемся через стрейф
  for (const d of [0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0]) {
    for (const bHp of [0.6, 0.7, 0.8, 0.9]) {
      s([d, bHp, 0.5, 0.8, true, false, false, false, 0.5, 0, 0.1],
        [0, 0, 0, 0, 0, 0, 1.0]);
      s([d, bHp, 0.5, 0.8, false, false, false, false, 0.5, 0, 0.1],
        [0, 0, 0, 0, 0.2, 0, 1.0]);
    }
  }

  // Нет меча — только стрейф и зелья
  for (const d of [0.2, 0.3, 0.4]) {
    for (const bHp of [0.7, 0.8, 0.9]) {
      s([d, bHp, 0.5, 0.8, false, false, false, false, 0.8, 0, 0.3],
        [0, 0, 0, 0, 0.3, 0, 0.9]);
      s([d, bHp, 0.4, 0.8, false, true, false, false, 0.6, 0, 0.2],
        [0, 0, 0.2, 0, 0.3, 0, 0.8]);
    }
  }

  // ════════════════════════════════════════════════════════════════════
  // 3. ОТСТУПЛЕНИЕ — мало HP / окружён (~80)
  // ════════════════════════════════════════════════════════════════════

  // Критически мало HP (< 25%) — отступаем
  for (const d of [0.1, 0.2, 0.3, 0.4]) {
    for (const bHp of [0.05, 0.1, 0.15, 0.2]) {
      for (const enemy of [0.2, 0.4, 0.6]) {
        s([d, bHp, 0.6, 0.7, true, false, false, false, 0.5, 0, enemy],
          [0, 1.0, 0, 0, 0, 0, 0]);
        s([d, bHp, 0.7, 0.6, false, false, false, false, 0.5, 0, enemy],
          [0, 1.0, 0, 0, 0, 0, 0]);
      }
    }
  }

  // Мало HP, нет хила, нет еды
  for (const bHp of [0.15, 0.2, 0.25]) {
    for (const tHp of [0.5, 0.7, 0.9]) {
      s([0.2, bHp, tHp, 0.5, true, false, false, false, 0.5, 0, 0.4],
        [0, 1.0, 0, 0, 0, 0, 0]);
      s([0.3, bHp, tHp, 0.5, false, false, false, false, 0.5, 0, 0.3],
        [0, 1.0, 0, 0, 0, 0, 0]);
    }
  }

  // Много врагов — отступаем даже при среднем HP
  for (const enemy of [0.6, 0.8, 1.0]) {
    for (const bHp of [0.3, 0.4, 0.5, 0.6]) {
      s([0.3, bHp, 0.5, 0.8, true, false, false, false, 0.6, 0, enemy],
        [0, 1.0, 0, 0, 0.3, 0, 0]);
      s([0.4, bHp, 0.6, 0.7, true, false, false, false, 0.5, 0, enemy],
        [0, 0.9, 0, 0, 0.4, 0, 0]);
    }
  }

  // Нет меча + мало HP + много врагов
  for (const bHp of [0.2, 0.3, 0.4]) {
    for (const enemy of [0.4, 0.6, 0.8]) {
      s([0.3, bHp, 0.6, 0.5, false, false, false, false, 0.5, 0, enemy],
        [0, 1.0, 0, 0, 0, 0, 0]);
    }
  }

  // ════════════════════════════════════════════════════════════════════
  // 4. ЕДА — голодный (~70)
  // ════════════════════════════════════════════════════════════════════

  // Критический голод (< 20%) + еда есть
  for (const hunger of [0.0, 0.05, 0.1, 0.15]) {
    for (const d of [0.3, 0.4, 0.5, 0.6]) {
      for (const bHp of [0.6, 0.7, 0.8]) {
        s([d, bHp, 0.5, 0.8, true, true, false, false, 0.5, 0, 0.1],
          [0, 0, 1.0, 0, 0, 0, 0.2]);
        s([d, bHp, 0.4, 0.85, false, true, false, false, 0.5, 0, 0.1],
          [0, 0, 1.0, 0, 0, 0, 0]);
      }
    }
  }

  // Умеренный голод (20-40%) + далеко от врага
  for (const hunger of [0.2, 0.25, 0.3, 0.35]) {
    for (const d of [0.5, 0.6, 0.7]) {
      s([d, 0.8, 0.5, 0.8, true, true, false, false, 0.5, 0, 0.1],
        [0, 0, 0.8, 0, 0, 0, 0.4]);
      s([d, 0.9, 0.4, 0.85, true, true, false, false, 0.4, 0, 0.1],
        [0, 0, 0.75, 0, 0, 0, 0.5]);
    }
  }

  // Нет еды — не едим
  for (const hunger of [0.05, 0.1, 0.15]) {
    for (const d of [0.3, 0.5]) {
      s([d, 0.7, 0.5, 0.8, true, false, false, false, 0.8, 0, 0.2],
        [0.7, 0, 0, 0, 0, 0, 0.3]);
    }
  }

  // Еда + голод + мало HP — сначала поесть
  for (const hunger of [0.1, 0.15]) {
    for (const bHp of [0.3, 0.4]) {
      s([0.5, bHp, 0.6, 0.5, true, true, false, false, 0.5, 0, 0.2],
        [0, 0.3, 1.0, 0, 0, 0, 0]);
    }
  }

  // ════════════════════════════════════════════════════════════════════
  // 5. ХИЛ-ЗЕЛЬЕ (throwHeal) — мало HP + есть зелье (~65)
  // ════════════════════════════════════════════════════════════════════

  // Критически мало HP — бросаем под себя немедленно
  for (const bHp of [0.05, 0.1, 0.15]) {
    for (const d of [0.1, 0.2, 0.3, 0.4]) {
      for (const tHp of [0.4, 0.6, 0.8]) {
        s([d, bHp, tHp, 0.5, true, false, true, false, 0.4, 0, 0.3],
          [0, 1.0, 0, 1.0, 0, 0, 0]);
        s([d, bHp, tHp, 0.5, false, false, true, false, 0.4, 0, 0.2],
          [0, 1.0, 0, 1.0, 0, 0, 0]);
      }
    }
  }

  // Мало HP (15-30%) + есть хил
  for (const bHp of [0.2, 0.25, 0.3]) {
    for (const d of [0.2, 0.35, 0.5]) {
      s([d, bHp, 0.6, 0.5, true, false, true, false, 0.5, 0, 0.3],
        [0, 0.8, 0, 0.9, 0, 0, 0]);
      s([d, bHp, 0.5, 0.55, true, true, true, false, 0.4, 0, 0.2],
        [0, 0.6, 0.3, 0.85, 0, 0, 0]);
    }
  }

  // Хорошее HP — хил не нужен
  for (const bHp of [0.6, 0.7, 0.8]) {
    for (const d of [0.15, 0.25]) {
      s([d, bHp, 0.5, 0.8, true, false, true, false, 1.0, 0, 0.2],
        [0.9, 0, 0, 0, 0, 0, 0.1]);
    }
  }

  // ════════════════════════════════════════════════════════════════════
  // 6. ЗЕЛЬЕ НА ВРАГА (throwPotion) — много врагов / close combat (~50)
  // ════════════════════════════════════════════════════════════════════

  // Много врагов — AOE зелье
  for (const enemy of [0.6, 0.8, 1.0]) {
    for (const d of [0.3, 0.4, 0.5]) {
      for (const bHp of [0.5, 0.6, 0.7]) {
        s([d, bHp, 0.5, 0.8, true, false, false, false, 0.5, 0, enemy],
          [0, 0.3, 0, 0, 1.0, 0, 0]);
        s([d, bHp, 0.6, 0.7, false, false, false, false, 0.5, 0, enemy],
          [0, 0.4, 0, 0, 1.0, 0, 0]);
      }
    }
  }

  // Один враг + близко + нет меча
  for (const d of [0.2, 0.3]) {
    for (const bHp of [0.6, 0.7, 0.8]) {
      s([d, bHp, 0.5, 0.8, false, false, false, false, 0.5, 0, 0.2],
        [0, 0, 0, 0, 0.8, 0, 0.5]);
    }
  }

  // Зелье + отступ — много врагов, мало HP
  for (const bHp of [0.25, 0.3]) {
    for (const enemy of [0.6, 0.8]) {
      s([0.35, bHp, 0.6, 0.5, true, false, false, false, 0.5, 0, enemy],
        [0, 0.8, 0, 0, 0.7, 0, 0]);
    }
  }

  // ════════════════════════════════════════════════════════════════════
  // 7. ПЕРК (throwPerk) — бафф готов + хорошие условия (~50)
  // ════════════════════════════════════════════════════════════════════

  // Перк в начале боя (оба с полным HP)
  for (const d of [0.1, 0.15, 0.2]) {
    for (const bHp of [0.8, 0.9, 1.0]) {
      for (const tHp of [0.8, 0.9, 1.0]) {
        s([d, bHp, tHp, 0.8, true, false, false, true, 1.0, 0, 0.2],
          [0.8, 0, 0, 0, 0, 1.0, 0.1]);
        s([d, bHp, tHp, 0.8, true, true, false, true, 0.9, 0, 0.1],
          [0.7, 0, 0, 0, 0, 0.9, 0.2]);
      }
    }
  }

  // Перк + союзники
  for (const ally of [0.2, 0.4]) {
    for (const d of [0.15, 0.2]) {
      s([d, 0.85, 0.5, 0.8, true, false, false, true, 1.0, ally, 0.2],
        [1.0, 0, 0, 0, 0, 1.0, 0.1]);
    }
  }

  // Перк не нужен при плохом HP
  for (const bHp of [0.15, 0.2, 0.25]) {
    s([0.2, bHp, 0.7, 0.4, true, false, false, true, 0.5, 0, 0.5],
      [0, 1.0, 0, 0, 0, 0, 0]);
  }

  // ════════════════════════════════════════════════════════════════════
  // 8. КОМБО-СИТУАЦИИ — смешанные действия (~65+)
  // ════════════════════════════════════════════════════════════════════

  // Атака + стрейф одновременно
  s([0.1, 0.8, 0.5, 0.8, true, false, false, false, 1.0, 0, 0.3],  [1.0, 0, 0, 0, 0, 0, 0.3]);
  s([0.15,0.9, 0.6, 0.8, true, false, false, false, 0.95,0, 0.2],  [0.95,0, 0, 0, 0, 0, 0.2]);
  s([0.2, 0.7, 0.4, 0.8, true, false, false, false, 0.9, 0, 0.2],  [0.9, 0, 0, 0, 0, 0, 0.25]);
  s([0.05,0.9, 0.5, 0.8, true, false, false, false, 1.0, 0, 0.1],  [1.0, 0, 0, 0, 0, 0, 0.05]);
  s([0.08,1.0, 1.0, 0.5, true, false, false, false, 1.0, 0, 0.2],  [1.0, 0, 0, 0, 0, 0, 0.2]);

  // Перк + атака (перк в начале раунда)
  s([0.15,0.9, 0.5, 0.8, true, false, false, true, 1.0, 0, 0.1],   [1.0, 0, 0, 0, 0, 0.9, 0.1]);
  s([0.2, 0.85,0.4, 0.8, true, true, false, true,  0.9, 0, 0.1],   [0.85,0, 0, 0, 0, 0.8, 0.2]);
  s([0.1, 0.95,0.6, 0.8, true, false, false, true,  1.0, 0.3, 0.2],[1.0, 0, 0, 0, 0, 1.0, 0.1]);

  // Отступ + хил
  s([0.2, 0.1, 0.5, 0.3, true, false, true, false,  0.5, 0, 0.4],  [0, 1.0, 0, 1.0, 0, 0, 0]);
  s([0.15,0.15,0.7, 0.3, false, false, true, false,  0.4, 0, 0.3], [0, 1.0, 0, 1.0, 0, 0, 0]);
  s([0.25,0.2, 0.6, 0.3, true, true, true, false,  0.3, 0, 0.3],   [0, 0.9, 0, 1.0, 0, 0, 0]);
  s([0.3, 0.12,0.8, 0.25,true, false, true, false,  0.5, 0, 0.5],  [0, 1.0, 0, 1.0, 0, 0, 0]);

  // Еда + стрейф (голодный, враг далеко)
  s([0.6, 0.8, 0.5, 0.8, true, true, false, false, 0.5, 0, 0.1],   [0, 0, 0.9, 0, 0, 0, 0.5]);
  s([0.7, 0.9, 0.4, 0.85, true, true, false, false, 0.4, 0, 0.1],  [0, 0, 0.85,0, 0, 0, 0.6]);
  s([0.5, 0.7, 0.5, 0.8, false, true, false, false, 0.5, 0, 0.1],  [0, 0, 0.9, 0, 0, 0, 0.4]);

  // Середина боя (оба ~50% HP)
  s([0.2, 0.5, 0.5, 0.5, true, true, true, false, 0.9, 0, 0.2],    [0.7, 0, 0.2, 0.3, 0, 0, 0.2]);
  s([0.25,0.45,0.45,0.5, true, false, true, false, 0.7, 0, 0.2],   [0.5, 0.2,0, 0.4, 0, 0, 0.3]);
  s([0.15,0.5, 0.5, 0.5, true, false, false, false, 1.0, 0, 0.2],  [0.85,0, 0, 0, 0, 0, 0.2]);
  s([0.2, 0.55,0.55,0.5, true, true, true, false, 0.85, 0.2, 0.2], [0.8, 0, 0.1, 0, 0, 0, 0.2]);

  // Финальная стадия (оба почти мертвы)
  s([0.1, 0.15,0.15,0.5, true, true, true, false, 1.0, 0, 0.1],    [0.8, 0, 0.3, 0.5, 0, 0, 0]);
  s([0.15,0.2, 0.2, 0.5, true, false, true, false, 0.8, 0, 0.1],   [0.6, 0.2,0, 0.6, 0, 0, 0]);
  s([0.1, 0.18,0.1, 0.5, true, false, false, false, 1.0, 0, 0.1],  [1.0, 0, 0, 0, 0, 0, 0]);
  s([0.1, 0.25,0.05,0.6, true, false, false, false, 1.0, 0, 0.1],  [1.0, 0, 0, 0, 0, 0, 0]);

  // Оба с полным HP — стандартный 1v1
  s([0.15,1.0, 1.0, 0.5, true, false, false, false, 1.0, 0, 0.2],  [1.0, 0, 0, 0, 0, 0, 0.2]);
  s([0.2, 1.0, 1.0, 0.5, true, false, false, true,  1.0, 0, 0.1],  [0.5, 0, 0, 0, 0, 1.0, 0.3]);
  s([0.1, 1.0, 1.0, 0.5, true, true, false, false, 1.0, 0, 0.1],   [1.0, 0, 0, 0, 0, 0, 0.1]);

  // Бот застрял — стрейф
  s([0.9, 0.9, 0.5, 0.8, true, false, false, false, 0.8, 0, 0.1],  [0, 0, 0, 0, 0, 0, 1.0]);
  s([1.0, 0.8, 0.6, 0.7, true, false, false, false, 0.5, 0, 0.1],  [0, 0, 0, 0, 0, 0, 1.0]);
  s([0.85,0.7, 0.7, 0.5, false, false, false, false, 0.5, 0, 0.2], [0, 0, 0, 0, 0.3, 0, 1.0]);

  // Критический хит (1.5 блока = дистанция 0.05)
  s([0.05,0.9, 0.5, 0.8, true, false, false, false, 1.0, 0, 0.2],  [1.0, 0, 0, 0, 0, 0, 0]);
  s([0.05,0.8, 0.8, 0.5, true, false, false, false, 1.0, 0, 0.1],  [1.0, 0, 0, 0, 0, 0, 0.1]);
  s([0.08,0.9, 0.3, 0.8, true, false, false, false, 1.0, 0, 0.1],  [1.0, 0, 0, 0, 0, 0, 0]);

  // Сложные: бафф + атака + много союзников
  s([0.15,0.9, 0.5, 0.8, true, false, false, true, 1.0, 0.4, 0.2], [1.0, 0, 0, 0, 0, 0.9, 0]);
  s([0.2, 0.85,0.6, 0.75,true, true, false, true,  0.95,0.6, 0.3], [0.9, 0, 0, 0, 0, 0.85,0.1]);
  s([0.1, 1.0, 0.4, 0.8, true, false, false, true,  1.0, 0.8, 0.2],[1.0, 0, 0, 0, 0, 1.0, 0]);

  // Сложные: мало HP, есть все зелья — приоритет хила
  s([0.3, 0.2, 0.6, 0.4, true, true, true, true, 0.5, 0, 0.4],     [0, 0.7, 0, 1.0, 0, 0, 0]);
  s([0.25,0.18,0.7, 0.3, false, true, true, true,  0.3, 0, 0.3],   [0, 1.0, 0, 1.0, 0, 0, 0]);
  s([0.2, 0.22,0.5, 0.4, true, false, true, false, 0.6, 0, 0.5],   [0, 0.8, 0, 0.9, 0, 0, 0]);

  // Нет оружия, есть зелья — атакуем зельями
  s([0.3, 0.8, 0.5, 0.8, false, false, false, false, 0.5, 0, 0.4], [0, 0, 0, 0, 0.9, 0, 0.5]);
  s([0.4, 0.9, 0.4, 0.85, false, true, false, true,  0.5, 0, 0.3], [0, 0, 0.2, 0, 0.7, 0.4, 0.4]);
  s([0.25,0.7, 0.6, 0.7, false, false, false, true,  0.6, 0, 0.3], [0, 0, 0, 0, 0.6, 0.8, 0.4]);

  // Еда + голод + близко к врагу (трудный выбор)
  s([0.2, 0.65,0.5, 0.7, true, true, false, false, 1.0, 0, 0.2],   [0.85,0, 0, 0, 0, 0, 0.1]);
  s([0.3, 0.7, 0.5, 0.7, true, true, false, false, 0.5, 0, 0.2],   [0.2, 0, 0.5, 0, 0, 0, 0.6]);
  s([0.5, 0.8, 0.4, 0.8, true, true, false, false, 0.3, 0, 0.1],   [0, 0, 0.8, 0, 0, 0, 0.5]);
  s([0.1, 0.9, 0.5, 0.8, true, true, false, false, 0.0, 0, 0.2],   [0, 0, 0, 0, 0, 0, 1.0]);

  // Полный дефицит HP + окружён
  for (const bHp of [0.05, 0.08]) {
    for (const enemy of [0.4, 0.6, 0.8]) {
      s([0.2, bHp, 0.7, 0.3, true, false, false, false, 0.5, 0, enemy], [0, 1.0, 0, 0, 0, 0, 0]);
      s([0.3, bHp, 0.8, 0.25, false, false, false, false, 0.4, 0, enemy],[0, 1.0, 0, 0, 0, 0, 0]);
    }
  }

  log.info?.(`[PvpBrain] buildSeedData: ${data.length} сценариев`);
  return data;
}

class PvpBrain {
  constructor() {
    this._net = null;
    this._loadNet();
    this._lastAttackTime = 0;
    this._trainingData   = [];
  }

  _loadNet() {
    if (!brain) return;
    try {
      this._net = new brain.NeuralNetwork({
        hiddenLayers: [24, 18, 12],
        activation:   "sigmoid",
        learningRate: 0.03,
        momentum:     0.1,
      });
      if (fs.existsSync(WEIGHTS_PATH)) {
        const w = JSON.parse(fs.readFileSync(WEIGHTS_PATH, "utf8"));
        this._net.fromJSON(w);
        log.info("[PvpBrain] Загружены веса из", WEIGHTS_PATH);
      } else {
        log.info("[PvpBrain] Нет весов — обучаем на 500 сценариях...");
        this._trainWithSeedData();
      }
    } catch (err) {
      log.warn("[PvpBrain] Ошибка загрузки:", err.message);
      this._net = null;
    }
  }

  _trainWithSeedData() {
    if (!this._net) return;
    const data = buildSeedData();
    try {
      const result = this._net.train(data, {
        iterations:  12000,
        errorThresh: 0.005,
        log:         false,
      });
      this._saveWeights();
      log.info(`[PvpBrain] Обучение завершено: ${result.iterations} итераций, err=${result.error?.toFixed(4)}, сценариев=${data.length}`);
    } catch (err) {
      log.warn("[PvpBrain] Ошибка обучения:", err.message);
    }
  }

  retrainFromSeed() {
    if (!this._net) return;
    const data = buildSeedData();
    try {
      this._net.train(data, { iterations: 5000, errorThresh: 0.008, log: false });
      this._saveWeights();
      log.info("[PvpBrain] Переобучено из сид-данных");
    } catch (err) {
      log.warn("[PvpBrain] retrainFromSeed:", err.message);
    }
  }

  _saveWeights() {
    if (!this._net) return;
    try { fs.writeFileSync(WEIGHTS_PATH, JSON.stringify(this._net.toJSON(), null, 2)); } catch {}
  }

  recordExperience(inputFeatures, actionTaken, wasGood) {
    if (!inputFeatures || inputFeatures.length !== 12) return;
    const acts = ["attack","retreat","eat","throwHeal","throwPotion","throwPerk","strafe"];
    const output = acts.map(a => wasGood && actionTaken[a] ? 1 : 0);
    this._trainingData.push({ input: inputFeatures, output });
    if (this._trainingData.length >= 25) this._retrainIncremental();
  }

  _retrainIncremental() {
    if (!this._net || this._trainingData.length === 0) return;
    try {
      const combined = [...buildSeedData(), ...this._trainingData];
      this._net.train(combined, { iterations: 500, errorThresh: 0.03, log: false });
      this._saveWeights();
      this._trainingData = [];
      log.info("[PvpBrain] Инкрементальное переобучение завершено");
    } catch (err) {
      log.warn("[PvpBrain] Ошибка переобучения:", err.message);
    }
  }

  decide(bot, target, teammates = []) {
    const features = getBotFeatures(bot, target, teammates);
    if (!features) return { action: "strafe", confidence: 0.5, rawOutput: [], features: null };

    if (this._net) {
      try {
        const raw    = this._net.run(features);
        const rawArr = Array.isArray(raw) ? raw : Array.from(raw);
        const actions = ["attack","retreat","eat","throwHeal","throwPotion","throwPerk","strafe"];
        let bestIdx = 0;
        for (let i = 1; i < rawArr.length; i++) {
          if (rawArr[i] > rawArr[bestIdx]) bestIdx = i;
        }
        return {
          action:     actions[bestIdx],
          confidence: rawArr[bestIdx],
          rawOutput:  rawArr,
          features,
        };
      } catch (err) {
        log.warn("[PvpBrain] decide error:", err.message);
      }
    }

    return this._heuristicDecide(features);
  }

  _heuristicDecide(features) {
    const [dist, botHp, targetHp,, hunger, hasSword, hasFood, hasHeal, hasBuff, attackCd, allies, enemies] = features;
    const scores = [0, 0, 0, 0, 0, 0, 0]; // [atk, ret, eat, heal, pot, perk, strf]

    if (botHp < 0.12 && hasHeal)          scores[3] = 0.98;
    else if (botHp < 0.22 && hasHeal)     scores[3] = 0.88;
    if (botHp < 0.22)                     scores[1] = Math.max(scores[1], 0.85);
    if (enemies > 0.5 && botHp < 0.45)   scores[1] = Math.max(scores[1], 0.82);
    if (hunger < 0.2 && hasFood)          scores[2] = 0.80;
    if (hasBuff && botHp > 0.5 && dist < 0.4) scores[5] = 0.72;
    if (enemies > 0.6)                    scores[4] = Math.max(scores[4], 0.70);
    if (dist < 0.3 && attackCd > 0.9 && hasSword)  scores[0] = 0.95;
    else if (dist < 0.4 && attackCd > 0.8 && hasSword) scores[0] = Math.max(scores[0], 0.80);
    if (dist > 0.45 || attackCd < 0.4)   scores[6] = Math.max(scores[6], 0.65);
    if (botHp > 0.65 && attackCd > 0.85 && hasSword) scores[0] = Math.max(scores[0], 0.75);

    let best = 0;
    for (let i = 1; i < scores.length; i++) if (scores[i] > scores[best]) best = i;
    const actions = ["attack","retreat","eat","throwHeal","throwPotion","throwPerk","strafe"];
    return { action: actions[best], confidence: scores[best], rawOutput: scores, features };
  }

  getWeightsPath() { return WEIGHTS_PATH; }
  hasWeights()     { return fs.existsSync(WEIGHTS_PATH); }
}

module.exports = { PvpBrain, getBotFeatures };
