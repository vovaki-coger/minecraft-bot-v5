/**
 * PvpController v4 — Медленное PVP с критами, умная еда, прямое движение
 *
 * Ключевые фиксы v4 vs v3:
 * - Движение: ТОЛЬКО setControlState forward/jump (не pathfinder) — фикс "ходьбы на месте"
 * - Критические удары: прыжок каждые 2 удара → атака на падении
 * - Умная еда по HP:
 *     food < 16 + HP >= 15  → обычная еда (морковь, мясо)
 *     HP <= 8 + food >= 18  → сразу гэпл
 *     HP <= 8 + food < 18   → сначала мясо, потом гэпл
 * - Оба кулдауна: golden_apple (SpookyTime=30с) и enchanted_golden_apple (SpookyTime=150с)
 * - Убран переключатель режима — всегда медленное PVP с критами
 */

const log = require("electron-log");
const { PvpBrain } = require("./pvp-brain");
const { AntiDetect } = require("./anti-detect");

const SWORD_NAMES = ["wooden_sword","stone_sword","iron_sword","golden_sword","diamond_sword","netherite_sword","mace"];
const AXE_NAMES   = ["wooden_axe","stone_axe","iron_axe","golden_axe","diamond_axe","netherite_axe"];
const HEAL_POTION = ["healing","instant_health","regeneration"];
const BUFF_POTION = ["strength","speed","resistance","fire_resistance","absorption"];
const DEBUFF_POTION = ["poison","weakness","slowness","blindness","instant_damage","harming"];

// Приоритет обычной еды (НЕ гэплы — они отдельно по логике HP)
const FOOD_PRIORITY = [
  "golden_carrot","cooked_beef","cooked_porkchop","cooked_mutton","cooked_chicken",
  "cooked_salmon","cooked_cod","bread","baked_potato","apple","carrot",
  "mushroom_stew","rabbit_stew","pumpkin_pie","melon_slice","cookie","dried_kelp",
];

function rand(min, max) { return min + Math.random() * (max - min); }
function sleep(ms)      { return new Promise(r => setTimeout(r, ms)); }

class PvpController {
  constructor(instance, emit) {
    this.instance   = instance;
    this.emit       = emit;
    this.brain      = new PvpBrain();
    this.antiDetect = null;
    this._running   = false;
    this._loopTimer = null;
    this._target    = null;
    this._teammates = [];
    this._customPotions = [];
    this._attackCount   = 0;
    this._tickCount     = 0;
    this._hitCount      = 0;           // Для подсчёта критов (крит каждые 2 удара)
    this._forceAttackTicks = 0;
    this._isDoingAction    = false;
    this._spawnTime        = Date.now();

    // Кулдауны — задаются из serverProfile
    this._gappleCooldown         = 0;    // ms, golden_apple
    this._enchantedGappleCooldown = 120000; // ms, enchanted_golden_apple (ванилла=120с)
    this._gappleCooldownEnd         = 0;
    this._enchantedGappleCooldownEnd = 0;
  }

