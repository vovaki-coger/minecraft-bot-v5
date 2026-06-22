/**
 * PvpBrain v2 — нейросеть PVP для Mineflayer-бота
 *
 * Архитектура: brain.js 1.x (без GPU, pure JS)
 * Входной вектор (12 признаков):
 *   0  — расстояние до цели (норм. 0-1, max=10)
 *   1  — HP бота (норм. 0-1)
 *   2  — HP цели (норм. 0-1)
 *   3  — HP разница (бот - цель, норм. -1..1 → 0..1)
 *   4  — голод бота (норм. 0-1)
 *   5  — есть ли меч в руке (0/1)
 *   6  — есть ли еда в инвентаре (0/1)
 *   7  — есть ли хил-зелье (0/1)
 *   8  — есть ли сила/скорость зелье (0/1)
 *   9  — cooldown атаки (норм. 0-1, 1=готов)
 *   10 — кол-во союзников рядом (норм. 0-1, max=5)
 *   11 — кол-во врагов рядом (норм. 0-1, max=5)
 *
 * Выходной вектор (7 действий):
 *   0 — attack       — ударить цель
 *   1 — retreat      — отступить
 *   2 — eat          — съесть еду
 *   3 — throwHeal    — бросить хил-зелье под себя
 *   4 — throwPotion  — бросить зелье на врага
 *   5 — throwPerk    — использовать перк (сила/скорость)
 *   6 — strafe       — стрейф вокруг цели
 */

const log = require("electron-log");

let brain = null;
try {
  brain = require("brain.js");
} catch {
  log.warn("[PvpBrain] brain.js not installed — using heuristic fallback");
}

const path  = require("path");
const fs    = require("fs");

const WEIGHTS_PATH = path.join(__dirname, "../../pvp-weights.json");

const HEAL_NAMES = [
  "potion_of_healing", "splash_potion_of_healing",
  "potion_of_regeneration", "splash_potion_of_regeneration",
  "potion_of_instant_health",
];
const BUFF_NAMES = [
  "potion_of_strength", "splash_potion_of_strength",
  "potion_of_speed", "splash_potion_of_speed",
];
const SWORD_NAMES = [
  "wooden_sword","stone_sword","iron_sword","golden_sword",
  "diamond_sword","netherite_sword","mace",
];
const FOOD_NAMES = [
  "apple","golden_apple","enchanted_golden_apple","bread",
  "cooked_beef","cooked_porkchop","cooked_chicken","cooked_mutton",
  "cooked_rabbit","carrot","baked_potato","cookie","melon_slice",
  "pumpkin_pie","mushroom_stew",
];

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function getBotFeatures(bot, target, teammates = []) {
  if (!bot?.entity || !target?.position) return null;

  const dist     = bot.entity.position.distanceTo(target.position);
  const heldItem = bot.heldItem;

  const items    = bot.inventory.items();
  const hasSword = heldItem ? SWORD_NAMES.some(n => heldItem.name.includes(n)) : false;
  const hasFood  = items.some(i => FOOD_NAMES.includes(i.name));
  const hasHeal  = items.some(i => HEAL_NAMES.some(n => i.name.includes(n.replace("potion_of_","").replace("splash_",""))));
  const hasBuff  = items.some(i => BUFF_NAMES.some(n => i.name.includes(n.replace("potion_of_","").replace("splash_",""))));

  const attackCooldown = heldItem
    ? Math.min(1, (Date.now() - (bot._lastAttackTime || 0)) / 620)
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

  const botHp     = clamp(bot.health / 20, 0, 1);
  const targetHp  = clamp((target.health || 20) / 20, 0, 1);

  return [
    clamp(dist / 10, 0, 1),
    botHp,
    targetHp,
    clamp((bot.health - (target.health || 20)) / 20 + 0.5, 0, 1),
    clamp((bot.food || 20) / 20, 0, 1),
    hasSword ? 1 : 0,
    hasFood  ? 1 : 0,
    hasHeal  ? 1 : 0,
    hasBuff  ? 1 : 0,
    attackCooldown,
    clamp(allies / 5, 0, 1),
    clamp(enemies / 5, 0, 1),
  ];
}

