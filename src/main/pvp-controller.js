/**
 * PvpController — управляет PVP-режимом бота через PvpBrain.
 *
 * Что делает:
 *  - Ищет ближайшего врага (не в тимейтах)
 *  - Каждые ~620мс (1.9 PVP cooldown) спрашивает PvpBrain что делать
 *  - Выполняет действие: атака, стрейф, отступление, зелье, еда
 *  - Собирает обучающий опыт (было ли действие успешным)
 *  - AntiDetect: плавный поворот, FOV-проверка, рандомный тайминг
 */

const log = require("electron-log");
const { PvpBrain } = require("./pvp-brain");
const { AntiDetect } = require("./anti-detect");

const SWORD_NAMES = ["wooden_sword","stone_sword","iron_sword","golden_sword","diamond_sword","netherite_sword","axe"];
const HEAL_NAMES  = ["potion_of_healing","splash_potion_of_healing","potion_of_instant_health","splash_potion_of_instant_health","potion_of_regeneration","splash_potion_of_regeneration"];
const BUFF_NAMES  = ["potion_of_strength","splash_potion_of_strength","potion_of_speed","splash_potion_of_speed"];
const FOOD_NAMES  = ["apple","golden_apple","enchanted_golden_apple","bread","cooked_beef","cooked_porkchop","cooked_chicken","cooked_mutton","cooked_rabbit","cooked_fish","cooked_salmon","carrot","baked_potato","cookie","melon_slice","pumpkin_pie","mushroom_stew","rabbit_stew","suspicious_stew","dried_kelp"];

