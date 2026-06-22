/**
 * AntiDetect v2 — комплексный обход античитов
 *
 * Поддерживаемые системы:
 *   ● GrimAC   — детерминированная физика, FOV check, velocity prediction
 *   ● Vulcan   — таймер-чек, paket rate, scaffold/flight
 *   ● Intave   — продвинутая эвристика, reach/aim analysis
 *   ● Matrix   — aimbot detection, rotation analysis, combat analytics
 *   ● Spartan  — packet analysis, movement patterns, combat stats
 *
 * Что детектируют античиты (и как мы это обходим):
 *
 * 1. KILLAURA / AIMBOT
 *    Детект: мгновенный snap поворота к цели (> ~30°/тик), атака вне FOV,
 *            атака через стены, атака нескольких целей одновременно.
 *    Обход:  smoothLookAt (lerp, 5 шагов, ease-in-out), FOV проверка (130°),
 *            preAttackDelay (50-180ms human reaction), один target.
 *
 * 2. SPEED / VELOCITY HACK
 *    Детект: горизонтальная скорость > WALK_MAX (0.215), velocity не соответствует
 *            физике (GrimAC симулирует позицию каждый тик).
 *    Обход:  НЕЛЬЗЯ менять координаты в position-пакетах. Velocity clamp на
 *            physicsTick. allowSprinting = false по умолчанию.
 *
 * 3. TIMER HACK
 *    Детект: Vulcan/GrimAC считают пакеты position/tick в секунду.
 *            Норма: 20 пакетов/сек. >21 = флаг Timer.
 *    Обход:  НЕЛЬЗЯ добавлять setTimeout к position-пакетам. Не ускоряем tick.
 *
 * 4. REACH
 *    Детект: атака цели на дистанции > 3.0 (Vanilla reach = ~3.0-3.5 блоков).
 *            Intave/Matrix проверяет точку hitbox, Vulcan проверяет box-to-box.
 *    Обход:  attackRange 3.0-3.5. Атакуем только когда цель ближе порога.
 *
 * 5. AUTO-EAT / SUSPICIOUS CONSUME
 *    Детект: мгновенный equip→consume без задержки, consume без движения рта.
 *    Обход:  задержка перед consume (200-400ms), использовать только при hunger < 16.
 *
 * 6. BRAND DETECTION
 *    Детект: Сервер читает brand-пакет. "mineflayer" — явный бот.
 *    Обход:  brand "mineflayer" → "vanilla" в plugin_message.
 *
 * 7. SETTINGS TIMING
 *    Детект: settings-пакет отправляется мгновенно (0ms задержка от join).
 *            Vanilla клиент отправляет его через 150-500ms.
 *    Обход:  задержка 120-450ms, рандомные locale/viewDistance/skinParts.
 *
 * 8. IDLE BEHAVIOR
 *    Детект: бот стоит абсолютно неподвижно (pitch/yaw не меняется) — паттерн бота.
 *    Обход:  idle look (8-25 сек), micro-jitter (1-4 сек, ±0.025 рад).
 *
 * 9. COMBAT PATTERNS
 *    Детект: идеальный 620ms кулдаун, нет miss-кликов, атака каждый тик.
 *    Обход:  preAttackDelay (50-180ms), attackDelay (580-730ms), иногда страйф.
 */

const log = require("electron-log");

function normAngle(a) {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}
function easeInOut(t) {
  return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
}
function delay(ms) { return new Promise(r => setTimeout(r, ms)); }
function rand(a, b) { return a + Math.random() * (b - a); }

class AntiDetect {
  constructor(bot) {
    this.bot = bot;
    this._running = false;
    this._inCombat = false;
    this._idleTimer = null;
    this._jitterTimer = null;
  }

  start() {
    this._running = true;
    this._scheduleIdleLook();
    this._scheduleJitter();
    log.debug("[AntiDetect] Started — idle look + jitter active");
  }

  stop() {
    this._running = false;
    clearTimeout(this._idleTimer);
    clearTimeout(this._jitterTimer);
  }

  setInCombat(val) {
    this._inCombat = val;
  }

  // ── Плавный поворот к цели ──────────────────────────────────────────
  // GrimAC: взгляд не предсказывается, но снап > ~30°/тик → KillAura флаг
  // Intave/Matrix: анализируют траекторию поворота (ease-curve detection)
  // Обход: lerp с ease-in-out + human noise на предпоследнем шаге
  async smoothLookAt(targetPos, steps = 5) {
    const bot = this.bot;
    if (!bot?.entity || !targetPos) return;
    try {
      const eyeY = bot.entity.position.y + (bot.entity.height ?? 1.8) * 0.9;
      const dx = targetPos.x - bot.entity.position.x;
      const dy = targetPos.y - eyeY;
      const dz = targetPos.z - bot.entity.position.z;
      const r  = Math.sqrt(dx * dx + dz * dz);

      const targetYaw   = Math.atan2(-dx, -dz);
      const targetPitch = -Math.atan2(dy, r);
      const clamp = (p) => Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, p));

