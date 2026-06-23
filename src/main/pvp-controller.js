/**
 * PvpController v5
 * - Спринт при преследовании (Ctrl + W)
 * - Крит: атака в начале падения (~360мс от прыжка), не после посадки
 * - Прицел на грудь (y+0.9), не на голову — фикс промахов
 * - Онлайн-обучение нейросети после каждого тика
 * - 40-блоков обнаружение + поле зрения (не автоатака)
 * - Тимейты: безопасная проверка entity.username
 * - Зелья сил/скорости/огнестойкости на себя (взрыв вверх)
 * - Преследование убегающих игроков (спринт + pathfinder-fallback)
 * - Правильный HP-conflict fix: _isDoingAction сбрасывается если бот получил урон
 */

const log = require("electron-log");
const { PvpBrain }   = require("./pvp-brain");
const { AntiDetect } = require("./anti-detect");

const SWORD_NAMES   = ["wooden_sword","stone_sword","iron_sword","golden_sword","diamond_sword","netherite_sword","mace"];
const AXE_NAMES     = ["wooden_axe","stone_axe","iron_axe","golden_axe","diamond_axe","netherite_axe"];
const HEAL_POTION   = ["healing","instant_health","regeneration"];
const BUFF_POTION   = ["strength","speed","fire_resistance","resistance","absorption"];
const DEBUFF_POTION = ["poison","weakness","slowness","blindness","instant_damage","harming"];

const FOOD_PRIORITY = [
  "golden_carrot","cooked_beef","cooked_porkchop","cooked_mutton","cooked_chicken",
  "cooked_salmon","cooked_cod","bread","baked_potato","apple","carrot",
  "mushroom_stew","rabbit_stew","pumpkin_pie","melon_slice","cookie","dried_kelp",
];

// Время крит-цикла (мс)
const CRIT_JUMP_PRESS    = 90;  // держать прыжок
const CRIT_WAIT_PEAK     = 260; // ждать пика → начало падения
const CRIT_ATTACK_WINDOW = 10;  // небольшой буфер

function rand(lo, hi) { return lo + Math.random() * (hi - lo); }
function sleep(ms)    { return new Promise(r => setTimeout(r, ms)); }
function clamp(v,lo,hi){ return Math.max(lo, Math.min(hi, v)); }

class PvpController {
  constructor(instance, emit) {
    this.instance   = instance;
    this.emit       = emit;
    this.brain      = new PvpBrain();
    this._running   = false;
    this._loopTimer = null;
    this._target    = null;
    this._teammates = new Set();
    this._attackCount   = 0;
    this._tickCount     = 0;
    this._hitCount      = 0;
    this._critCount     = 0;
    this._lastAttackMs  = 0;   // трекер CD атаки
    this._forceAttack   = 0;     // тиков принудительной атаки
    this._isDoingAction = false;
    this._lastHealthCheck = 0;
    this._lastHP         = 20;
    this._spawnTime      = Date.now();
    this._detectedPlayers = [];  // обнаруженные в 40 блоках (не цели)

    this._gappleCooldown          = 0;
    this._enchantedGappleCooldown = 120000;
    this._gappleCooldownEnd          = 0;
    this._enchantedGappleCooldownEnd = 0;

    // Длительность крит-цикла (мс) — тик запускается через это время
    this._critCycleMs = CRIT_JUMP_PRESS + CRIT_WAIT_PEAK + CRIT_ATTACK_WINDOW + 200;
  }

  start(opts = {}) {
    if (this._running) return;
    const { bot } = this.instance;
    if (!bot?.entity) { log.warn("[PvpController] no bot entity"); return; }

    // Тимейты: нормализуем в Set
    const rawTeam = opts.teammates || this.instance.config?.teammates || [];
    this._teammates = new Set(Array.isArray(rawTeam) ? rawTeam.map(s => String(s).toLowerCase()) : []);

    const gSec  = opts.gappleCooldown          ?? this.instance.config?.pvpGappleCooldown          ?? 0;
    const egSec = opts.enchantedGappleCooldown ?? this.instance.config?.pvpEnchantedGappleCooldown ?? 120;
    this._gappleCooldown          = gSec  * 1000;
    this._enchantedGappleCooldown = egSec * 1000;

    this._running  = true;
    this._spawnTime = Date.now();
    this._tickCount = 0;
    this._hitCount  = 0;
    this._critCount = 0;
    this._forceAttack   = 0;
    this._isDoingAction = false;
    this._lastHP = bot.health ?? 20;
    this._gappleCooldownEnd          = 0;
    this._enchantedGappleCooldownEnd = 0;

    // Anti-detect
    try {
      const { Movements } = require("mineflayer-pathfinder");
      const m = new Movements(bot);
      m.allowSprinting  = true;  // спринт разрешён
      m.allow1by1towers = false;
      m.canDig          = false;
      bot.pathfinder.setMovements(m);
    } catch {}

    // Слушаем урон — сбрасываем _isDoingAction если нас ударили в процессе еды
    this._onHurt = () => {
      const currentHP = bot.health ?? 20;
      if (currentHP < this._lastHP - 0.5 && this._isDoingAction) {
        log.debug("[PvpController] урон получен во время действия — прерываем");
        this._isDoingAction = false;
        this._forceAttack = 3;
      }
      this._lastHP = currentHP;
    };
    try { bot.on("entityHurt", this._onHurt); } catch {}

    this.emit("bot:pvpStarted", { botId: this.instance.id });
    this._addChat("⚔️ PVP v5 [крит+спринт]");
    this._scheduleTick(200);
    log.info(`[PvpController] v5 started gappleCD=${gSec}s enchCD=${egSec}s team=[${[...this._teammates].join(",")}]`);
  }

