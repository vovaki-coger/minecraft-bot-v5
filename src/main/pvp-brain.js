/**
 * PvpBrain — нейросеть PVP для Mineflayer-бота
 *
 * Архитектура: brain.js (без GPU зависимостей)
 * Входной вектор (12 признаков):
 *   0  — расстояние до цели (норм. 0-1, max=10)
 *   1  — HP бота (норм. 0-1)
 *   2  — HP цели (норм. 0-1)
 *   3  — HP разница (бот - цель, норм. -1..1)
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

const POTION_IDS = {
  HEALING:    ["potion","splash_potion","lingering_potion"],
  STRENGTH:   ["potion","splash_potion"],
  SPEED:      ["potion","splash_potion"],
  REGENERATION: ["potion","splash_potion"],
};

const HEAL_NAMES = [
  "potion_of_healing", "splash_potion_of_healing",
  "potion_of_regeneration", "splash_potion_of_regeneration",
  "potion_of_instant_health",
];
const BUFF_NAMES = [
  "potion_of_strength", "splash_potion_of_strength",
  "potion_of_speed", "splash_potion_of_speed",
];
const SWORD_NAMES = ["wooden_sword","stone_sword","iron_sword","golden_sword","diamond_sword","netherite_sword"];
const FOOD_NAMES = ["apple","golden_apple","enchanted_golden_apple","bread","cooked_beef","cooked_porkchop","cooked_chicken","cooked_mutton","cooked_rabbit","carrot","baked_potato","cookie","melon_slice","pumpkin_pie","mushroom_stew"];

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
    return (e.type === "player" || e.type === "mob") && e.position.distanceTo(bot.entity.position) < 10;
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
        hiddenLayers: [16, 12],
        activation: "sigmoid",
        learningRate: 0.05,
        momentum: 0.1,
      });
      if (fs.existsSync(WEIGHTS_PATH)) {
        const weights = JSON.parse(fs.readFileSync(WEIGHTS_PATH, "utf8"));
        this._net.fromJSON(weights);
        log.info("[PvpBrain] Loaded weights from", WEIGHTS_PATH);
      } else {
        log.info("[PvpBrain] No weights file — using pre-seeded training data");
        this._trainWithSeedData();
      }
    } catch (err) {
      log.warn("[PvpBrain] Error loading net:", err.message);
      this._net = null;
    }
  }

  /**
   * Предобученные данные — «идеальный PVP-игрок»
   * Каждый объект: { input: [12 признаков], output: [7 действий] }
   */
  _trainWithSeedData() {
    const data = [
      // близко, много HP, цель в HP, атакуй
      { input: [0.1, 0.9, 0.5, 0.7, 0.9, 1, 0, 0, 0, 1, 0, 0.2], output: [1,0,0,0,0,0,0.3] },
      // близко, атакуй со стрейфом
      { input: [0.15, 0.8, 0.6, 0.6, 0.8, 1, 1, 0, 1, 1, 0, 0.2], output: [1,0,0,0,0,0.4,0.5] },
      // мало HP — отступить и есть
      { input: [0.2, 0.25, 0.7, 0.2, 0.3, 0, 1, 0, 0, 0.5, 0, 0.5], output: [0,1,1,0,0,0,0] },
      // мало HP, есть хил-зелье — бросить под себя
      { input: [0.3, 0.2, 0.5, 0.15, 0.5, 0, 0, 1, 0, 0, 0, 0.3], output: [0,1,0,1,0,0,0] },
      // хорошо — применить перк и атаковать
      { input: [0.1, 0.9, 0.4, 0.7, 0.9, 1, 1, 0, 1, 1, 0.3, 0.2], output: [1,0,0,0,0,1,0.3] },
      // цель далеко — стрейф + атака
      { input: [0.5, 0.8, 0.6, 0.5, 0.8, 1, 0, 0, 0, 0.8, 0, 0.2], output: [0.5,0,0,0,0,0,0.8] },
      // много врагов рядом — отступить и бросить AOE зелье
      { input: [0.4, 0.7, 0.5, 0.5, 0.7, 1, 0, 0, 0, 0.5, 0, 0.9], output: [0,0.7,0,0,1,0,0] },
      // голодный — поесть
      { input: [0.4, 0.7, 0.5, 0.5, 0.2, 1, 1, 0, 0, 0.5, 0, 0.2], output: [0.3,0,1,0,0,0,0] },
      // цель почти мертва — добить
      { input: [0.1, 0.7, 0.1, 0.9, 0.8, 1, 0, 0, 0, 1, 0, 0.1], output: [1,0,0,0,0,0,0] },
      // только мечатаковать когда целы оба
      { input: [0.2, 0.7, 0.7, 0.5, 0.8, 1, 0, 0, 0, 1, 0, 0.2], output: [1,0,0,0,0,0,0.4] },
      // далеко и нет меча — стрейф и искать позицию
      { input: [0.7, 0.8, 0.6, 0.5, 0.8, 0, 0, 0, 0, 0.5, 0, 0.2], output: [0,0,0,0,0,0,0.9] },
      // критически мало HP — бросить зелье на себя и убежать
      { input: [0.2, 0.1, 0.5, 0.1, 0.5, 1, 0, 1, 0, 0.5, 0, 0.4], output: [0,1,0,1,0,0,0] },
    ];

    if (this._net) {
      try {
        this._net.train(data, { iterations: 5000, errorThresh: 0.01, log: false });
        this._saveWeights();
        log.info("[PvpBrain] Trained with seed data, weights saved");
      } catch (err) {
        log.warn("[PvpBrain] Training error:", err.message);
      }
    }
  }

  _saveWeights() {
    if (!this._net) return;
    try {
      fs.writeFileSync(WEIGHTS_PATH, JSON.stringify(this._net.toJSON(), null, 2));
    } catch {}
  }

  /**
   * Добавить обучающий пример из реального боя
   * @param {number[]} inputFeatures
   * @param {object} actionTaken — { attack, retreat, eat, throwHeal, throwPotion, throwPerk, strafe }
   * @param {boolean} wasGood — было ли действие успешным
   */
  recordExperience(inputFeatures, actionTaken, wasGood) {
    if (!inputFeatures || inputFeatures.length !== 12) return;
    const output = [
      wasGood && actionTaken.attack    ? 1 : 0,
      wasGood && actionTaken.retreat   ? 1 : 0,
      wasGood && actionTaken.eat       ? 1 : 0,
      wasGood && actionTaken.throwHeal ? 1 : 0,
      wasGood && actionTaken.throwPotion ? 1 : 0,
      wasGood && actionTaken.throwPerk ? 1 : 0,
      wasGood && actionTaken.strafe    ? 1 : 0,
    ];
    this._trainingData.push({ input: inputFeatures, output });
    if (this._trainingData.length >= 50) {
      this._retrainIncremental();
    }
  }

  _retrainIncremental() {
    if (!this._net || this._trainingData.length === 0) return;
    try {
      this._net.train(this._trainingData, { iterations: 500, errorThresh: 0.03, log: false });
      this._saveWeights();
      this._trainingData = [];
      log.info("[PvpBrain] Incremental retrain done");
    } catch (err) {
      log.warn("[PvpBrain] Retrain error:", err.message);
    }
  }

  /**
   * Получить следующее действие от нейросети
   * @returns {{ action: string, confidence: number, rawOutput: number[] }}
   */
  decide(bot, target, teammates = []) {
    const features = getBotFeatures(bot, target, teammates);
    if (!features) return { action: "strafe", confidence: 0.5, rawOutput: [] };

    if (this._net) {
      try {
        const raw = this._net.run(features);
        const actions = ["attack", "retreat", "eat", "throwHeal", "throwPotion", "throwPerk", "strafe"];
        let bestIdx = 0;
        for (let i = 1; i < raw.length; i++) {
          if (raw[i] > raw[bestIdx]) bestIdx = i;
        }
        return {
          action: actions[bestIdx],
          confidence: raw[bestIdx],
          rawOutput: Array.from(raw),
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

    if (botHp < 0.2 && hasHeal)   { scores[3] = 0.95; }
    if (botHp < 0.3)               { scores[1] = 0.8; }
    if (hunger < 0.3 && hasFood)   { scores[2] = 0.75; }
    if (hasBuff && botHp > 0.5)    { scores[5] = 0.7; }
    if (enemies > 0.5)             { scores[4] = 0.65; }
    if (dist < 0.3 && attackCd > 0.8 && hasSword) { scores[0] = 0.9; }
    if (dist > 0.4)                { scores[6] = 0.6; }
    if (botHp > 0.6 && attackCd > 0.8) { scores[0] = Math.max(scores[0], 0.7); }

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
