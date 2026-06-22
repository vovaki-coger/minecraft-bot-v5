/**
 * PvpController v2 — PVP с фиксом анти-чита
 *
 * Главные фиксы vs v1:
 *  - _doEat: СТОП pathfinder + clearControlStates + задержка перед consume
 *  - _doAttack: проверка reach ≤ 3.2, приоритет меча, clearControlStates
 *  - _doStrafe: короче дистанция, без sprint, clearControlStates после
 *  - _doRetreat: clearControlStates после отступления
 *  - Все действия: clearControlStates после каждого (анти-детект движения)
 */

const log = require("electron-log");
const { PvpBrain } = require("./pvp-brain");
const { AntiDetect } = require("./anti-detect");

const SWORD_NAMES = [
  "wooden_sword","stone_sword","iron_sword","golden_sword",
  "diamond_sword","netherite_sword","mace",
];
const AXE_NAMES = ["wooden_axe","stone_axe","iron_axe","golden_axe","diamond_axe","netherite_axe"];
const HEAL_NAMES = [
  "potion_of_healing","splash_potion_of_healing",
  "potion_of_instant_health","splash_potion_of_instant_health",
  "potion_of_regeneration","splash_potion_of_regeneration",
];
const BUFF_NAMES = [
  "potion_of_strength","splash_potion_of_strength",
  "potion_of_speed","splash_potion_of_speed",
];
const FOOD_NAMES = [
  "cooked_beef","cooked_porkchop","cooked_chicken","cooked_mutton","cooked_rabbit",
  "cooked_salmon","cooked_cod","golden_apple","enchanted_golden_apple",
  "bread","apple","carrot","baked_potato","pumpkin_pie","melon_slice",
  "mushroom_stew","rabbit_stew","suspicious_stew","dried_kelp","cookie",
];