  stop() {
    this._running = false;
    if (this._loopTimer) { clearTimeout(this._loopTimer); this._loopTimer = null; }
    const { bot } = this.instance;
    if (bot) {
      try { bot.off("entityHurt", this._onHurt); } catch {}
      try { bot.pathfinder?.stop(); } catch {}
      try { bot.setControlState?.("forward", false); } catch {}
      try { bot.setControlState?.("sprint",  false); } catch {}
      try { bot.setControlState?.("jump",    false); } catch {}
    }
    this._isDoingAction = false;
    this._target = null;
    this.emit("bot:pvpStopped", { botId: this.instance.id });
    this._addChat("🛑 PVP остановлен");
  }

  // ── Тик с адаптивным интервалом ─────────────────────────────────────
  _scheduleTick(ms) {
    if (!this._running) return;
    if (this._loopTimer) clearTimeout(this._loopTimer);
    this._loopTimer = setTimeout(() => this._tick(), ms);
  }

  async _tick() {
    if (!this._running) return;
    const { bot } = this.instance;
    if (!bot?.entity) { this._scheduleTick(300); return; }
    if (Date.now() - this._spawnTime < 2000) { this._scheduleTick(500); return; }

    this._tickCount++;

    try {
      this._findTarget();
      this._scanNearby40();  // 40-блоков пассивное обнаружение

      if (!this._target) {
        try { bot.setControlState("forward", false); bot.setControlState("sprint", false); } catch {}
        this._scheduleTick(400);
        return;
      }

      const hp   = bot.health ?? 20;
      const food = bot.food   ?? 20;
      const dist = bot.entity.position.distanceTo(this._target.position);

      // Если _isDoingAction > 2 секунд — что-то зависло, сбрасываем
      if (this._isDoingAction && Date.now() - (this._actionStartedAt || 0) > 3000) {
        this._isDoingAction = false;
        this._forceAttack = 2;
      }

      if (this._isDoingAction) { this._scheduleTick(150); return; }

      // ── Приоритет действий ───────────────────────────────────────────
      // 1. ЭКСТРЕННОЕ ЛЕЧЕНИЕ (HP ≤ 4)
      if (hp <= 4) {
        const healed = await this._emergency(bot);
        if (healed) { this._scheduleTick(300); return; }
      }

      // 2. ЕДА по HP-логике
      const eatMode = this._shouldEat(hp, food);
      if (eatMode && this._forceAttack === 0) {
        await this._doEatSmart(bot, eatMode);
        this._scheduleTick(350);
        return;
      }

      // 3. Принудительная атака после еды/зелья
      if (this._forceAttack > 0) this._forceAttack--;

      // 4. ДВИЖЕНИЕ + АТАКА (основное)
      await this._doMoveAndAttack(bot, dist);

      // 5. БАФ-ЗЕЛЬЕ раз в 30 сек
      if (this._tickCount % 50 === 0) await this._tryBuffPotion(bot);

      // 6. ХИЛ-ЗЕЛЬЕ при HP < 10
      if (hp < 10 && this._tickCount % 8 === 0) await this._tryHealPotion(bot);

      // 7. Онлайн-обучение нейросети
      this._trainBrain(bot, hp);

    } catch (err) {
      log.debug("[PvpController] tick error:", err.message);
    }

    // Крит-цикл включает свои ожидания — после атаки тик быстрее
    const nextDelay = this._target ? 80 : 400; // 80ms base — крит-цикл управляет реальным ритмом
    this._scheduleTick(nextDelay);
  }