      const startYaw   = bot.entity.yaw;
      const startPitch = bot.entity.pitch;
      const dYaw   = normAngle(targetYaw - startYaw);
      const dPitch = targetPitch - startPitch;

      for (let i = 1; i <= steps; i++) {
        if (!this._running && !this._inCombat) break;
        const t = i / steps;
        const e = easeInOut(t);
        // Human noise: небольшое отклонение на предпоследнем шаге (имитация промаха и коррекции)
        const noise = i < steps ? (Math.random() - 0.5) * 0.022 : 0;
        const yaw   = startYaw + dYaw * e + noise;
        const pitch = clamp(startPitch + dPitch * e);
        await bot.look(yaw, pitch, false);
        await delay(35 + Math.random() * 28); // 35–63ms per step
      }
    } catch {}
  }

  // ── FOV проверка ────────────────────────────────────────────────────
  // GrimAC: флаг KillAura если атака сущности вне ~120° FOV
  // Обход: проверяем угол до цели перед атакой
  isInFov(entity, fovDeg = 130) {
    const bot = this.bot;
    if (!bot?.entity || !entity?.position) return true;
    try {
      const dx = entity.position.x - bot.entity.position.x;
      const dz = entity.position.z - bot.entity.position.z;
      const entityYaw = Math.atan2(-dx, -dz);
      const angleDiff = Math.abs(normAngle(entityYaw - bot.entity.yaw));
      return angleDiff <= (fovDeg / 2) * (Math.PI / 180);
    } catch { return true; }
  }

  // ── Кулдаун атаки ───────────────────────────────────────────────────
  // Vulcan/GrimAC: детектируют идеальный 620ms паттерн (всегда одинаковый)
  // Обход: рандомизация 580-730ms
  static attackDelay() {
    return 580 + Math.random() * 150;
  }

  // GrimAC/Intave: человек не реагирует мгновенно, есть реакция 50-180ms
  static preAttackDelay() {
    return 50 + Math.random() * 130;
  }

  // ── Задержка набора текста ───────────────────────────────────────────
  // Spartan: детектирует мгновенную отправку команд
  static async chatDelay(text) {
    const ms = Math.min(text.length * (38 + Math.random() * 22), 3200);
    await delay(ms);
  }

  // ── Idle look ───────────────────────────────────────────────────────
  // Intave/Spartan: паттерн бота — неподвижный взгляд долго
  async _doIdleLook() {
    if (!this._running || this._inCombat) return;
    const bot = this.bot;
    if (!bot?.entity) return;
    try {
      // Игроки смотрят немного вниз и иногда по сторонам
      const yaw   = bot.entity.yaw + (Math.random() - 0.5) * 1.6;
      const pitch = rand(0.0, 0.45); // немного вниз
      const startYaw = bot.entity.yaw;
      for (let i = 1; i <= 2; i++) {
        const t = i / 2;
        await bot.look(
          startYaw + normAngle(yaw - startYaw) * t,
          pitch * t,
          false
        );
        await delay(75 + Math.random() * 55);
      }
    } catch {}
    this._scheduleIdleLook();
  }

  _scheduleIdleLook() {
    if (!this._running) return;
    this._idleTimer = setTimeout(() => this._doIdleLook(), 8000 + Math.random() * 17000);
  }

  // ── Micro-jitter ────────────────────────────────────────────────────
  // Matrix/Intave: анализируют стабильность взгляда
  // Человек всегда немного двигает мышью (micro-tremor)
  async _doJitter() {
    if (!this._running || this._inCombat) return;
    const bot = this.bot;
    if (!bot?.entity) return;
    try {
      const j = (Math.random() - 0.5) * 0.048; // ±0.024 рад ≈ ±1.4°
      await bot.look(bot.entity.yaw + j, bot.entity.pitch, false);
    } catch {}
    this._scheduleJitter();
  }

  _scheduleJitter() {
    if (!this._running) return;
    this._jitterTimer = setTimeout(() => this._doJitter(), 1000 + Math.random() * 3000);
  }

  // ── Статический патч бренда при входе ──────────────────────────────
  // Вызывается ОДИН РАЗ сразу после createBot()
  static patchLoginPackets(bot) {
    try {
      const client = bot._client;
      if (!client) return;
      const orig = client.write.bind(client);
      let brandDone = false, settingsDone = false;

      client.write = function(name, data) {
        // 1. brand: mineflayer → vanilla
        if (!brandDone && (name === "plugin_message" || name === "custom_payload")
            && data?.channel === "minecraft:brand") {
          brandDone = true;
          const brand = "vanilla";
          const buf = Buffer.allocUnsafe(1 + brand.length);
          buf[0] = brand.length;
          buf.write(brand, 1, "utf8");
          log.debug("[AntiDetect] brand masked: mineflayer → vanilla");
          return orig(name, { ...data, data: buf });
        }

        // 2. settings: задержка 120–450ms + рандомизация
        if (!settingsDone && name === "settings") {
          settingsDone = true;
          const ms = 120 + Math.floor(Math.random() * 330);
          const locales = ["en_US","ru_RU","uk_UA","en_GB","de_DE","pl_PL"];
          const patched = {
            ...data,
            locale:       locales[Math.floor(Math.random() * locales.length)],
            viewDistance: 8 + Math.floor(Math.random() * 5),
            chatMode:     0,
            chatColors:   true,
            skinParts:    121 + Math.floor(Math.random() * 7),
            mainHand:     1,
          };
          log.debug(`[AntiDetect] settings delayed ${ms}ms`);
          setTimeout(() => { try { orig(name, patched); } catch {} }, ms);
          return;
        }

        return orig(name, data);
      };

      // 3. teleport_confirm во время загрузки мира
      client.on("position", (packet) => {
        if (packet.teleportId !== undefined) {
          try { client.write("teleport_confirm", { teleportId: packet.teleportId }); } catch {}
        }
      });

      log.info("[AntiDetect] Login packet masking active");
    } catch (err) {
      log.warn("[AntiDetect] patchLoginPackets error:", err.message);
    }
  }

  // ── onGround correction ─────────────────────────────────────────────
  // GrimAC: проверяет что onGround flag соответствует реальному положению
  static patchGroundFlag(bot) {
    try {
      const origWrite = bot._client.write.bind(bot._client);
      bot._client.write = function(name, params) {
        if ((name === "position" || name === "position_look") && params && bot.entity) {
          try {
            const below = bot.blockAt(bot.entity.position.offset(0, -0.1, 0));
            const actualOnGround = below && below.boundingBox === "block"
              ? bot.entity.position.y - Math.floor(bot.entity.position.y) < 0.05
              : false;
            if (params.onGround && !actualOnGround && bot.entity.velocity.y < -0.1) {
              params = { ...params, onGround: false };
            }
          } catch {}
        }
        return origWrite(name, params);
      };
      bot.once("end", () => { try { bot._client.write = origWrite; } catch {} });
    } catch {}
  }

  // ── Velocity clamp ──────────────────────────────────────────────────
  // GrimAC: симулирует физику и сравнивает с position-пакетами.
  // Если hSpeed > 0.215 → Speed флаг. Если vSpeed < -3.92 → Flight.
  static patchVelocityClamp(bot) {
    const WALK_MAX  = 0.215;
    const TERM_VEL  = 3.92;
    const handler = () => {
      if (!bot.entity) return;
      const vel = bot.entity.velocity;
      const hSq = vel.x * vel.x + vel.z * vel.z;
      if (hSq > WALK_MAX * WALK_MAX) {
        const s = WALK_MAX / Math.sqrt(hSq);
        vel.x *= s; vel.z *= s;
      }
      if (vel.y < -TERM_VEL) vel.y = -TERM_VEL;
    };
    bot.on("physicsTick", handler);
    bot.once("end", () => { try { bot.removeListener("physicsTick", handler); } catch {} });
  }

  // ── Плавный lookAt (lerp вместо снапа) ─────────────────────────────
  // KillAura флаг: snap > ~30°/тик (= ~25° для GrimAC strict)
  static patchLookAt(bot) {
    const orig = bot.lookAt.bind(bot);
    bot.lookAt = async function(point, force = false) {
      if (!bot.entity || !point) return orig(point, force);
      try {
        const dx = point.x - bot.entity.position.x;
        const dy = (point.y ?? bot.entity.position.y + 1.62) - (bot.entity.position.y + 1.62);
        const dz = point.z - bot.entity.position.z;
        const tYaw   = Math.atan2(-dx, dz);
        const tPitch = Math.atan2(-dy, Math.sqrt(dx * dx + dz * dz));
        let dYaw = tYaw - bot.entity.yaw;
        while (dYaw >  Math.PI) dYaw -= 2 * Math.PI;
        while (dYaw < -Math.PI) dYaw += 2 * Math.PI;
        const dPitch = tPitch - bot.entity.pitch;
        const MAX_RAD = 0.44; // ~25° per step
        const steps = Math.ceil(Math.max(Math.abs(dYaw), Math.abs(dPitch)) / MAX_RAD);
        if (steps <= 1 || force) return orig(point, force);
        const startYaw = bot.entity.yaw, startPitch = bot.entity.pitch;
        for (let i = 1; i <= steps; i++) {
          if (!bot.entity) break;
          const t = i / steps;
          bot.entity.yaw   = startYaw   + dYaw   * t;
          bot.entity.pitch = startPitch + dPitch * t;
          await new Promise(r => setTimeout(r, 48));
        }
        return orig(point, true);
      } catch { return orig(point, force); }
    };
  }
}

module.exports = { AntiDetect };