function rand(min, max) { return min + Math.random() * (max - min); }
function sleep(ms)      { return new Promise(r => setTimeout(r, ms)); }

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

    // Отключаем спринт — главная причина "Invalid move player packet"
    try {
      const { Movements } = require("mineflayer-pathfinder");
      const m = new Movements(bot);
      m.allowSprinting  = false;
      m.allow1by1towers = false;
      m.canDig          = false;
      bot.pathfinder.setMovements(m);
    } catch {}

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
    const d = AntiDetect.attackDelay();
    this._loopTimer = setTimeout(() => this._tick(), d);
  }

  async _tick() {
    if (!this._running) return;
    const { bot } = this.instance;
    if (!bot?.entity) { this._schedule(); return; }

    try {
      await this._findTarget();
      if (!this._target) { this._schedule(); return; }

      this.antiDetect.setInCombat(true);

      const { action, confidence, features } = this.brain.decide(bot, this._target, this._teammates);
      this._lastFeatures = features;
      this._hpBeforeAction = bot.health;

      this._addChat(`[PVP ИИ] ${action} (уверенность: ${Math.round(confidence * 100)}%)`, "system");

      await this._executeAction(action);

      // Оцениваем результат через 1 сек для обучения
      setTimeout(() => {
        if (!this._running || !bot?.entity) return;
        const wasGood = bot.health >= this._hpBeforeAction - 1.5;
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
    let closest = null, minDist = 16;

    for (const entity of Object.values(bot.entities || {})) {
      if (!entity.position || entity === bot.entity) continue;
      if (entity.type !== "player" && entity.type !== "mob") continue;
      if (this._teammates.includes(entity.username)) continue;
      if (entity.username === bot.username) continue;
      const d = bot.entity.position.distanceTo(entity.position);
      if (d < minDist) { minDist = d; closest = entity; }
    }

    if (closest?.isValid === false) closest = null;
    this._target = closest;
  }

  async _executeAction(action) {
    this._lastAction = action;
    switch (action) {
      case "attack":      await this._doAttack();           break;
      case "retreat":     await this._doRetreat();          break;
      case "eat":         await this._doEat();              break;
      case "throwHeal":   await this._doThrowPotion("heal"); break;
      case "throwPotion": await this._doThrowPotion("damage"); break;
      case "throwPerk":   await this._doUsePerk();          break;
      case "strafe":      await this._doStrafe();           break;
      default:            await this._doStrafe();           break;
    }
  }

  // ── АТАКА ──────────────────────────────────────────────────────────
  async _doAttack() {
    const { bot } = this.instance;
    const target = this._target;
    if (!target?.isValid && target?.isValid !== undefined) return;

    const dist = bot.entity?.position?.distanceTo(target.position) ?? 99;

    // Сближаемся если далеко (≤ 3.2 блока — vanilla reach)
    if (dist > 3.5) {
      try {
        const { goals } = require("mineflayer-pathfinder");
        await Promise.race([
          bot.pathfinder.goto(new goals.GoalNear(
            target.position.x, target.position.y, target.position.z, 2.5
          )),
          sleep(1500),
        ]).catch(() => {});
      } catch {}
    }
    try { bot.pathfinder?.stop(); } catch {}
    try { bot.clearControlStates(); } catch {}

    if (!bot.entity || !target.isValid && target.isValid !== undefined) return;

    // Плавный поворот к голове цели
    const headPos = target.position.offset(0, (target.height ?? 1.8) * 0.85, 0);
    if (!this.antiDetect.isInFov(target, 130)) {
      await this.antiDetect.smoothLookAt(headPos, 5);
    } else {
      await this.antiDetect.smoothLookAt(headPos, 3);
    }

    await sleep(AntiDetect.preAttackDelay());

    if (!bot.entity) return;

    // Экипируем меч если не в руке
    const weapon = bot.inventory.items().find(i =>
      SWORD_NAMES.some(n => i.name.includes(n)) ||
      AXE_NAMES.some(n => i.name.includes(n))
    );
    if (weapon && bot.heldItem?.name !== weapon.name) {
      try { await bot.equip(weapon, "hand"); await sleep(60); } catch {}
    }

    // Атакуем только если цель в reach (≤ 3.5 блока после движения)
    const distNow = bot.entity.position.distanceTo(target.position);
    if (distNow > 3.8) return; // не можем достать — пропускаем тик

    try {
      bot.attack(target);
      bot._lastAttackTime = Date.now();
      this._attackCount++;
    } catch (err) {
      log.debug("[PvpController] attack error:", err.message);
    }
  }

  // ── ОТСТУПЛЕНИЕ ────────────────────────────────────────────────────
  async _doRetreat() {
    const { bot } = this.instance;
    const target = this._target;
    if (!target?.position || !bot.entity) return;
    try {
      bot.pathfinder?.stop();
      bot.clearControlStates();
      await sleep(50);

      const dx = bot.entity.position.x - target.position.x;
      const dz = bot.entity.position.z - target.position.z;
      const len = Math.sqrt(dx*dx + dz*dz) || 1;
      const tx = bot.entity.position.x + (dx / len) * 7 + rand(-1.5, 1.5);
      const tz = bot.entity.position.z + (dz / len) * 7 + rand(-1.5, 1.5);

      const { goals } = require("mineflayer-pathfinder");
      await Promise.race([
        bot.pathfinder.goto(new goals.GoalXZ(tx, tz)),
        sleep(1200),
      ]).catch(() => {});
    } catch {}
    try { bot.pathfinder?.stop(); } catch {}
    try { bot.clearControlStates(); } catch {}
  }

  // ── ЕДА (АНТИДЕТЕКТ-БЕЗОПАСНО) ────────────────────────────────────
  // Главный фикс: сначала СТОП, потом delay, потом consume
  // Сервера детектируют consume во время движения как читерство
  async _doEat() {
    const { bot } = this.instance;
    const food = bot.inventory.items()
      .filter(i => FOOD_NAMES.includes(i.name))
      .sort((a, b) => (b.foodPoints || 0) - (a.foodPoints || 0))[0];
    if (!food) return;

    try {
      // 1. Остановить pathfinder и все клавиши
      try { bot.pathfinder?.stop(); } catch {}
      try { bot.clearControlStates(); } catch {}

      // 2. Human reaction delay (200-400ms) перед едой
      await sleep(200 + rand(0, 200));

      // 3. Экипируем еду
      await bot.equip(food, "hand");

      // 4. Задержка между equip и consume (80-140ms)
      await sleep(80 + rand(0, 60));

      // 5. Едим
      await bot.consume();

      this._addChat("🍖 Ем еду: " + food.name, "system");
    } catch (err) {
      log.debug("[PvpController] eat error:", err.message);
    }
  }

  // ── ЗЕЛЬЯ ──────────────────────────────────────────────────────────
  async _doThrowPotion(type) {
    const { bot } = this.instance;
    const names = type === "heal" ? HEAL_NAMES : BUFF_NAMES;

    let potion = null;
    for (const custom of this._customPotions) {
      if (custom.type === type) {
        potion = bot.inventory.items().find(i => i.name.includes(custom.name));
        if (potion) break;
      }
    }
    if (!potion) {
      potion = bot.inventory.items().find(i =>
        names.some(n => i.name.includes(n.replace("potion_of_","").replace("splash_","")))
      );
    }
    if (!potion) return;

    try {
      try { bot.pathfinder?.stop(); } catch {}
      try { bot.clearControlStates(); } catch {}
      await sleep(150 + rand(0, 100));

      await bot.equip(potion, "hand");
      await sleep(100 + rand(0, 50));

      if (type === "heal") {
        await bot.look(bot.entity.yaw, Math.PI / 4, false);
      } else if (this._target?.position) {
        await this.antiDetect.smoothLookAt(this._target.position, 3);
      }
      await sleep(80 + rand(0, 40));
      bot.activateItem();
      this._addChat("🧪 Использовал: " + potion.name, "system");
    } catch {}
  }

  // ── ПЕРК ───────────────────────────────────────────────────────────
  async _doUsePerk() {
    const { bot } = this.instance;
    const perk = bot.inventory.items().find(i =>
      BUFF_NAMES.some(n => i.name.includes(n.replace("potion_of_","").replace("splash_","")))
    );
    if (!perk) return;
    try {
      try { bot.pathfinder?.stop(); } catch {}
      try { bot.clearControlStates(); } catch {}
      await sleep(100 + rand(0, 80));
      await bot.equip(perk, "hand");
      await sleep(80 + rand(0, 40));
      bot.activateItem();
      this._addChat("✨ Перк: " + perk.name, "system");
    } catch {}
  }

  // ── СТРЕЙФ ─────────────────────────────────────────────────────────
  // allowSprinting = false, короткое расстояние (~2.5 блока)
  async _doStrafe() {
    const { bot } = this.instance;
    const target = this._target;
    if (!target?.position || !bot.entity) return;

    try {
      const angle = bot.entity.yaw + (Math.random() > 0.5 ? 1 : -1) * (0.8 + rand(0, 0.6));
      const radius = 2.5 + rand(-0.3, 0.5);
      const goal = target.position.offset(
        Math.sin(angle) * radius,
        0,
        Math.cos(angle) * radius
      );
      const { goals } = require("mineflayer-pathfinder");
      await Promise.race([
        bot.pathfinder.goto(new goals.GoalXZ(goal.x, goal.z)),
        sleep(700),
      ]).catch(() => {});

      // После стрейфа — смотрим на цель
      if (target.position) {
        await this.antiDetect.smoothLookAt(target.position.offset(0, 1, 0), 3);
      }
    } catch {}
    // Всегда чистим состояния после движения
    try { bot.clearControlStates(); } catch {}
  }

  _addChat(msg, type = "system") {
    this.emit("bot:chat", {
      botId:    this.instance.id,
      username: "pvp-ai",
      message:  msg,
      type,
    });
  }

  isRunning()     { return this._running; }
  getTarget()     { return this._target?.username || this._target?.name || null; }
  getAttackCount(){ return this._attackCount; }
}

module.exports = { PvpController };