function rand(min, max) { return min + Math.random() * (max - min); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

class PvpController {
  constructor(instance, emit) {
    this.instance = instance;
    this.emit = emit;
    this.brain = new PvpBrain();
    this.antiDetect = null;
    this._running = false;
    this._loopTimer = null;
    this._target = null;
    this._teammates = [];
    this._customPotions = [];
    this._attackCount = 0;
    this._lastHp = 20;
    this._hpBeforeAction = 20;
    this._lastAction = null;
    this._lastFeatures = null;
  }

  start(opts = {}) {
    if (this._running) return;
    const { bot } = this.instance;
    if (!bot?.entity) { log.warn("[PvpController] no bot entity"); return; }

    this._teammates = opts.teammates || this.instance.config.teammates || [];
    this._customPotions = opts.customPotions || [];
    this._running = true;

    this.antiDetect = new AntiDetect(bot);
    this.antiDetect.start();

    this.emit("bot:pvpStarted", { botId: this.instance.id });
    this._addChat("⚔️ PVP-режим активирован (нейросеть)");
    this._schedule();
    log.info("[PvpController] Started for bot", this.instance.id);
  }

  stop() {
    this._running = false;
    if (this._loopTimer) { clearTimeout(this._loopTimer); this._loopTimer = null; }
    this.antiDetect?.stop();
    this._target = null;
    const { bot } = this.instance;
    if (bot) {
      try { bot.pathfinder?.stop(); } catch {}
      try { bot.clearControlStates?.(); } catch {}
    }
    this.emit("bot:pvpStopped", { botId: this.instance.id });
    this._addChat("🛑 PVP-режим остановлен");
    log.info("[PvpController] Stopped for bot", this.instance.id);
  }

  _schedule() {
    if (!this._running) return;
    const delay = 580 + rand(0, 150);
    this._loopTimer = setTimeout(() => this._tick(), delay);
  }

  async _tick() {
    if (!this._running) return;
    const { bot } = this.instance;
    if (!bot?.entity) { this._schedule(); return; }

    try {
      await this._findTarget();
      if (!this._target) { this._schedule(); return; }

      this.antiDetect.setInCombat(true);

      // Записываем фичи ДО действия
      const { action, confidence, features } = this.brain.decide(bot, this._target, this._teammates);
      this._lastFeatures = features;
      this._hpBeforeAction = bot.health;

      this._addChat(`[PVP ИИ] ${action} (уверенность: ${Math.round(confidence * 100)}%)`, "system");

      await this._executeAction(action);

      // Через 1 сек оцениваем результат для обучения
      setTimeout(() => {
        if (!this._running || !bot?.entity) return;
        const wasGood = bot.health >= this._hpBeforeAction - 1;
        if (this._lastFeatures && this._lastAction) {
          this.brain.recordExperience(this._lastFeatures, { [this._lastAction]: true }, wasGood);
        }
      }, 1000);

    } catch (err) {
      log.debug("[PvpController] tick error:", err.message);
    }

    this._schedule();
  }

  async _findTarget() {
    const { bot } = this.instance;
    let closest = null;
    let minDist = 15;

    for (const entity of Object.values(bot.entities || {})) {
      if (!entity.position || entity === bot.entity) continue;
      if (entity.type !== "player" && entity.type !== "mob") continue;
      if (this._teammates.includes(entity.username)) continue;
      const d = bot.entity.position.distanceTo(entity.position);
      if (d < minDist) { minDist = d; closest = entity; }
    }

    // Проверяем что цель ещё жива
    if (closest && closest.isValid === false) closest = null;
    this._target = closest;
  }

  async _executeAction(action) {
    const { bot } = this.instance;
    this._lastAction = action;

    switch (action) {
      case "attack":   await this._doAttack(); break;
      case "retreat":  await this._doRetreat(); break;
      case "eat":      await this._doEat(); break;
      case "throwHeal": await this._doThrowPotion("heal"); break;
      case "throwPotion": await this._doThrowPotion("damage"); break;
      case "throwPerk": await this._doUsePerk(); break;
      case "strafe":   await this._doStrafe(); break;
      default:         await this._doStrafe(); break;
    }
  }

  async _doAttack() {
    const { bot } = this.instance;
    const target = this._target;
    if (!target?.isValid) return;

    if (!this.antiDetect.isInFov(target, 130)) {
      await this.antiDetect.smoothLookAt(target.position.offset(0, 1, 0), 4);
    } else {
      await this.antiDetect.smoothLookAt(target.position.offset(0, 1, 0), 2);
    }

    await sleep(AntiDetect.preAttackDelay());

    if (!bot.entity || !target.isValid) return;

    const sword = bot.inventory.items().find(i => SWORD_NAMES.some(n => i.name.includes(n)));
    if (sword && bot.heldItem?.name !== sword.name) {
      try { await bot.equip(sword, "hand"); await sleep(80); } catch {}
    }

    try {
      bot.attack(target);
      bot._lastAttackTime = Date.now();
      this._attackCount++;
    } catch (err) {
      log.debug("[PvpController] attack error:", err.message);
    }
  }

  async _doRetreat() {
    const { bot } = this.instance;
    const target = this._target;
    if (!target?.position || !bot.entity) return;

    try {
      const dx = bot.entity.position.x - target.position.x;
      const dz = bot.entity.position.z - target.position.z;
      const len = Math.sqrt(dx * dx + dz * dz) || 1;
      const retreatGoal = bot.entity.position.offset(
        (dx / len) * 8 + rand(-2, 2),
        0,
        (dz / len) * 8 + rand(-2, 2)
      );
      const { goals } = require("mineflayer-pathfinder");
      await bot.pathfinder.goto(
        new goals.GoalXZ(retreatGoal.x, retreatGoal.z)
      ).catch(() => {});
    } catch {}
  }

  async _doEat() {
    const { bot } = this.instance;
    const food = bot.inventory.items()
      .filter(i => FOOD_NAMES.includes(i.name))
      .sort((a, b) => (b.foodPoints || 0) - (a.foodPoints || 0))[0];
    if (!food) return;
    try {
      await bot.equip(food, "hand");
      await sleep(100);
      await bot.consume();
      this._addChat("🍖 Ем еду: " + food.name, "system");
    } catch {}
  }

  async _doThrowPotion(type) {
    const { bot } = this.instance;
    const names = type === "heal" ? HEAL_NAMES : BUFF_NAMES;

    // Проверяем кастомные зелья из конфига
    let potion = null;
    for (const custom of this._customPotions) {
      if (custom.type === type || (type === "heal" && custom.type === "buff")) {
        potion = bot.inventory.items().find(i => i.name.includes(custom.name));
        if (potion) break;
      }
    }
    if (!potion) {
      potion = bot.inventory.items().find(i => names.some(n => i.name.includes(n.replace("potion_of_","").replace("splash_",""))));
    }
    if (!potion) return;

    try {
      await bot.equip(potion, "hand");
      await sleep(150);
      if (type === "heal") {
        // Бросаем под себя (взгляд вниз)
        await bot.look(bot.entity.yaw, Math.PI / 4, false);
      } else if (this._target?.position) {
        await this.antiDetect.smoothLookAt(this._target.position, 3);
      }
      await sleep(100);
      await bot.activateItem();
      this._addChat(`🧪 Использовал зелье: ${potion.name}`, "system");
    } catch {}
  }

  async _doUsePerk() {
    const { bot } = this.instance;
    // Ищем баф-зелья
    const perk = bot.inventory.items().find(i =>
      BUFF_NAMES.some(n => i.name.includes(n.replace("potion_of_","").replace("splash_","")))
    );
    if (!perk) return;
    try {
      await bot.equip(perk, "hand");
      await sleep(100);
      await bot.activateItem();
      this._addChat(`✨ Применён перк: ${perk.name}`, "system");
    } catch {}
  }

  async _doStrafe() {
    const { bot } = this.instance;
    const target = this._target;
    if (!target?.position || !bot.entity) return;

    try {
      // Стрейф по кругу вокруг цели (~3 блока)
      const angle = bot.entity.yaw + (Math.random() > 0.5 ? 1 : -1) * (Math.PI / 3 + rand(0, 0.5));
      const radius = 2.5 + rand(0, 1);
      const goal = target.position.offset(
        Math.sin(angle) * radius,
        0,
        Math.cos(angle) * radius
      );
      const { goals } = require("mineflayer-pathfinder");
      await Promise.race([
        bot.pathfinder.goto(new goals.GoalXZ(goal.x, goal.z)),
        sleep(800),
      ]).catch(() => {});

      // После стрейфа смотрим на цель
      if (target.position) {
        await this.antiDetect.smoothLookAt(target.position.offset(0, 1, 0), 3);
      }
    } catch {}
  }

  _addChat(msg, type = "system") {
    this.emit("bot:chat", {
      botId: this.instance.id,
      username: "pvp-ai",
      message: msg,
      type,
    });
  }

  isRunning() { return this._running; }
  getTarget() { return this._target?.username || this._target?.name || null; }
  getAttackCount() { return this._attackCount; }
}

module.exports = { PvpController };