// ─── Полные обучающие данные (60+ сценариев) ──────────────────────────────
// Формат: { input: [dist,botHp,targetHp,hpDiff,hunger,hasSword,hasFood,hasHeal,hasBuff,cd,allies,enemies],
//            output: [attack,retreat,eat,throwHeal,throwPotion,throwPerk,strafe] }
function buildSeedData() {
  return [
    // ── АТАКА (условия для атаки) ────────────────────────────────────────
    // Близко, много HP, меч готов
    { input: [0.1, 0.9, 0.5, 0.7, 0.9, 1, 0, 0, 0, 1.0, 0,   0.2], output: [1,   0,   0,   0,   0,   0,   0.2] },
    { input: [0.15,0.8, 0.6, 0.6, 0.8, 1, 1, 0, 0, 1.0, 0,   0.2], output: [1,   0,   0,   0,   0,   0,   0.3] },
    { input: [0.2, 0.9, 0.7, 0.6, 0.9, 1, 0, 0, 0, 1.0, 0,   0.1], output: [1,   0,   0,   0,   0,   0,   0.2] },
    { input: [0.1, 0.7, 0.4, 0.65,0.8, 1, 0, 0, 0, 0.9, 0,   0.2], output: [0.9, 0,   0,   0,   0,   0,   0.3] },
    // Цель почти мертва — добить
    { input: [0.1, 0.7, 0.1, 0.9, 0.8, 1, 0, 0, 0, 1.0, 0,   0.1], output: [1,   0,   0,   0,   0,   0,   0]   },
    { input: [0.2, 0.6, 0.05,0.85,0.7, 1, 0, 0, 0, 1.0, 0,   0.1], output: [1,   0,   0,   0,   0,   0,   0]   },
    { input: [0.15,0.5, 0.08,0.75,0.6, 1, 1, 0, 0, 0.9, 0,   0.1], output: [1,   0,   0,   0,   0,   0,   0]   },
    // Кулдаун не готов — стрейф
    { input: [0.2, 0.8, 0.5, 0.65,0.9, 1, 0, 0, 0, 0.3, 0,   0.2], output: [0.1, 0,   0,   0,   0,   0,   0.9] },
    { input: [0.25,0.8, 0.5, 0.65,0.9, 1, 0, 0, 0, 0.5, 0,   0.2], output: [0.4, 0,   0,   0,   0,   0,   0.7] },
    { input: [0.2, 0.9, 0.6, 0.65,0.9, 1, 0, 0, 0, 0.0, 0,   0.2], output: [0,   0,   0,   0,   0,   0,   1]   },

    // ── ОТСТУПЛЕНИЕ ──────────────────────────────────────────────────────
    // Мало HP — отступить
    { input: [0.2, 0.2, 0.7, 0.25,0.5, 1, 0, 0, 0, 0.5, 0,   0.5], output: [0,   1,   0,   0,   0,   0,   0]   },
    { input: [0.3, 0.15,0.6, 0.2, 0.4, 0, 0, 0, 0, 0.5, 0,   0.4], output: [0,   1,   0,   0,   0,   0,   0]   },
    { input: [0.15,0.1, 0.8, 0.15,0.3, 1, 0, 0, 0, 0.7, 0,   0.5], output: [0,   1,   0,   0,   0,   0,   0]   },
    { input: [0.25,0.25,0.9, 0.18,0.4, 1, 0, 0, 0, 0.4, 0,   0.6], output: [0,   1,   0,   0,   0,   0,   0]   },
    // Много врагов — отступить
    { input: [0.3, 0.5, 0.5, 0.5, 0.7, 1, 0, 0, 0, 0.6, 0,   0.9], output: [0,   1,   0,   0,   0,   0,   0]   },
    { input: [0.4, 0.6, 0.5, 0.55,0.7, 1, 0, 0, 0, 0.5, 0,   1.0], output: [0,   1,   0,   0,   0.5, 0,   0]   },
    // Нет меча + плохое HP — отступить
    { input: [0.3, 0.3, 0.7, 0.3, 0.6, 0, 0, 0, 0, 0.5, 0,   0.4], output: [0,   1,   0,   0,   0,   0,   0]   },

    // ── ЕДА ──────────────────────────────────────────────────────────────
    // Голодный — поесть
    { input: [0.4, 0.7, 0.5, 0.6, 0.15,1, 1, 0, 0, 0.5, 0,   0.2], output: [0.2, 0,   1,   0,   0,   0,   0]   },
    { input: [0.4, 0.8, 0.4, 0.7, 0.1, 1, 1, 0, 0, 0.4, 0,   0.1], output: [0,   0,   1,   0,   0,   0,   0]   },
    { input: [0.5, 0.9, 0.3, 0.8, 0.05,1, 1, 0, 0, 0.5, 0,   0.1], output: [0,   0,   1,   0,   0,   0,   0]   },
    // Средний голод + далеко от врага
    { input: [0.7, 0.8, 0.5, 0.65,0.3, 1, 1, 0, 0, 0.5, 0,   0.1], output: [0,   0,   0.8, 0,   0,   0,   0.3] },
    // Нет еды — не есть
    { input: [0.4, 0.7, 0.5, 0.6, 0.2, 1, 0, 0, 0, 0.5, 0,   0.2], output: [0.5, 0,   0,   0,   0,   0,   0.4] },

    // ── ХИЛ-ЗЕЛЬЕ (throwHeal) ────────────────────────────────────────────
    // Мало HP, есть хил — бросить под себя
    { input: [0.3, 0.2, 0.5, 0.25,0.5, 0, 0, 1, 0, 0.3, 0,   0.3], output: [0,   1,   0,   1,   0,   0,   0]   },
    { input: [0.2, 0.15,0.6, 0.2, 0.4, 1, 0, 1, 0, 0.4, 0,   0.3], output: [0,   1,   0,   1,   0,   0,   0]   },
    { input: [0.4, 0.25,0.7, 0.23,0.5, 1, 0, 1, 0, 0.3, 0,   0.4], output: [0,   0.7, 0,   1,   0,   0,   0]   },
    { input: [0.3, 0.3, 0.5, 0.4, 0.6, 0, 0, 1, 0, 0.2, 0,   0.2], output: [0,   0.5, 0,   0.9, 0,   0,   0]   },
    // HP выше — хил не нужен
    { input: [0.3, 0.6, 0.5, 0.55,0.7, 1, 0, 1, 0, 0.8, 0,   0.3], output: [0.8, 0,   0,   0,   0,   0,   0.3] },

    // ── ЗЕЛЬЕ НА ВРАГА (throwPotion) ─────────────────────────────────────
    // Много врагов — AOE зелье
    { input: [0.4, 0.7, 0.5, 0.6, 0.7, 1, 0, 0, 0, 0.5, 0,   0.9], output: [0,   0.3, 0,   0,   1,   0,   0]   },
    { input: [0.3, 0.8, 0.4, 0.7, 0.8, 1, 0, 0, 0, 0.6, 0,   0.8], output: [0.2, 0,   0,   0,   1,   0,   0]   },
    { input: [0.5, 0.7, 0.5, 0.6, 0.7, 1, 0, 0, 0, 0.4, 0,   0.7], output: [0,   0.2, 0,   0,   0.9, 0,   0.2] },
    // Враг один, близко
    { input: [0.2, 0.7, 0.5, 0.6, 0.8, 1, 0, 0, 0, 0.5, 0,   0.3], output: [0.7, 0,   0,   0,   0.3, 0,   0.2] },

    // ── ПЕРК (throwPerk: сила/скорость) ──────────────────────────────────
    // Хорошие условия — применить перк
    { input: [0.1, 0.9, 0.4, 0.75,0.9, 1, 1, 0, 1, 1.0, 0.3, 0.2], output: [1,   0,   0,   0,   0,   1,   0.3] },
    { input: [0.2, 0.85,0.5, 0.68,0.9, 1, 0, 0, 1, 0.9, 0,   0.2], output: [0.7, 0,   0,   0,   0,   1,   0.3] },
    { input: [0.15,0.8, 0.6, 0.6, 0.8, 1, 0, 0, 1, 0.8, 0,   0.1], output: [0.6, 0,   0,   0,   0,   1,   0.2] },
    // Плохие условия — перк не нужен
    { input: [0.2, 0.2, 0.7, 0.25,0.4, 1, 0, 0, 1, 0.5, 0,   0.5], output: [0,   1,   0,   0,   0,   0,   0]   },

    // ── СТРЕЙФ (strafe) ───────────────────────────────────────────────────
    // Далеко от цели — стрейф и сближение
    { input: [0.5, 0.8, 0.6, 0.6, 0.8, 1, 0, 0, 0, 0.8, 0,   0.2], output: [0.3, 0,   0,   0,   0,   0,   0.8] },
    { input: [0.6, 0.9, 0.5, 0.7, 0.9, 1, 0, 0, 0, 0.5, 0,   0.1], output: [0,   0,   0,   0,   0,   0,   1]   },
    { input: [0.7, 0.8, 0.6, 0.6, 0.8, 0, 0, 0, 0, 0.5, 0,   0.2], output: [0,   0,   0,   0,   0,   0,   1]   },
    { input: [0.8, 0.9, 0.4, 0.75,0.9, 1, 0, 0, 0, 0.5, 0,   0.1], output: [0,   0,   0,   0,   0,   0,   1]   },
    // Кулдаун — стрейф пока ждём
    { input: [0.2, 0.9, 0.5, 0.7, 0.9, 1, 0, 0, 0, 0.0, 0,   0.2], output: [0,   0,   0,   0,   0,   0,   1]   },
    { input: [0.3, 0.8, 0.6, 0.6, 0.8, 1, 0, 0, 0, 0.2, 0,   0.2], output: [0,   0,   0,   0,   0,   0,   0.9] },
    { input: [0.15,0.7, 0.5, 0.6, 0.7, 1, 0, 0, 0, 0.4, 0,   0.3], output: [0.3, 0,   0,   0,   0,   0,   0.7] },

    // ── СЛОЖНЫЕ КОМБО-СИТУАЦИИ ────────────────────────────────────────────
    // Атака + стрейф (близко, кулдаун готов)
    { input: [0.1, 0.8, 0.5, 0.65,0.9, 1, 0, 0, 0, 1.0, 0,   0.3], output: [1,   0,   0,   0,   0,   0,   0.4] },
    // Перк + атака (перк готов, кулдаун готов)
    { input: [0.15,0.9, 0.5, 0.7, 0.9, 1, 0, 0, 1, 1.0, 0,   0.1], output: [1,   0,   0,   0,   0,   0.8, 0.2] },
    // Отступ + хил (критически мало HP)
    { input: [0.2, 0.1, 0.5, 0.3, 0.5, 1, 0, 1, 0, 0.5, 0,   0.4], output: [0,   1,   0,   1,   0,   0,   0]   },
    // Зелье + отступ (много врагов, мало HP)
    { input: [0.35,0.3, 0.6, 0.35,0.6, 1, 0, 0, 0, 0.5, 0,   0.8], output: [0,   0.8, 0,   0,   0.6, 0,   0]   },
    // Еда + стрейф (голодный, враг далеко)
    { input: [0.6, 0.8, 0.5, 0.65,0.1, 1, 1, 0, 0, 0.5, 0,   0.1], output: [0,   0,   0.9, 0,   0,   0,   0.5] },
    // Союзники рядом — агрессивнее атакуем
    { input: [0.2, 0.7, 0.5, 0.6, 0.8, 1, 0, 0, 0, 1.0, 0.6, 0.3], output: [1,   0,   0,   0,   0,   0,   0.2] },
    { input: [0.15,0.8, 0.4, 0.7, 0.9, 1, 0, 0, 1, 1.0, 0.4, 0.2], output: [1,   0,   0,   0,   0,   0.7, 0.1] },
    // Нет меча — только стрейф и зелья
    { input: [0.4, 0.8, 0.5, 0.65,0.8, 0, 0, 0, 0, 0.5, 0,   0.3], output: [0,   0,   0,   0,   0.4, 0,   0.8] },
    { input: [0.3, 0.9, 0.4, 0.75,0.9, 0, 1, 0, 0, 0.5, 0,   0.2], output: [0,   0,   0.3, 0,   0.3, 0,   0.8] },
    // Враг с полным HP, мы тоже — классический PVP
    { input: [0.15,1.0, 1.0, 0.5, 1.0, 1, 0, 0, 0, 1.0, 0,   0.2], output: [1,   0,   0,   0,   0,   0,   0.3] },
    { input: [0.2, 1.0, 1.0, 0.5, 1.0, 1, 0, 0, 1, 1.0, 0,   0.1], output: [0.5, 0,   0,   0,   0,   1,   0.3] },
    // Середина боя (оба ~50% HP)
    { input: [0.2, 0.5, 0.5, 0.5, 0.7, 1, 1, 1, 0, 0.9, 0,   0.2], output: [0.7, 0,   0.2, 0.3, 0,   0,   0.3] },
    { input: [0.25,0.45,0.45,0.5, 0.6, 1, 0, 1, 0, 0.7, 0,   0.2], output: [0.5, 0.2, 0,   0.4, 0,   0,   0.3] },
    // Финальная стадия — оба почти умерли
    { input: [0.1, 0.15,0.15,0.5, 0.5, 1, 1, 1, 0, 1.0, 0,   0.1], output: [0.8, 0,   0.3, 0.5, 0,   0,   0]   },
    { input: [0.15,0.2, 0.2, 0.5, 0.6, 1, 0, 1, 0, 0.8, 0,   0.1], output: [0.6, 0.2, 0,   0.6, 0,   0,   0]   },
    // Блокировка движения — бот застрял, стрейф
    { input: [0.9, 0.9, 0.5, 0.7, 0.9, 1, 0, 0, 0, 0.8, 0,   0.1], output: [0,   0,   0,   0,   0,   0,   1]   },
    { input: [1.0, 0.8, 0.6, 0.6, 0.8, 1, 0, 0, 0, 0.5, 0,   0.1], output: [0,   0,   0,   0,   0,   0,   1]   },
    // Кричикал хит сразу — 1.5 блока, кулдаун готов
    { input: [0.05,0.9, 0.5, 0.7, 0.9, 1, 0, 0, 0, 1.0, 0,   0.2], output: [1,   0,   0,   0,   0,   0,   0]   },
  ];
}

