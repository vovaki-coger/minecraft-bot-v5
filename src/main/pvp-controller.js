/**
 * PvpController v3 — Legacy 1.8 CPS + Modern 1.9+ cooldown
 *
 * Главные фиксы vs v2:
 *  - serverMode "legacy" (1.8, без кулдауна): атака каждые 80-120ms (8-12 CPS)
 *  - serverMode "modern" (1.9+): атака каждые 580-730ms
 *  - После еды: _forceAttackTicks > 0 → принудительно атакуем N тиков
 *  - Enchanted golden apple: 2-мин кулдаун, только при HP <= 4
 *  - Приоритет еды: golden_carrot → steak/pork → chicken → bread → apple → gapple
 *  - Взрывные зелья: смотрим на врага и кидаем (splash) или вверх (self)
 *  - Проверка иммунитета после спауна (3 сек)
 */

const log = require("electron-log");
const { PvpBrain } = require("./pvp-brain");
const { AntiDetect } = require("./anti-detect");

const SWORD_NAMES = [
  "wooden_sword","stone_sword","iron_sword","golden_sword",
  "diamond_sword","netherite_sword","mace",
];
const AXE_NAMES = ["wooden_axe","stone_axe","iron_axe","golden_axe","diamond_axe","netherite_axe"];

// Зелья лечения (хилки)
const HEAL_POTION_NAMES = ["healing","instant_health","regeneration"];
// Баф-зелья (кидаем на себя)
const BUFF_POTION_NAMES  = ["strength","speed","resistance","fire_resistance","absorption"];
// Дебаф-зелья (кидаем на врага)
const DEBUFF_POTION_NAMES = ["poison","weakness","slowness","blindness","instant_damage","harming"];

// Приоритет еды — НЕ включает enchanted_golden_apple (отдельная логика)
const FOOD_PRIORITY = [
  "golden_carrot",       // 6 еды, насыщение 14.4 — лучший выбор для ПВП
  "cooked_beef",         // стейк: 8 еды
  "cooked_porkchop",     // свинина: 8 еды
  "cooked_mutton",       // баранина: 6 еды
  "cooked_chicken",      // курица: 6 еды
  "cooked_salmon",       // лосось: 6 еды
  "cooked_cod",          // треска: 5 еды
  "bread",               // хлеб: 5 еды
  "baked_potato",        // печёная картошка: 5 еды
  "golden_apple",        // обычная гэпл (поглощение 1) — не чара
  "apple",               // яблоко: 4 еды
  "carrot",              // морковь: 3 еды
  "melon_slice",         // арбуз: 2 еды
  "mushroom_stew",       // грибной суп: 6 еды
  "rabbit_stew",         // кроличий суп: 10 еды
  "pumpkin_pie",         // тыквенный пирог: 8 еды
  "cookie",              // печенька: 2 еды
  "dried_kelp",          // сухие водоросли: 1 еда
];

const GAPPLE_COOLDOWN_MS = 2 * 60 * 1000; // 2 минуты