  // ── ДВИЖЕНИЕ + АТАКА (CD-aware, W-tap, щит+топор) ──────────────────
  async _doMoveAndAttack(bot, dist) {
    const target = this._target;
    if (!target?.position || !bot.entity) return;

    const pos  = bot.entity.position;
    const tpos = target.position;

    // ── Щит в руке врага → топор ─────────────────────────────────────
    const eq = target.equipment || [];
    const enemyHasShield = [eq[0], eq[1]].some(i => i?.name?.includes('shield'));

    const items  = bot.inventory.items();
    const sword  = items.find(i => SWORD_NAMES.some(n => i.name.includes(n)));
    const axe    = items.find(i => AXE_NAMES.some(n  => i.name.includes(n)));
    const totem  = items.find(i => i.name === 'totem_of_undying');
    const weapon = (enemyHasShield && axe) ? axe : (sword || axe);
    // CD: меч 625мс (1.6/s), топор 1000мс (1.0/s)
    const weaponCD = (weapon && AXE_NAMES.some(n => weapon.name.includes(n))) ? 975 : 600;

    // Тотем в оффхэнд при низком HP
    const myHp = bot.health ?? 20;
    if (myHp <= 5 && totem) {
      const offhand = bot.inventory.items().find(i => i.name === 'totem_of_undying');
      if (offhand) { try { await bot.equip(offhand, 'off-hand'); } catch {} }
    }

    if (weapon && bot.heldItem?.name !== weapon.name) {
      try { await bot.equip(weapon, 'hand'); await sleep(45 + rand(0,20)); } catch {}
    }

    // ── ДВИЖЕНИЕ ─────────────────────────────────────────────────────
    if (dist > 4.5) {
      try { bot.setControlState('forward', true);  } catch {}
      try { bot.setControlState('sprint',  true);  } catch {}
      if (dist > 8) {
        try {
          const { goals } = require('mineflayer-pathfinder');
          bot.pathfinder.setGoal(new goals.GoalNear(tpos.x, tpos.y, tpos.z, 2), false);
        } catch {}
      }
      return;
    }

    try { bot.pathfinder?.stop(); } catch {}

    if (dist > 2.5) {
      try { bot.setControlState('forward', true);  } catch {}
      try { bot.setControlState('sprint',  false); } catch {}
    } else {
      try { bot.setControlState('forward', false); } catch {}
      try { bot.setControlState('sprint',  false); } catch {}
    }

    // ── ПРОВЕРЯЕМ КД АТАКИ (главный фикс от автоклик-бана) ───────────
    const now = Date.now();
    if (now - this._lastAttackMs < weaponCD) return; // CD не готов — тихо пропускаем

    // ── ПРИЦЕЛ НА ЦЕНТР ХИТБОКСА (не выше головы) ───────────────────
    const dx     = tpos.x - pos.x;
    const dz     = tpos.z - pos.z;
    const dist2d = Math.max(Math.sqrt(dx*dx + dz*dz), 0.01);
    const yaw    = Math.atan2(-dx, -dz);
    // 0.5 * height = центр тела, более легитно чем 0.85 (голова)
    const aimY   = tpos.y + (target.height || 1.8) * 0.5;
    const pitch  = -Math.atan2(aimY - (pos.y + 1.62), dist2d);

    // bot.look с force=true — мгновенный поворот, сервер получает корректный look ПЕРЕД attack
    try { await bot.look(yaw, pitch, true); } catch {}
    // Человеческая реакция между прицелом и ударом (40-80ms)
    await sleep(40 + rand(0, 40));

    // ── ФИНАЛЬНАЯ ПРОВЕРКА ДИСТАНЦИИ ─────────────────────────────────
    const finalDist = bot.entity.position.distanceTo(tpos);
    if (finalDist > 4.8) {
      try { bot.setControlState('forward', true); } catch {}
      return;
    }

    // ── КРИТ: каждый 3-й удар, только если на земле и близко ─────────
    const doCrit = bot.entity.onGround && (this._hitCount % 3 === 0) && finalDist < 3.2;
    if (doCrit) {
      try { bot.setControlState('jump', true);  } catch {}
      await sleep(85 + rand(0,15));
      try { bot.setControlState('jump', false); } catch {}
      await sleep(230 + rand(0,40)); // ждём пика → начало падения

      const afterDist = bot.entity.position.distanceTo(tpos);
      if (afterDist > 4.8) return;
    }

    // ── АТАКА ────────────────────────────────────────────────────────
    try {
      bot.attack(target);
      this._lastAttackMs = Date.now();
      this._attackCount++;
      this._hitCount++;
      if (doCrit) { this._critCount++; log.debug('[PvpController] 💥 КРИТ #' + this._critCount); }

      // ── W-TAP: release W 50-80мс (KB separation, легитно) ─────────
      try { bot.setControlState('forward', false); } catch {}
      await sleep(50 + rand(0, 30));
      if (this._running && this._target) {
        const aftD = bot.entity?.position?.distanceTo(tpos) ?? 0;
        if (aftD > 1.5) { try { bot.setControlState('forward', true); } catch {} }
      }
    } catch (err) {
      log.debug('[PvpController] attack:', err.message);
    }

    if (doCrit) { await sleep(180 + rand(0,40)); } // ждём приземления
  }