class PvpBrain {
  constructor() {
    this._net = null;
    this._loadNet();
    this._lastAttackTime = 0;
    this._trainingData = [];
  }

  _loadNet() {
    if (!brain) return;
    try {
      this._net = new brain.NeuralNetwork({
        hiddenLayers: [20, 16, 10],
        activation: "sigmoid",
        learningRate: 0.04,
        momentum: 0.1,
      });
      if (fs.existsSync(WEIGHTS_PATH)) {
        const weights = JSON.parse(fs.readFileSync(WEIGHTS_PATH, "utf8"));
        this._net.fromJSON(weights);
        log.info("[PvpBrain] Loaded weights from", WEIGHTS_PATH);
      } else {
        log.info("[PvpBrain] No weights — training from seed data (60+ scenarios)");
        this._trainWithSeedData();
      }
    } catch (err) {
      log.warn("[PvpBrain] Error loading net:", err.message);
      this._net = null;
    }
  }

  _trainWithSeedData() {
    if (!this._net) return;
    const data = buildSeedData();
    try {
      const result = this._net.train(data, {
        iterations: 8000,
        errorThresh: 0.007,
        log: false,
      });
      this._saveWeights();
      log.info(`[PvpBrain] Seed training done: ${result.iterations} iter, err=${result.error?.toFixed(4)}`);
    } catch (err) {
      log.warn("[PvpBrain] Training error:", err.message);
    }
  }