function rand(min, max) { return min + Math.random() * (max - min); }
function sleep(ms)      { return new Promise(r => setTimeout(r, ms)); }

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

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
    this._serverMode = "legacy";   // "legacy" (1.8) | "modern" (1.9+)
    this._serverProfile = "custom"; // SpookyTime | FunTime | RealWorld | custom
    this._tickCount = 0;
    this._forceAttackTicks = 0;    // После еды — принудительно атаковать N тиков
    this._gappleCooldownEnd = 0;   // Timestamp конца кулдауна enchanted gapple
    this._isDoingAction = false;   // Блокировка параллельных действий
    this._spawnTime = Date.now();  // Время спауна — 3 сек иммунитет
  }

  start(opts = {}) {
    if (this._running) return;
    const { bot } = this.instance;
    if (!bot?.entity) { log.warn("[PvpController] no bot entity"); return; }

    this._teammates    = opts.teammates    || this.instance.config?.teammates || [];
    this._customPotions = opts.customPotions || [];
    this._serverMode   = opts.serverMode   || this.instance.config?.pvpServerMode   || "legacy";
    this._serverProfile = opts.serverProfile || this.instance.config?.pvpServerProfile || "custom";
    this._running = true;
    this._spawnTime = Date.now();
    this._tickCount = 0;
    this._forceAttackTicks = 0;

    this.antiDetect = new AntiDetect(bot);
    this.antiDetect.start();

    // Pathfinder: без спринта для антидетекта
    try {
      const { Movements } = require("mineflayer-pathfinder");
      const m = new Movements(bot);
      m.allowSprinting  = false;
      m.allow1by1towers = false;
      m.canDig          = false;
      bot.pathfinder.setMovements(m);
    } catch {}

    this.emit("bot:pvpStarted", { botId: this.instance.id });
    this._addChat(`⚔️ PVP активирован [${this._serverMode === "legacy" ? "1.8 CPS" : "1.9 cooldown"}] (${this._serverProfile})`);
    this._schedule();
    log.info(`[PvpController] Started mode=${this._serverMode} profile=${this._serverProfile}`);
  }

  stop() {
    this._running = false;
    if (this._loopTimer) { clearTimeout(this._loopTimer); this._loopTimer = null; }
    this.antiDetect?.stop();
    this._target = null;
    this._isDoingAction = false;
    const { bot } = this.instance;
    if (bot) {
      try { bot.pathfinder?.stop(); } catch {}
      try { bot.clearControlStates?.(); } catch {}
    }
    this.emit("bot:pvpStopped", { botId: this.instance.id });
    this._addChat("🛑 PVP остановлен");
    log.info("[PvpController] Stopped");
  }

  _schedule() {
    if (!this._running) return;
    // Legacy (1.8): быстрая атака каждые 80-120ms (8-12 CPS)
    // Modern (1.9+): кулдаун каждые 580-730ms
    const d = this._serverMode === "legacy"
      ? (80 + Math.random() * 40)
      : AntiDetect.attackDelay();
    this._loopTimer = setTimeout(() => this._tick(), d);
  }

  async _tick() {
    if (!this._running) return;
    const { bot } = this.instance;
    if (!bot?.entity) { this._schedule(); return; }

    // Иммунитет после спауна (3 сек)
    if (Date.now() - this._spawnTime < 3000) { this._schedule(); return; }

    this._tickCount++;

    try {
      await this._findTarget();

      if (!this._target) {
        this.antiDetect?.setInCombat(false);
        this._schedule();
        return;
      }

      this.antiDetect?.setInCombat(true);
      this._hpBeforeAction = bot.health;

      if (this._serverMode === "legacy") {
        await this._tickLegacy(bot);
      } else {
        await this._tickModern(bot);
      }
    } catch (err) {
      log.debug("[PvpController] tick error:", err.message);
    }

    this._schedule();
  }

  // ── РЕЖИМ LEGACY (1.8 — без кулдауна, быстрые атаки) ────────────────
  async _tickLegacy(bot) {
    if (this._isDoingAction) return; // Не прерывать еду/зелье

    const hp = bot.health ?? 20;
    const food = bot.food ?? 20;
    const dist = this._target ? bot.entity.position.distanceTo(this._target.position) : 99;

    // Каждые ~2 сек (25 тиков × 80ms) проверяем критические нужды
    if (this._tickCount % 25 === 0) {
      // 1. Критически низкое HP — enchanted gapple (при кулдауне готов)
      if (hp <= 4 && Date.now() >= this._gappleCooldownEnd) {
        const egapple = bot.inventory.items().find(i => i.name === "enchanted_golden_apple");
        if (egapple) {
          await this._doEatItem(egapple, true);
          return;
        }
      }
      // 2. Хилка/зелье при низком HP
      if (hp <= 8) {
        const healed = await this._tryHealPotion(bot);
        if (healed) return;
      }
      // 3. Буф-зелье раз в 30 сек
      if (this._tickCount % 375 === 0) { // 375 × 80ms = 30 сек
        await this._tryBuffPotion(bot);
      }
      // 4. Еда при голоде
      if (food <= 14) {
        const foodItem = this._selectFood(bot);
        if (foodItem) {
          await this._doEatItem(foodItem, false);
          return;
        }
      }
    }

    // После еды: принудительно атакуем
    if (this._forceAttackTicks > 0) {
      this._forceAttackTicks--;
      await this._doAttackLegacy(bot);
      return;
    }

    // Основная логика: атака или сближение
    if (dist <= 4.5) {
      await this._doAttackLegacy(bot);
    } else if (dist <= 16) {
      await this._chaseTarget(bot);
    }
  }

  // ── РЕЖИМ MODERN (1.9+ с кулдауном) ─────────────────────────────────
  async _tickModern(bot) {
    const { action, confidence, features } = this.brain.decide(bot, this._target, this._teammates, {
      gappleCooldown: this._gappleCooldownEnd > Date.now(),
    });
    this._lastFeatures = features;

    this._addChat(`[PVP ИИ] ${action} (уверенность: ${Math.round(confidence * 100)}%)`, "system");

    // После еды — игнорируем eat-решение мозга на N тиков
    let finalAction = action;
    if (this._forceAttackTicks > 0 && action === "eat") {
      this._forceAttackTicks--;
      finalAction = "attack";
    }

    await this._executeAction(finalAction, bot);

    // Оцениваем результат через 1 сек для обучения
    setTimeout(() => {
      if (!this._running || !bot?.entity) return;
      const wasGood = bot.health >= this._hpBeforeAction - 1.5;
      if (this._lastFeatures && this._lastAction) {
        this.brain.recordExperience(this._lastFeatures, { [this._lastAction]: true }, wasGood);
      }
    }, 1000);
  }

  async _executeAction(action, bot) {
    this._lastAction = action;
    switch (action) {
      case "attack":      await this._doAttackModern(bot);             break;
      case "retreat":     await this._doRetreat(bot);                  break;
      case "eat":         await this._doEatModern(bot);                break;
      case "throwHeal":   await this._doSplashPotion(bot, "heal");     break;
      case "throwPotion": await this._doSplashPotion(bot, "damage");   break;
      case "throwPerk":   await this._doSplashPotion(bot, "buff");     break;
      case "strafe":      await this._doStrafe(bot);                   break;
      default:            await this._doStrafe(bot);                   break;
    }
  }

  // ── АТАКА LEGACY (1.8 — мгновенная, без задержек) ───────────────────
  async _doAttackLegacy(bot) {
    const target = this._target;
    if (!target || !bot.entity) return;

    const pos = bot.entity.position;
    const tpos = target.position;
    const headY = tpos.y + (target.height ?? 1.8) * 0.85;

    // Мгновенный поворот к голове цели (без smoothLookAt — быстро!)
    const dx = tpos.x - pos.x;
    const dz = tpos.z - pos.z;
    const dist2d = Math.sqrt(dx*dx + dz*dz);
    const yaw = Math.atan2(-dx, -dz);
    const pitch = -Math.atan2(headY - (pos.y + 1.6), dist2d);
    try { await bot.look(yaw, pitch, false); } catch {}

    // Экипируем меч если не в руке (только раз в 5 тиков)
    if (this._tickCount % 5 === 0) {
      const weapon = bot.inventory.items().find(i =>
        SWORD_NAMES.some(n => i.name.includes(n)) || AXE_NAMES.some(n => i.name.includes(n))
      );
      if (weapon && bot.heldItem?.name !== weapon.name) {
        try { await bot.equip(weapon, "hand"); } catch {}
      }
    }

    // Атака!
    const distNow = bot.entity.position.distanceTo(target.position);
    if (distNow <= 4.5) {
      try {
        bot.attack(target);
        bot._lastAttackTime = Date.now();
        this._attackCount++;
      } catch (err) {
        log.debug("[PvpController] attack error:", err.message);
      }
    }
  }

  // ── АТАКА MODERN (1.9+ с кулдауном и плавным поворотом) ─────────────
  async _doAttackModern(bot) {
    const target = this._target;
    if (!target?.isValid && target?.isValid !== undefined) return;

    const dist = bot.entity?.position?.distanceTo(target.position) ?? 99;

    // Сближение
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

    if (!bot.entity) return;

    // Плавный поворот к голове цели (для 1.9 важен правильный угол)
    const headPos = target.position.offset(0, (target.height ?? 1.8) * 0.85, 0);
    if (!this.antiDetect.isInFov(target, 130)) {
      await this.antiDetect.smoothLookAt(headPos, 5);
    } else {
      await this.antiDetect.smoothLookAt(headPos, 3);
    }

    await sleep(AntiDetect.preAttackDelay());
    if (!bot.entity) return;

    // Экипируем меч
    const weapon = bot.inventory.items().find(i =>
      SWORD_NAMES.some(n => i.name.includes(n)) || AXE_NAMES.some(n => i.name.includes(n))
    );
    if (weapon && bot.heldItem?.name !== weapon.name) {
      try { await bot.equip(weapon, "hand"); await sleep(60); } catch {}
    }

    // Проверяем reach
    const distNow = bot.entity.position.distanceTo(target.position);
    if (distNow > 3.8) return;

    try {
      bot.attack(target);
      bot._lastAttackTime = Date.now();
      this._attackCount++;
    } catch (err) {
      log.debug("[PvpController] attack error:", err.message);
    }
  }

  // ── СБЛИЖЕНИЕ (legacy) ───────────────────────────────────────────────
  async _chaseTarget(bot) {
    const target = this._target;
    if (!target?.position) return;
    try {
      const { goals } = require("mineflayer-pathfinder");
      bot.pathfinder.setGoal(
        new goals.GoalNear(target.position.x, target.position.y, target.position.z, 2.0),
        true
      );
    } catch {}
  }

  // ── ОТСТУПЛЕНИЕ ─────────────────────────────────────────────────────
  async _doRetreat(bot) {
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

  // ── ВЫБОР ЕДЫ (приоритет: морковь золотая → мясо → хлеб → яблоко → гепл экстренно) ──
  _selectFood(bot) {
    const items = bot.inventory.items();
    // Перебираем по приоритету
    for (const name of FOOD_PRIORITY) {
      const item = items.find(i => i.name === name);
      if (item) return item;
    }
    // Фоллбэк: любая еда кроме enchanted golden apple (она только экстренная)
    return items.find(i => i.foodPoints && i.foodPoints > 0 && i.name !== "enchanted_golden_apple") || null;
  }

  // ── ЕДА (LEGACY — быстрее, короче задержки) ──────────────────────────
  async _doEatItem(foodItem, isGapple) {
    const { bot } = this.instance;
    this._isDoingAction = true;
    try {
      try { bot.pathfinder?.stop(); } catch {}
      try { bot.clearControlStates(); } catch {}

      // Короткая пауза (анти-детект: нельзя есть во время движения)
      await sleep(150 + rand(0, 100));

      await bot.equip(foodItem, "hand");
      await sleep(60 + rand(0, 40));

      await bot.consume();

      if (isGapple) {
        this._gappleCooldownEnd = Date.now() + GAPPLE_COOLDOWN_MS;
        this._addChat(`✨ Enchanted Golden Apple! Кулдаун 2 мин.`, "system");
      } else {
        this._addChat(`🍖 Съел: ${foodItem.name}`, "system");
      }

      // После еды — принудительно возвращаемся в атаку на 5 тиков
      this._forceAttackTicks = 5;

    } catch (err) {
      log.debug("[PvpController] eat error:", err.message);
    } finally {
      this._isDoingAction = false;
    }
  }

  // ── ЕДА MODERN (вызывается из brain decide) ──────────────────────────
  async _doEatModern(bot) {
    const hp = bot.health ?? 20;

    // Enchanted gapple только при критическом HP
    if (hp <= 4 && Date.now() >= this._gappleCooldownEnd) {
      const egapple = bot.inventory.items().find(i => i.name === "enchanted_golden_apple");
      if (egapple) {
        await this._doEatItem(egapple, true);
        return;
      }
    }

    const foodItem = this._selectFood(bot);
    if (!foodItem) return;
    await this._doEatItem(foodItem, false);
  }

  // ── ХИЛКА-ЗЕЛЬЕ ─────────────────────────────────────────────────────
  async _tryHealPotion(bot) {
    const potion = bot.inventory.items().find(i => {
      const n = i.name.toLowerCase();
      return HEAL_POTION_NAMES.some(k => n.includes(k));
    });
    if (!potion) return false;
    await this._doSplashPotion(bot, "heal", potion);
    return true;
  }

  // ── БАФ-ЗЕЛЬЕ ───────────────────────────────────────────────────────
  async _tryBuffPotion(bot) {
    const potion = bot.inventory.items().find(i => {
      const n = i.name.toLowerCase();
      return BUFF_POTION_NAMES.some(k => n.includes(k));
    });
    if (!potion) return false;
    await this._doSplashPotion(bot, "buff", potion);
    return true;
  }

  // ── ВЗРЫВНОЕ/СПЛЭШ ЗЕЛЬЕ ─────────────────────────────────────────────
  // type: "heal" (кидаем под себя), "buff" (смотрим вверх, бросаем на себя),
  //       "damage" (кидаем во врага), "debuff" (кидаем во врага)
  async _doSplashPotion(bot, type, forcedPotion) {
    let potion = forcedPotion;

    if (!potion) {
      if (type === "heal") {
        potion = bot.inventory.items().find(i => {
          const n = i.name.toLowerCase();
          return n.includes("splash") && HEAL_POTION_NAMES.some(k => n.includes(k));
        });
        // Если splash нет — обычное
        if (!potion) potion = bot.inventory.items().find(i => {
          const n = i.name.toLowerCase();
          return HEAL_POTION_NAMES.some(k => n.includes(k));
        });
      } else if (type === "buff") {
        potion = bot.inventory.items().find(i => {
          const n = i.name.toLowerCase();
          return BUFF_POTION_NAMES.some(k => n.includes(k));
        });
      } else if (type === "damage" || type === "debuff") {
        potion = bot.inventory.items().find(i => {
          const n = i.name.toLowerCase();
          return n.includes("splash") && DEBUFF_POTION_NAMES.some(k => n.includes(k));
        });
      }
    }

    if (!potion) return;

    this._isDoingAction = true;
    try {
      try { bot.pathfinder?.stop(); } catch {}
      try { bot.clearControlStates(); } catch {}
      await sleep(100 + rand(0, 80));

      await bot.equip(potion, "hand");
      await sleep(80 + rand(0, 40));

      const isSplash = potion.name.toLowerCase().includes("splash");

      if (type === "heal" || type === "buff") {
        // Смотрим вверх (45°) — зелье падает под себя
        await bot.look(bot.entity.yaw, -Math.PI / 4, false);
      } else if ((type === "damage" || type === "debuff") && this._target?.position) {
        // Смотрим на врага и чуть вверх чтобы зелье долетело
        const dx = this._target.position.x - bot.entity.position.x;
        const dz = this._target.position.z - bot.entity.position.z;
        const dist2d = Math.sqrt(dx*dx + dz*dz);
        const yaw = Math.atan2(-dx, -dz);
        // Угол броска: для 3-5 блоков нужно ~20-30° вверх
        const pitch = -Math.PI / 8;
        await bot.look(yaw, pitch, false);
      }

      await sleep(60 + rand(0, 30));
      bot.activateItem(); // Бросаем/пьём зелье

      const label = type === "heal" ? "💊" : type === "buff" ? "✨" : type === "damage" ? "💥" : "☠️";
      this._addChat(`${label} Зелье: ${potion.name}`, "system");

      // После зелья тоже возвращаемся в атаку
      this._forceAttackTicks = 3;
    } catch (err) {
      log.debug("[PvpController] potion error:", err.message);
    } finally {
      this._isDoingAction = false;
    }
  }

  // ── СТРЕЙФ ──────────────────────────────────────────────────────────
  async _doStrafe(bot) {
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

      if (target.position) {
        await this.antiDetect.smoothLookAt(target.position.offset(0, 1, 0), 3);
      }
    } catch {}
    try { bot.clearControlStates(); } catch {}
  }

  // ── ПОИСК ЦЕЛИ ──────────────────────────────────────────────────────
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

  _addChat(msg, type = "system") {
    this.emit("bot:chat", {
      botId:    this.instance.id,
      username: "pvp-ai",
      message:  msg,
      type,
    });
  }

  isRunning()      { return this._running; }
  getTarget()      { return this._target?.username || this._target?.name || null; }
  getAttackCount() { return this._attackCount; }
}

module.exports = { PvpController };