  // ── HP-ЛОГИКА ЕДЫ ───────────────────────────────────────────────────
  _shouldEat(hp, food) {
    if (hp <= 8) {
      if (food >= 18) return "gapple";
      return "regular_then_gapple";
    }
    if (hp <= 14 && food < 16) return "regular";
    if (food < 14) return "regular";
    return null;
  }

  async _doEatSmart(bot, mode) {
    this._isDoingAction = true;
    this._actionStartedAt = Date.now();
    try {
      try { bot.setControlState("forward", false); bot.setControlState("sprint", false); } catch {}
      await sleep(80 + rand(0, 60));

      if (mode === "gapple") {
        await this._eatBestGapple(bot);
      } else if (mode === "regular_then_gapple") {
        const food = this._selectRegularFood(bot);
        if (food) await this._eatItem(bot, food);
        await sleep(120);
        await this._eatBestGapple(bot);
      } else {
        const food = this._selectRegularFood(bot);
        if (food) await this._eatItem(bot, food);
      }
    } finally {
      this._isDoingAction = false;
      this._forceAttack = 5;
    }
  }

  async _eatBestGapple(bot) {
    const now = Date.now();
    if (now >= this._enchantedGappleCooldownEnd) {
      const eg = bot.inventory.items().find(i => i.name === "enchanted_golden_apple");
      if (eg) {
        await this._eatItem(bot, eg);
        this._enchantedGappleCooldownEnd = now + this._enchantedGappleCooldown;
        return true;
      }
    }
    if (now >= this._gappleCooldownEnd) {
      const g = bot.inventory.items().find(i => i.name === "golden_apple");
      if (g) {
        await this._eatItem(bot, g);
        if (this._gappleCooldown > 0) this._gappleCooldownEnd = now + this._gappleCooldown;
        return true;
      }
    }
    return false;
  }

  _selectRegularFood(bot) {
    const items = bot.inventory.items();
    for (const name of FOOD_PRIORITY) {
      const item = items.find(i => i.name === name);
      if (item) return item;
    }
    return items.find(i => (i.foodPoints || 0) > 0 && !["golden_apple","enchanted_golden_apple"].includes(i.name)) || null;
  }

  async _eatItem(bot, item) {
    try {
      await bot.equip(item, "hand");
      await sleep(50 + rand(0, 30));
      await bot.consume();
      this._addChat("🍖 " + item.name);
    } catch (err) {
      log.debug("[PvpController] eatItem:", err.message);
    }
  }

  // ── ЭКСТРЕННОЕ ЛЕЧЕНИЕ ──────────────────────────────────────────────
  async _emergency(bot) {
    // Сначала хилка
    const healed = await this._tryHealPotion(bot);
    if (healed) return true;
    return await this._eatBestGapple(bot);
  }

  async _tryHealPotion(bot) {
    const p = bot.inventory.items().find(i => HEAL_POTION.some(k => i.name.toLowerCase().includes(k)));
    if (!p) return false;
    await this._doSplashPotion(bot, "heal", p);
    return true;
  }

  async _tryBuffPotion(bot) {
    const p = bot.inventory.items().find(i => BUFF_POTION.some(k => i.name.toLowerCase().includes(k)));
    if (!p) return;
    await this._doSplashPotion(bot, "buff", p);
  }