  /**
   * Переобучить нейросеть поверх имеющихся весов (не с нуля)
   * Можно вызвать принудительно из команды
   */
  retrainFromSeed() {
    if (!this._net) return;
    const data = buildSeedData();
    try {
      this._net.train(data, { iterations: 3000, errorThresh: 0.01, log: false });
      this._saveWeights();
      log.info("[PvpBrain] Re-trained from seed data");
    } catch (err) {
      log.warn("[PvpBrain] retrainFromSeed error:", err.message);
    }
  }

  _saveWeights() {
    if (!this._net) return;
    try {
      fs.writeFileSync(WEIGHTS_PATH, JSON.stringify(this._net.toJSON(), null, 2));
    } catch {}
  }

  recordExperience(inputFeatures, actionTaken, wasGood) {
    if (!inputFeatures || inputFeatures.length !== 12) return;
    const output = [
      wasGood && actionTaken.attack      ? 1 : 0,
      wasGood && actionTaken.retreat     ? 1 : 0,
      wasGood && actionTaken.eat         ? 1 : 0,
      wasGood && actionTaken.throwHeal   ? 1 : 0,
      wasGood && actionTaken.throwPotion ? 1 : 0,
      wasGood && actionTaken.throwPerk   ? 1 : 0,
      wasGood && actionTaken.strafe      ? 1 : 0,
    ];
    this._trainingData.push({ input: inputFeatures, output });
    if (this._trainingData.length >= 30) {
      this._retrainIncremental();
    }
  }

