/**
 * AntiDetect v3 — комплексный обход античитов
 *
 * ВАЖНО — что УБРАНО по сравнению с v2 и ПОЧЕМУ:
 *
 *  ✗ patchVelocityClamp  — изменяет bot.entity.velocity ПОСЛЕ того как
 *    physicsTick уже отправил position-пакет. Сервер получает пакет с одной
 *    скоростью, а следующий position уже со сдвинутой — GrimAC видит
 *    "Invalid move player packet received" и кикает.
 *
 *  ✗ patchGroundFlag — патчит onGround в position-пакетах. GrimAC
 *    симулирует физику сам и сравнивает — любое несоответствие = флаг.
 *
 *  ✓ patchLoginPackets — brand + settings masking (безопасно, до spawn)
 *  ✓ smoothLookAt      — lerp поворот 5 шагов (анти KillAura)
 *  ✓ isInFov           — проверка угла перед атакой
 *  ✓ attackDelay       — рандомный тайминг 580-730ms
 *  ✓ preAttackDelay    — реакция человека 50-180ms
 *  ✓ idleLook + jitter — случайные движения взгляда (анти-паттерн)
 *  ✓ patchLookAt       — плавный lookAt без снапа
 *
 * Правильные настройки Movements (ОБЯЗАТЕЛЬНО в bot-manager.js):
 *   movements.allowSprinting    = false  ← главный фикс "Invalid move"
 *   movements.allow1by1towers   = false
 *   movements.canDig            = false  (во время PVP)
 */

const log = require("electron-log");

function normAngle(a) {
  while (a >  Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}
function easeInOut(t) { return t < 0.5 ? 2*t*t : -1 + (4 - 2*t)*t; }
function delay(ms)    { return new Promise(r => setTimeout(r, ms)); }
function rand(a, b)   { return a + Math.random() * (b - a); }

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

  setInCombat(val) { this._inCombat = val; }

  // ── Плавный поворот к цели ──────────────────────────────────────────
  // GrimAC: флаг KillAura если снап > ~30°/тик
  // Обход: lerp с ease-in-out + human noise
  async smoothLookAt(targetPos, steps = 5) {
    const bot = this.bot;
    if (!bot?.entity || !targetPos) return;
    try {
      const eyeY = bot.entity.position.y + (bot.entity.height ?? 1.8) * 0.9;
      const dx = targetPos.x - bot.entity.position.x;
      const dy = targetPos.y - eyeY;
      const dz = targetPos.z - bot.entity.position.z;
      const r  = Math.sqrt(dx*dx + dz*dz);

      const targetYaw   = Math.atan2(-dx, -dz);
      const targetPitch = -Math.atan2(dy, r);
      const clampP = (p) => Math.max(-Math.PI/2 + 0.01, Math.min(Math.PI/2 - 0.01, p));

      const startYaw   = bot.entity.yaw;
      const startPitch = bot.entity.pitch;
      const dYaw   = normAngle(targetYaw - startYaw);
      const dPitch = targetPitch - startPitch;

      for (let i = 1; i <= steps; i++) {
        if (!this._running && !this._inCombat) break;
        const t = i / steps;
        const e = easeInOut(t);
        const noise = i < steps ? (Math.random() - 0.5) * 0.02 : 0;
        const yaw   = startYaw   + dYaw   * e + noise;
        const pitch = clampP(startPitch + dPitch * e);
        await bot.look(yaw, pitch, false);
        await delay(38 + Math.random() * 25); // 38-63ms per step
      }
    } catch {}
  }

  // ── FOV проверка ────────────────────────────────────────────────────
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

  // ── Тайминги атаки ──────────────────────────────────────────────────
  // Детект: идеальный 620ms паттерн
  // Обход: рандомизация 580-730ms
  static attackDelay()    { return 580 + Math.random() * 150; }
  // Реакция человека 50-180ms
  static preAttackDelay() { return 50  + Math.random() * 130; }

  // ── Задержка набора текста ───────────────────────────────────────────
  // Spartan: мгновенная отправка команд = бот
  static async chatDelay(text) {
    const ms = Math.min(text.length * (38 + Math.random() * 22), 3200);
    await delay(ms);
  }

  // ── Idle look ───────────────────────────────────────────────────────
  // Паттерн бота: неподвижный взгляд > 20сек = флаг
  async _doIdleLook() {
    if (!this._running || this._inCombat) return;
    const bot = this.bot;
    if (!bot?.entity) return;
    try {
      const yaw   = bot.entity.yaw + (Math.random() - 0.5) * 1.4;
      const pitch = rand(0.0, 0.5);
      const startYaw = bot.entity.yaw;
      for (let i = 1; i <= 3; i++) {
        const t = i / 3;
        await bot.look(
          startYaw + normAngle(yaw - startYaw) * t,
          pitch * t,
          false
        );
        await delay(60 + Math.random() * 60);
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
  async _doJitter() {
    if (!this._running || this._inCombat) return;
    const bot = this.bot;
    if (!bot?.entity) return;
    try {
      const j = (Math.random() - 0.5) * 0.05;
      await bot.look(bot.entity.yaw + j, bot.entity.pitch, false);
    } catch {}
    this._scheduleJitter();
  }
  _scheduleJitter() {
    if (!this._running) return;
    this._jitterTimer = setTimeout(() => this._doJitter(), 1200 + Math.random() * 2800);
  }

  // ── Brand + Settings masking (безопасно — до spawn) ────────────────
  // Сервер видит brand "mineflayer" = бот. Меняем на "vanilla".
  // Settings: vanilla отправляет через 150-500ms с рандомными полями.
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
          log.debug("[AntiDetect] brand: mineflayer → vanilla");
          return orig(name, { ...data, data: buf });
        }
        // 2. settings: задержка 120-450ms + рандомизация полей
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

      // teleport_confirm: ответ на TP-пакеты во время загрузки
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

  // ── Плавный lookAt (замена стандартного) ───────────────────────────
  // Без этого бот делает snap-поворот который KillAura флагает
  static patchLookAt(bot) {
    const orig = bot.lookAt.bind(bot);
    bot.lookAt = async function(point, force = false) {
      if (!bot.entity || !point) return orig(point, force);
      try {
        const dx = point.x - bot.entity.position.x;
        const dy = (point.y ?? bot.entity.position.y + 1.62) - (bot.entity.position.y + 1.62);
        const dz = point.z - bot.entity.position.z;
        const tYaw   = Math.atan2(-dx, dz);
        const tPitch = Math.atan2(-dy, Math.sqrt(dx*dx + dz*dz));
        let dYaw = tYaw - bot.entity.yaw;
        while (dYaw >  Math.PI) dYaw -= 2 * Math.PI;
        while (dYaw < -Math.PI) dYaw += 2 * Math.PI;
        const dPitch = tPitch - bot.entity.pitch;
        const MAX_RAD = 0.44; // ~25° за шаг
        const steps = Math.ceil(Math.max(Math.abs(dYaw), Math.abs(dPitch)) / MAX_RAD);
        if (steps <= 1 || force) return orig(point, force);
        const startYaw = bot.entity.yaw, startPitch = bot.entity.pitch;
        for (let i = 1; i <= steps; i++) {
          if (!bot.entity) break;
          const t = easeInOut(i / steps);
          await bot.look(startYaw + dYaw * t, startPitch + dPitch * t, false);
          await new Promise(r => setTimeout(r, 45 + Math.random() * 20));
        }
        return orig(point, true);
      } catch { return orig(point, force); }
    };
  }
}

module.exports = { AntiDetect };