  // ── СПЛЭШ ЗЕЛЬЕ ─────────────────────────────────────────────────────
  // buff/heal = на себя (вверх), debuff = на врага (вперёд-вниз)
  async _doSplashPotion(bot, type, potion) {
    if (this._isDoingAction) return;
    this._isDoingAction = true;
    this._actionStartedAt = Date.now();
    try {
      try { bot.setControlState("forward", false); bot.setControlState("sprint", false); } catch {}
      await sleep(80 + rand(0, 50));

      await bot.equip(potion, "hand");
      await sleep(60 + rand(0, 40));

      if (type === "heal" || type === "buff") {
        // На себя: смотрим прямо вверх (почти 90°), кидаем — падает на нас
        const curYaw = bot.entity?.yaw ?? 0;
        try { await bot.look(curYaw, -Math.PI * 0.45, false); } catch {}
        await sleep(50);
        bot.activateItem();
        this._addChat(type === "buff" ? "✨ БУФФ!" : "💊 Хилка!", "system");
      } else {
        // На врага: целимся прямо в него, немного выше
        if (this._target?.position && bot.entity) {
          const dx  = this._target.position.x - bot.entity.position.x;
          const dz  = this._target.position.z - bot.entity.position.z;
          const yaw = Math.atan2(-dx, -dz);
          try { await bot.look(yaw, -0.4, false); } catch {}
          await sleep(50);
          bot.activateItem();
          this._addChat("☠️ Дебаф!", "system");
        }
      }
      this._forceAttack = 3;
    } catch (err) {
      log.debug("[PvpController] potion:", err.message);
    } finally {
      this._isDoingAction = false;
    }
  }

  // ── ПОИСК БЛИЖАЙШЕЙ ЦЕЛИ (16 блоков) ──────────────────────────────
  _findTarget() {
    const { bot } = this.instance;
    if (!bot?.entity) { this._target = null; return; }

    let closest = null, minDist = 16;
    for (const e of Object.values(bot.entities || {})) {
      if (!e?.position || e === bot.entity) continue;
      if (e.type !== "player" && e.type !== "mob") continue;
      // Безопасная проверка тимейтов
      const uname = typeof e.username === "string" ? e.username.toLowerCase() : null;
      if (uname && this._teammates.has(uname)) continue;
      if (uname && uname === (bot.username || "").toLowerCase()) continue;
      if (e.isValid === false) continue;

      const d = bot.entity.position.distanceTo(e.position);
      if (d < minDist) { minDist = d; closest = e; }
    }
    this._target = closest;
  }

  // ── ПАССИВНОЕ ОБНАРУЖЕНИЕ 40 БЛОКОВ + ПОЛЕ ЗРЕНИЯ ────────────────
  _scanNearby40() {
    const { bot } = this.instance;
    if (!bot?.entity || this._tickCount % 5 !== 0) return; // каждые 5 тиков

    const detected = [];
    const botPos = bot.entity.position;
    const botYaw = bot.entity.yaw;

    for (const e of Object.values(bot.entities || {})) {
      if (!e?.position || e === bot.entity || e.type !== "player") continue;
      const uname = typeof e.username === "string" ? e.username.toLowerCase() : null;
      if (uname && this._teammates.has(uname)) continue;
      if (uname && uname === (bot.username || "").toLowerCase()) continue;

      const d = botPos.distanceTo(e.position);
      if (d > 40) continue;

      // Проверяем поле зрения (90° от направления взгляда)
      const dx = e.position.x - botPos.x;
      const dz = e.position.z - botPos.z;
      const angleToTarget = Math.atan2(-dx, -dz);
      let angleDiff = Math.abs(angleToTarget - botYaw) % (2 * Math.PI);
      if (angleDiff > Math.PI) angleDiff = 2 * Math.PI - angleDiff;
      const inFOV = angleDiff < Math.PI * 0.5; // 90° поле зрения

      if (inFOV || d < 16) { // в 16 блоках — всегда видим
        detected.push({ username: e.username, distance: Math.round(d), inFOV });
      }
    }

    if (detected.length > 0) {
      this._detectedPlayers = detected;
      this.emit("bot:pvpDetected", { botId: this.instance.id, players: detected });
    }
  }

  // ── ОНЛАЙН-ОБУЧЕНИЕ ─────────────────────────────────────────────────
  _trainBrain(bot, hp) {
    if (!this._target || this._tickCount % 10 !== 0) return;
    try {
      const features = this.brain._getFeatures?.(bot, this._target, [...this._teammates]);
      if (!features) return;
      const wasGood = (bot.health ?? 20) >= this._lastHP - 0.5;
      const actionMap = this._hitCount > 0 ? { attack: true } : { retreat: true };
      this.brain.recordExperience(features, actionMap, wasGood);
    } catch {}
    this._lastHP = hp;
  }

  _addChat(msg, type = "system") {
    this.emit("bot:chat", { botId: this.instance.id, username: "pvp-ai", message: msg, type });
  }

  isRunning()   { return this._running; }
  getTarget()   { return this._target?.username || null; }
  getStats()    { return { attacks: this._attackCount, crits: this._critCount, hits: this._hitCount }; }
}

module.exports = { PvpController };
