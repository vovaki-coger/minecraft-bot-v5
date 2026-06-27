/**
 * AgentLoop v3.2 — v5 оригинал + AntiDetect: плавный поворот, FOV-чек, рандом атаки.
 *
 * Базируется на v5 (авто-бой, самозащита, ответные удары).
 * AntiDetect добавляет:
 *  - плавный поворот головы вместо мгновенного снапа
 *  - FOV-проверку перед ударом (защита от KillAura флага)
 *  - рандомный кулдаун атаки 580-730мс
 *  - нокбек-паузу (pathfinder стоит 480мс пока сервер применяет откат)
 *  - GoalFollow вместо GoalNear — бот не перезапускает pathfinder каждые 200мс
 */
const { goals } = require("mineflayer-pathfinder");
const log = require("electron-log");
const { AntiDetect } = require("./anti-detect");

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

const HOSTILE_MOBS = new Set([
  "zombie","skeleton","creeper","spider","enderman","witch",
  "pillager","phantom","drowned","husk","stray","slime",
  "magma_cube","blaze","wither_skeleton","vindicator","ravager",
  "cave_spider","silverfish","guardian","elder_guardian","warden",
  "bogged","breeze","piglin_brute","zombified_piglin","hoglin","zoglin",
  "vex","evoker","shulker","chicken_jockey","spider_jockey",
]);

class AgentLoop {
  constructor(instance, emit) {
    this.instance = instance;
    this.emit = emit;
    this._active = true;
    this._deathPos = null;
    this._lastEat = 0;
    this._lastDefend = 0;
    this._mainLoop = null;
    this._combatLoop = null;

    // Цель для боя (моб или игрок)
    this._combatTarget = null;
    this._combatTargetName = null;
    this._combatStartedAt = 0;

    // Кто бил бота: Map<entityId, {entity, lastHitTime, isPlayer, name}>
    this._attackers = new Map();

    this._posHistory = [];
    this._lastPosRecord = 0;
    this._stuckAttempts = 0;

    // AntiDetect: нокбек пауза
    this._knockbackPauseUntil = 0;

    // AntiDetect: не перезапускаем pathfinder каждые 260мс
    this._movingToTarget = false;
    this._moveTargetPos = null;

    // AntiDetect: рандомный кулдаун атаки 1.9 pvp
    this._lastAttackTime = 0;
    this._nextAttackDelay = AntiDetect.attackDelay();

    // AntiDetect модуль
    this._antiDetect = new AntiDetect(this.bot);
    this._antiDetect.start();

    this._attachBotEvents();
    this._startLoop();
    this._startCombatLoop();
  }

  get bot() { return this.instance.bot; }

  // ── Привязка к событиям ──────────────────────────────────────────────

  _attachBotEvents() {
    const bot = this.bot;

    bot.on("death", () => this._onDeath());
    bot.on("health", () => this._onHealthTick());

    // Кто ударил бота
    bot.on("entityHurt", (entity) => {
      // FIX: пропускаем если PvP-контроллер активен — он управляет сам
      if (entity === bot.entity && !this.instance._pvpController?.isRunning()) {
        this._onBotHurt();
      }
    });

    // Кто ударил бота напрямую (attacker)
    bot.on("entityDamaged", (entity, attacker) => {
      if (entity !== bot.entity || !attacker) return;
      // FIX: не перехватываем цель если PvP-контроллер уже управляет боем
      if (!this.instance._pvpController?.isRunning()) {
        this._registerAttacker(attacker);
      }
    });

    // Обнаруживаем попадания через снижение HP
    bot._client?.on("entity_status", (data) => {
      // FIX: только если PvP НЕ активен — иначе конфликт с pvp-controller
      if (data.entityId === bot.entity?.id && data.entityStatus === 2 &&
          !this.instance._pvpController?.isRunning()) {
        // Status 2 = hurt animation
        this._onBotHurt();
      }
    });

    // Смерть цели — сбрасываем цель
    bot.on("entityDead", (entity) => {
      if (this._combatTarget && entity === this._combatTarget) {
        log.info("[AgentLoop] Combat target died:", this._combatTargetName);
        this._clearCombatTarget();
      }
      this._attackers.delete(entity.id);
    });

    bot.once("spawn", () => {
      setTimeout(() => this._autoEquipArmor(), 2000);
    });
  }