  start(opts = {}) {
    if (this._running) return;
    const { bot } = this.instance;
    if (!bot?.entity) { log.warn("[PvpController] no bot entity"); return; }

    this._teammates     = opts.teammates    || this.instance.config?.teammates || [];
    this._customPotions = opts.customPotions || [];

    // Кулдауны из профиля сервера (мс)
    const gappleSecRaw    = opts.gappleCooldown ?? this.instance.config?.pvpGappleCooldown ?? 0;
    const enchGappleSecRaw = opts.enchantedGappleCooldown
      ?? this.instance.config?.pvpEnchantedGappleCooldown
      ?? (this.instance.config?.pvpGappleCooldown != null ? this.instance.config.pvpGappleCooldown + 120 : 120);
    this._gappleCooldown          = gappleSecRaw * 1000;
    this._enchantedGappleCooldown = enchGappleSecRaw * 1000;

    this._running   = true;
    this._spawnTime = Date.now();
    this._tickCount = 0;
    this._hitCount  = 0;
    this._forceAttackTicks = 0;
    this._isDoingAction    = false;
    this._gappleCooldownEnd          = 0;
    this._enchantedGappleCooldownEnd = 0;

    this.antiDetect = new AntiDetect(bot);
    this.antiDetect.start();

    // Pathfinder: устанавливаем Movements, но pathfinder.goto НЕ используем в legacy
    try {
      const { Movements } = require("mineflayer-pathfinder");
      const m = new Movements(bot);
      m.allowSprinting  = false;
      m.allow1by1towers = false;
      m.canDig          = false;
      bot.pathfinder.setMovements(m);
    } catch {}

    this.emit("bot:pvpStarted", { botId: this.instance.id });
    const profile = this.instance.config?.pvpServerProfile || "custom";
    this._addChat(`⚔️ PVP активирован [медленное+крит] (${profile})`);
    this._schedule();
    log.info(`[PvpController] Started profile=${profile} gappleCD=${this._gappleCooldown/1000}s enchCD=${this._enchantedGappleCooldown/1000}s`);
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

  // Медленный тик: ~500-700ms (человекоподобно)
  _schedule() {
    if (!this._running) return;
    const d = AntiDetect.attackDelay(); // 580-730ms
    this._loopTimer = setTimeout(() => this._tick(), d);
  }

  async _tick() {
    if (!this._running) return;
    const { bot } = this.instance;
    if (!bot?.entity) { this._schedule(); return; }
    // 3 секунды иммунитета после спауна
    if (Date.now() - this._spawnTime < 3000) { this._schedule(); return; }

    this._tickCount++;

    try {
      await this._findTarget();

      if (!this._target) {
        this.antiDetect?.setInCombat(false);
        try { bot.setControlState?.('forward', false); } catch {}
        this._schedule();
        return;
      }
      this.antiDetect?.setInCombat(true);

      // Если идёт еда/зелье — не мешаем
      if (this._isDoingAction) { this._schedule(); return; }

      const hp   = bot.health ?? 20;
      const food = bot.food ?? 20;
      const dist = bot.entity.position.distanceTo(this._target.position);

      // ── Приоритет действий ────────────────────────────────────────────
      // 1. ЭКСТРЕННОЕ ЛЕЧЕНИЕ — HP ≤ 4 (2 сердца)
      if (hp <= 4) {
        const healed = await this._tryEmergencyHeal(bot);
        if (healed) { this._schedule(); return; }
      }

      // 2. EAT — умная логика по HP
      const eatMode = this._shouldEat(bot);
      if (eatMode && this._forceAttackTicks === 0) {
        await this._doEatSmart(bot, eatMode);
        this._schedule();
        return;
      }

      // 3. ATTACK / CHASE — основная логика
      if (this._forceAttackTicks > 0) this._forceAttackTicks--;

      await this._doMoveAndAttack(bot, dist);

      // 4. Редко: буф-зелье (раз в ~45 сек)
      if (this._tickCount % 75 === 0) await this._tryBuffPotion(bot);

      // 5. Хил-зелье при HP < 12
      if (hp < 12 && this._tickCount % 5 === 0) await this._tryHealPotion(bot);

      // Обучение мозга (обратная связь через 1 сек)
      const hpBefore = hp;
      setTimeout(() => {
        if (this._running && bot?.entity) {
          const good = bot.health >= hpBefore - 1.5;
          // brain.recordExperience(…) можно добавить позже
        }
      }, 1000);

    } catch (err) {
      log.debug("[PvpController] tick error:", err.message);
    }

    this._schedule();
  }

  // ── ЛОГИКА КОГДА ЕСТЬ ────────────────────────────────────────────────
  // Возвращает: null | "regular" | "gapple" | "regular_then_gapple"
  _shouldEat(bot) {
    const hp   = bot.health ?? 20;
    const food = bot.food   ?? 20;

    // HP критическое (≤ 8, 4 сердца)
    if (hp <= 8) {
      if (food >= 18) return "gapple";          // еда почти полная — сразу гэпл
      return "regular_then_gapple";             // сначала мясо, потом гэпл
    }

    // HP умеренное (8-14), голод
    if (hp <= 14 && food < 16) return "regular";

    // Обычный голод при нормальном HP
    if (food < 14) return "regular";

    return null;
  }

  // ── УМНАЯ ЕДА ──────────────────────────────────────────────────────
  async _doEatSmart(bot, mode) {
    this._isDoingAction = true;
    try {
      // Стоп движения перед едой
      try { bot.pathfinder?.stop(); } catch {}
      try { bot.setControlState('forward', false); } catch {}
      try { bot.setControlState('jump', false); } catch {}
      await sleep(120 + rand(0, 80));

      if (mode === "gapple") {
        await this._eatBestGapple(bot);
      } else if (mode === "regular_then_gapple") {
        // Сначала обычная еда
        const food = this._selectRegularFood(bot);
        if (food) await this._eatItem(bot, food);
        // Потом гэпл если кулдаун готов
        await sleep(200);
        await this._eatBestGapple(bot);
      } else {
        // regular
        const food = this._selectRegularFood(bot);
        if (food) await this._eatItem(bot, food);
      }
    } finally {
      this._isDoingAction = false;
      this._forceAttackTicks = 6; // После еды — принудительно атакуем 6 тиков
    }
  }

  // Выбираем лучший доступный гэпл (enchanted если кд готов, иначе обычный)
  async _eatBestGapple(bot) {
    const now = Date.now();
    // Сначала пробуем зачарованный
    if (now >= this._enchantedGappleCooldownEnd) {
      const eg = bot.inventory.items().find(i => i.name === "enchanted_golden_apple");
      if (eg) {
        await this._eatItem(bot, eg);
        this._enchantedGappleCooldownEnd = now + this._enchantedGappleCooldown;
        this._addChat("✨ Enchanted Gapple! КД " + (this._enchantedGappleCooldown/1000) + "с", "system");
        return true;
      }
    }
    // Обычный гэпл
    if (now >= this._gappleCooldownEnd) {
      const g = bot.inventory.items().find(i => i.name === "golden_apple");
      if (g && this._gappleCooldown >= 0) {
        await this._eatItem(bot, g);
        if (this._gappleCooldown > 0) this._gappleCooldownEnd = now + this._gappleCooldown;
        this._addChat("🍏 Golden Apple! КД " + (this._gappleCooldown/1000) + "с", "system");
        return true;
      } else if (g && this._gappleCooldown === 0) {
        await this._eatItem(bot, g);
        this._addChat("🍏 Golden Apple (нет КД)", "system");
        return true;
      }
    }
    return false;
  }

  // Обычная еда (без гэплов)
  _selectRegularFood(bot) {
    const items = bot.inventory.items();
    for (const name of FOOD_PRIORITY) {
      const item = items.find(i => i.name === name);
      if (item) return item;
    }
    return items.find(i => i.foodPoints > 0 && i.name !== "golden_apple" && i.name !== "enchanted_golden_apple") || null;
  }

  // Съесть предмет
  async _eatItem(bot, item) {
    try {
      await bot.equip(item, "hand");
      await sleep(60 + rand(0, 40));
      await bot.consume();
      this._addChat("🍖 Съел: " + item.name, "system");
    } catch (err) {
      log.debug("[PvpController] eatItem error:", err.message);
    }
  }

  // ── ДВИЖЕНИЕ + АТАКА + КРИТ ─────────────────────────────────────────
  async _doMoveAndAttack(bot, dist) {
    const target = this._target;
    if (!target || !bot.entity) return;

    // Стоп pathfinder — используем только setControlState
    try { bot.pathfinder?.stop(); } catch {}

    const pos  = bot.entity.position;
    const tpos = target.position;
    const dx   = tpos.x - pos.x;
    const dz   = tpos.z - pos.z;
    const dist2d = Math.max(Math.sqrt(dx*dx + dz*dz), 0.01);
    const yaw    = Math.atan2(-dx, -dz);
    const headY  = tpos.y + (target.height ?? 1.8) * 0.85;
    const pitch  = -Math.atan2(headY - (pos.y + 1.6), dist2d);

    // 1. Смотрим на цель
    try { await bot.look(yaw, pitch, true); } catch {}

    if (dist > 3.5) {
      // Слишком далеко — только движение вперёд (W)
      try { bot.setControlState('forward', true); } catch {}
      try { bot.setControlState('jump', false); } catch {}
      return;
    }

    // В радиусе атаки — стоп движения
    try { bot.setControlState('forward', false); } catch {}

    // 2. Экипируем меч если не в руке
    const weapon = bot.inventory.items().find(i =>
      SWORD_NAMES.some(n => i.name.includes(n)) || AXE_NAMES.some(n => i.name.includes(n))
    );
    if (weapon && bot.heldItem?.name !== weapon.name) {
      try { await bot.equip(weapon, "hand"); await sleep(50); } catch {}
    }

    // 3. КРИТИЧЕСКИЙ УДАР: прыжок каждые 2 атаки
    const shouldCrit = (this._hitCount % 2 === 0) && bot.entity.onGround;
    if (shouldCrit) {
      try { bot.setControlState('jump', true); } catch {}
      await sleep(100); // взлетаем
      try { bot.setControlState('jump', false); } catch {}
      await sleep(150); // ждём падения — в этот момент атака будет критической
    }

    // 4. Проверяем reach перед атакой
    const distNow = bot.entity.position.distanceTo(target.position);
    if (distNow > 4.2) {
      try { bot.setControlState('forward', true); } catch {}
      return;
    }

    // 5. АТАКА
    try {
      bot.attack(target);
      bot._lastAttackTime = Date.now();
      this._attackCount++;
      this._hitCount++;
      if (shouldCrit) this._addChat("💥 КРИТ!", "system");
    } catch (err) {
      log.debug("[PvpController] attack error:", err.message);
    }
  }

  // ── ЭКСТРЕННОЕ ЛЕЧЕНИЕ ───────────────────────────────────────────────
  async _tryEmergencyHeal(bot) {
    // Сначала гэпл
    const gotGapple = await this._eatBestGapple(bot);
    if (gotGapple) { this._forceAttackTicks = 4; return true; }

    // Затем хилка
    return await this._tryHealPotion(bot);
  }

  // ── ХИЛ-ЗЕЛЬЕ ───────────────────────────────────────────────────────
  async _tryHealPotion(bot) {
    const p = bot.inventory.items().find(i => HEAL_POTION.some(k => i.name.toLowerCase().includes(k)));
    if (!p) return false;
    await this._doSplashPotion(bot, "heal", p);
    return true;
  }

  // ── БАФ-ЗЕЛЬЕ ───────────────────────────────────────────────────────
  async _tryBuffPotion(bot) {
    const p = bot.inventory.items().find(i => BUFF_POTION.some(k => i.name.toLowerCase().includes(k)));
    if (!p) return;
    await this._doSplashPotion(bot, "buff", p);
  }

  // ── ВЗРЫВНОЕ/СПЛЭШ ЗЕЛЬЕ ────────────────────────────────────────────
  async _doSplashPotion(bot, type, potion) {
    if (this._isDoingAction) return;
    this._isDoingAction = true;
    try {
      try { bot.setControlState('forward', false); } catch {}
      try { bot.setControlState('jump', false); } catch {}
      await sleep(100 + rand(0, 60));

      await bot.equip(potion, "hand");
      await sleep(70 + rand(0, 40));

      if (type === "heal" || type === "buff") {
        // Смотрим вверх — падает на себя
        try { await bot.look(bot.entity.yaw, -Math.PI / 4, false); } catch {}
      } else if (this._target?.position) {
        // Целимся во врага
        const dx = this._target.position.x - bot.entity.position.x;
        const dz = this._target.position.z - bot.entity.position.z;
        const yaw = Math.atan2(-dx, -dz);
        try { await bot.look(yaw, -Math.PI / 8, false); } catch {}
      }
      await sleep(50 + rand(0, 30));
      bot.activateItem();

      const label = type === "heal" ? "💊" : type === "buff" ? "✨" : "💥";
      this._addChat(`${label} ${potion.name}`, "system");
      this._forceAttackTicks = 3;
    } catch (err) {
      log.debug("[PvpController] potion error:", err.message);
    } finally {
      this._isDoingAction = false;
    }
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
      if (entity.isValid === false) continue;
      const d = bot.entity.position.distanceTo(entity.position);
      if (d < minDist) { minDist = d; closest = entity; }
    }
    this._target = closest;
  }

  _addChat(msg, type = "system") {
    this.emit("bot:chat", { botId: this.instance.id, username: "pvp-ai", message: msg, type });
  }

  isRunning()      { return this._running; }
  getTarget()      { return this._target?.username || this._target?.name || null; }
  getAttackCount() { return this._attackCount; }
}

module.exports = { PvpController };