  _retrainIncremental() {
    if (!this._net || this._trainingData.length === 0) return;
    try {
      const combined = [...buildSeedData(), ...this._trainingData];
      this._net.train(combined, { iterations: 500, errorThresh: 0.03, log: false });
      this._saveWeights();
      this._trainingData = [];
      log.info("[PvpBrain] Incremental retrain done");
    } catch (err) {
      log.warn("[PvpBrain] Retrain error:", err.message);
    }
  }

  decide(bot, target, teammates = []) {
    const features = getBotFeatures(bot, target, teammates);
    if (!features) return { action: "strafe", confidence: 0.5, rawOutput: [] };

    if (this._net) {
      try {
        const raw = this._net.run(features);
        const rawArr = Array.isArray(raw) ? raw : Array.from(raw);
        const actions = ["attack", "retreat", "eat", "throwHeal", "throwPotion", "throwPerk", "strafe"];
        let bestIdx = 0;
        for (let i = 1; i < rawArr.length; i++) {
          if (rawArr[i] > rawArr[bestIdx]) bestIdx = i;
        }
        return {
          action: actions[bestIdx],
          confidence: rawArr[bestIdx],
          rawOutput: rawArr,
          features,
        };
      } catch (err) {
        log.warn("[PvpBrain] decide error:", err.message);
      }
    }

    return this._heuristicDecide(features);
  }