  _registerAttacker(attacker) {
    if (!attacker?.position) return;
    const name = attacker.username || attacker.mobType || attacker.name || "unknown";
    const isPlayer = attacker.type === "player" && attacker.username !== this.bot.username;
    // Не атакуем игроков если PVP выключен в настройках бота
    if (isPlayer && !this.instance.config?.pvpEnabled) {
      log.debug("[AgentLoop] PVP off — ignoring player attacker:", name);
      return;
    }

    log.info(`[AgentLoop] Hit by: ${name} (${isPlayer ? "player" : "mob"})`);

    this._attackers.set(attacker.id, {
      entity: attacker,
      lastHitTime: Date.now(),
      isPlayer,
      name,
    });

    // Немедленно переключаемся на атакующего
    this._setCombatTarget(attacker, name);
  }

  _onBotHurt() {
    // FIX: если PvP-контроллер активен — он сам обрабатывает knockback,
    // не останавливаем его pathfinder и не ставим паузу
    if (this.instance._pvpController?.isRunning()) return;

    // AntiDetect: нокбек-пауза — даём серверу применить откат
    this._knockbackPauseUntil = Date.now() + 480;
    this._movingToTarget = false;
    // FIX v5.36.2: не стопаем pathfinder если TaskManager выполняет задачу.
    // Раньше: каждый удар моба → pathfinder.stop() → задача не могла идти.
    if (!this.instance.taskManager?._running) {
      try { this.bot.pathfinder.stop(); } catch {}
    }

    // Fallback: если нет информации об атакующем — ищем ближайшего врага
    if (!this._combatTarget) {
      const nearest = this._findNearestThreat(20);
      if (nearest) this._setCombatTarget(nearest.entity, nearest.name);
    }
  }

  _setCombatTarget(entity, name) {
    if (!entity?.position) return;
    if (this._combatTarget !== entity) {
      this._movingToTarget = false;
      this._moveTargetPos = null;
    }
    this._combatTarget = entity;
    this._combatTargetName = name;
    this._combatStartedAt = Date.now();
    this._antiDetect.setInCombat(true);
    log.info(`[AgentLoop] Combat target set: ${name}`);
  }

  _clearCombatTarget() {
    this._combatTarget = null;
    this._combatTargetName = null;
    this._combatStartedAt = 0;
    this._movingToTarget = false;
    this._moveTargetPos = null;
    this._antiDetect.setInCombat(false);
    // Стопаем pathfinder и сбрасываем управление чтобы не было idle-ходьбы
    try { this.bot.pathfinder.stop(); } catch {}
    try { this.bot.setControlState('forward', false); } catch {}
    try { this.bot.setControlState('sprint',  false); } catch {}
  }

  // ── Боевой цикл (260мс) ─────────────────────────────────────────────

  _startCombatLoop() {
this._combatLoop = setInterval(() => {
      this._combatTick().catch(() => {});
    }, 260);
  }

  async _combatTick() {
    const bot = this.bot;
    if (!bot?.entity || !this._active) return;
    // Не конфликтуем с PVP-контроллером
    if (this.instance._pvpController?.isRunning?.()) return;

    // AntiDetect: нокбек-пауза
    if (Date.now() < this._knockbackPauseUntil) return;

    // FIX v5.36.0: не прерываем задачу TaskManager проактивным боем.
    // Раньше: находим моба в 8м → bot.pathfinder.goto(GoalFollow) каждые 260мс →
    // отменяет _gotoNearest задачи → бот никогда не доходит до цели (~1 блок/8сек).
    // Теперь: проактивный поиск только когда TaskManager не занят.
    const taskBusy = this.instance.taskManager?._running;

    if (!taskBusy) {
      const proactiveTarget = this._findNearestHostileMob(8);
      if (proactiveTarget && !this._combatTarget) {
        this._setCombatTarget(proactiveTarget, proactiveTarget.mobType || proactiveTarget.name || "mob");
      }
    }

    if (!this._combatTarget) return;

    // Проверяем что цель ещё жива и рядом
    const target = this._combatTarget;
    if (!target.isValid || !target.position) {
      this._clearCombatTarget();
      return;
    }

    const dist = bot.entity.position.distanceTo(target.position);

    // Цель убежала далеко (>24м) — прекращаем преследование через 15 сек
    if (dist > 24) {
      const elapsed = Date.now() - this._combatStartedAt;
      if (elapsed > 15000) {
        log.info(`[AgentLoop] Target ${this._combatTargetName} fled, stopping combat`);
        this._clearCombatTarget();
        return;
      }
    }

    try {
      if (dist > 3.2) {
        // FIX v5.36.0: если бот занят задачей — не перехватываем pathfinder.
        // Ждём пока моб сам подойдёт на дистанцию удара (<= 3.2).
        if (taskBusy) return;

        // Спринт: allowSprinting=false (GrimAC Invalid Move fix, см. anti-detect.js)

        // AntiDetect: не перезапускаем pathfinder если цель не ушла далеко
        const moved = !this._moveTargetPos ||
          this._moveTargetPos.distanceTo(target.position) > 2.5;

        if (!this._movingToTarget || moved) {
          this._movingToTarget = true;
          this._moveTargetPos = target.position.clone();
          // GoalFollow: бот следует за движущейся целью (не перезапускает каждые 200мс)
          bot.pathfinder.goto(new goals.GoalFollow(target, 2))
            .then(() => { this._movingToTarget = false; })
            .catch(() => { this._movingToTarget = false; });
        }
      } else {
        // В зоне удара — атакуем даже во время задачи (не ломаем её pathfinder)
        this._movingToTarget = false;
        if (!taskBusy) {
          try { bot.pathfinder.stop(); } catch {}
        }

        // AntiDetect: FOV-проверка — не атакуем за спиной (KillAura флаг)
        if (!this._antiDetect.isInFov(target, 130)) {
          await this._antiDetect.smoothLookAt(
            target.position.offset(0, target.type === 'player' ? 0.85 : (target.height || 1.8) * 0.5, 0), 3
          );
          return; // атакуем в следующем тике
        }

        // AntiDetect: плавный поворот + рандомный pre-attack delay
        await this._antiDetect.smoothLookAt(
          target.position.offset(0, target.type === 'player' ? 0.85 : (target.height || 1.8) * 0.5, 0), 4
        );

        const now = Date.now();
        if (now - this._lastAttackTime >= this._nextAttackDelay) {
          await delay(AntiDetect.preAttackDelay());
          this._lastAttackTime = Date.now();
          this._nextAttackDelay = AntiDetect.attackDelay();
          await this._equipBestWeapon();
          await bot.attack(target);
        }
      }
    } catch {}
  }

  // ── Поиск целей ──────────────────────────────────────────────────────

  _findNearestHostileMob(maxDist) {
    const bot = this.bot;
    const pos = bot.entity.position;
    let nearest = null;
    let minDist = maxDist;

    for (const entity of Object.values(bot.entities)) {
      if (!entity.position || entity === bot.entity) continue;
      const name = (entity.mobType || entity.name || "").toLowerCase();
      if (!HOSTILE_MOBS.has(name)) continue;
      const dist = pos.distanceTo(entity.position);
      if (dist < minDist) { minDist = dist; nearest = entity; }
    }
    return nearest;
  }

  _findNearestThreat(maxDist) {
    const bot = this.bot;
    const pos = bot.entity.position;
    let nearest = null;
    let minDist = maxDist;

    for (const entity of Object.values(bot.entities)) {
      if (!entity.position || entity === bot.entity) continue;
      const name = (entity.mobType || entity.name || entity.type || "").toLowerCase();
      const isHostileMob = HOSTILE_MOBS.has(name);
      // Игроки учитываются только если есть в _attackers
      const isKnownAttacker = this._attackers.has(entity.id);
      if (!isHostileMob && !isKnownAttacker) continue;
      const dist = pos.distanceTo(entity.position);
      if (dist < minDist) {
        minDist = dist;
        nearest = { entity, name: entity.username || name };
      }
    }
    return nearest;
  }

  // ── Смерть ───────────────────────────────────────────────────────────

  _onDeath() {
    if (this.bot?.entity) {
      this._deathPos = this.bot.entity.position.clone();
    }
    this._clearCombatTarget();
    this._attackers.clear();
    setTimeout(() => this._collectDroppedItems(), 4000);
  }

  async _collectDroppedItems() {
    const bot = this.bot;
    if (!bot?.entity || !this._active) return;

    const droppedItems = Object.values(bot.entities).filter((e) => {
      if (e.type !== "object" || e.objectType !== "Item") return false;
      if (!this._deathPos) return true;
      return e.position?.distanceTo(this._deathPos) < 32;
    });

    if (droppedItems.length === 0 && this._deathPos) {
      try {
        await bot.pathfinder.goto(new goals.GoalBlock(
          Math.round(this._deathPos.x),
          Math.round(this._deathPos.y),
          Math.round(this._deathPos.z)
        ));
      } catch {}
      return;
    }

    for (const item of droppedItems.slice(0, 20)) {
      if (!this._active || !bot.entity) break;
      try {
        await bot.pathfinder.goto(
          new goals.GoalNear(item.position.x, item.position.y, item.position.z, 1)
        );
        await delay(200);
      } catch {}
    }
  }

  // ── Еда ──────────────────────────────────────────────────────────────

  async _onHealthTick() {
    const bot = this.bot;
    if (!bot || !this._active) return;
    const now = Date.now();
    if (now - this._lastEat < 8000) return;

    if (bot.food < 14) {
      const food = bot.inventory.items()
        .filter((i) => i.foodPoints && i.foodPoints > 0)
        .sort((a, b) => (b.foodPoints || 0) - (a.foodPoints || 0))[0];

      if (food) {
        this._lastEat = now;
        try {
          await bot.equip(food, "hand");
          await bot.consume();
        } catch {}
      }
    }
  }