  _heuristicDecide(features) {
    const [dist, botHp, targetHp, hpDiff, hunger, hasSword, hasFood, hasHeal, hasBuff, attackCd, allies, enemies] = features;
    const actions = ["attack","retreat","eat","throwHeal","throwPotion","throwPerk","strafe"];
    const scores = [0,0,0,0,0,0,0];

    if (botHp < 0.15 && hasHeal)          { scores[3] = 0.97; }
    else if (botHp < 0.25 && hasHeal)     { scores[3] = 0.88; }
    if (botHp < 0.25)                     { scores[1] = 0.82; }
    if (hunger < 0.25 && hasFood)         { scores[2] = 0.78; }
    if (hasBuff && botHp > 0.5 && dist < 0.4) { scores[5] = 0.72; }
    if (enemies > 0.6)                    { scores[4] = 0.68; }
    if (dist < 0.3 && attackCd > 0.85 && hasSword) { scores[0] = 0.93; }
    else if (dist < 0.4 && attackCd > 0.8 && hasSword) { scores[0] = 0.78; }
    if (dist > 0.45 || attackCd < 0.4)   { scores[6] = 0.65; }
    if (botHp > 0.65 && attackCd > 0.8 && hasSword) {
      scores[0] = Math.max(scores[0], 0.72);
    }

    let bestIdx = 0;
    for (let i = 1; i < scores.length; i++) {
      if (scores[i] > scores[bestIdx]) bestIdx = i;
    }
    return { action: actions[bestIdx], confidence: scores[bestIdx], rawOutput: scores, features };
  }

  getWeightsPath() { return WEIGHTS_PATH; }
  hasWeights() { return fs.existsSync(WEIGHTS_PATH); }
}

module.exports = { PvpBrain, getBotFeatures };