  // ── Оружие и броня ───────────────────────────────────────────────────

  async _equipBestWeapon() {
    const bot = this.bot;
    const WEAPON_TIERS = [
      "netherite_sword","diamond_sword","iron_sword","stone_sword",
      "wooden_sword","golden_sword","netherite_axe","diamond_axe","iron_axe",
    ];
    for (const name of WEAPON_TIERS) {
      const item = bot.inventory.items().find((i) => i.name === name);
      if (item) {
        try { await bot.equip(item, "hand"); return; } catch {}
      }
    }
  }

  async _autoEquipArmor() {
    const bot = this.bot;
    if (!bot?.entity) return;
    const slots = ["helmet","chestplate","leggings","boots"];
    const TIERS = ["netherite","diamond","iron","chainmail","golden","leather"];
    for (const slot of slots) {
      for (const tier of TIERS) {
        const item = bot.inventory.items().find((i) => i.name === `${tier}_${slot}`);
        if (item) {
          try { await bot.equip(item, slot === "helmet" ? "head" : slot === "chestplate" ? "torso" : slot === "leggings" ? "legs" : "feet"); break; } catch {}
        }
      }
    }
  }

  // ── Главный цикл (5сек) ──────────────────────────────────────────────

  _startLoop() {
    this._mainLoop = setInterval(() => this._tick(), 5000);
  }

  async _tick() {
    const bot = this.bot;
    if (!bot?.entity || !this._active) return;

    // Очищаем устаревших атакующих (>60 сек без удара)
    const now = Date.now();
    for (const [id, info] of this._attackers) {
      if (now - info.lastHitTime > 60000) this._attackers.delete(id);
    }

    if (bot.entity.onFire) {
      await this._escapeFireOrWater();
      return;
    }

    // Запись позиции для детекции зависания
    if (now - this._lastPosRecord > 10000) {
      this._lastPosRecord = now;
      const pos = { x: Math.round(bot.entity.position.x), z: Math.round(bot.entity.position.z) };
      this._posHistory.push(pos);
      if (this._posHistory.length > 6) this._posHistory.shift();
    }

    if (this._posHistory.length >= 3) {
      const last3 = this._posHistory.slice(-3);
      const moved = last3.some((p, i) => i > 0 &&
        (Math.abs(p.x - last3[i-1].x) > 2 || Math.abs(p.z - last3[i-1].z) > 2)
      );
      if (!moved) {
        this._stuckAttempts++;
        if (this._stuckAttempts <= 3) await this._unstuck(this._stuckAttempts);
        return;
      } else {
        this._stuckAttempts = 0;
      }
    }
  }

  async _escapeFireOrWater() {
    const bot = this.bot;
    const water = bot.findBlock({
      matching: (b) => b.type === (bot.registry.blocksByName.water?.id || 0),
      maxDistance: 20,
    });
    if (water) {
      try {
        await bot.pathfinder.goto(
          new goals.GoalBlock(water.position.x, water.position.y, water.position.z)
        );
      } catch {}
    } else {
      await this._unstuck(1);
    }
  }

  async _unstuck(attempt) {
    const bot = this.bot;
    this._posHistory = [];
    this._movingToTarget = false;
    try { bot.pathfinder.stop(); } catch {}

    const directions = [0, Math.PI / 2, Math.PI, -Math.PI / 2, Math.PI / 4, -Math.PI / 4];
    bot.entity.yaw = directions[(attempt - 1) % directions.length];
    bot.setControlState("jump", true);
    bot.setControlState("forward", true);
    await delay(900);
    bot.setControlState("jump", false);
    if (attempt >= 2) {
      bot.setControlState("back", true);
      await delay(400);
      bot.setControlState("back", false);
    }
    bot.setControlState("forward", false);
  }

  _chat(text) {
    const bot = this.bot;
    if (!bot || !text) return;
    const msg = String(text).slice(0, 100);
    try { bot.chat(msg); } catch {}
    this.emit("bot:chat", {
      botId: this.instance.id,
      username: this.instance.config.nick,
      message: `[AUTO] ${msg}`,
      type: "system",
    });
  }

  stop() {
    this._active = false;
    this._clearCombatTarget();
    this._attackers.clear();
    this._antiDetect.stop();
    if (this._mainLoop) { clearInterval(this._mainLoop); this._mainLoop = null; }
    if (this._combatLoop) { clearInterval(this._combatLoop); this._combatLoop = null; }
  }
}

module.exports = { AgentLoop };
