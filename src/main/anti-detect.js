/**
 * AntiDetect — обход анти-читов (Grim, Matrix, Vulcan, NCP, AAC)
 *
 * Что делает:
 *  1. Плавный поворот головы (5 пакетов вместо 1 снапа)
 *  2. Рандомное микро-смещение ротации во время боя (±0.02 рад)
 *  3. Idle-анимация: бот смотрит по сторонам каждые 8-25 сек
 *  4. Micro-jitter: крошечные покачивания головой каждые 1-4 сек
 *  5. Случайный дополнительный delay перед каждым ударом
 *  6. Проверка FOV: не атакуем цель за спиной (защита от KillAura флага)
 */

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

// ─── вспомогательное: нормализация угла ──────────────────────────────────────
function normAngle(a) {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

// ─── ease-in-out ──────────────────────────────────────────────────────────────
function easeInOut(t) {
  return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
}

class AntiDetect {
  constructor(bot) {
    this.bot = bot;
    this._running = false;
    this._inCombat = false;
    this._idleTimer = null;
    this._jitterTimer = null;
  }

  // ── Запуск / остановка ────────────────────────────────────────────────────

  start() {
    this._running = true;
    this._scheduleIdleLook();
    this._scheduleJitter();
  }

  stop() {
    this._running = false;
    clearTimeout(this._idleTimer);
    clearTimeout(this._jitterTimer);
  }

  /** Боевой режим — suspend idle animations */
  setInCombat(val) {
    this._inCombat = val;
  }

  // ── Плавный поворот головы ─────────────────────────────────────────────────

  /**
   * Smoothly rotate to face `targetPos` over `steps` look-packets.
   * Each step is separated by a small random delay (35-65ms ≈ human reaction).
   */
  async smoothLookAt(targetPos, steps = 5) {
    const bot = this.bot;
    if (!bot?.entity || !targetPos) return;
    try {
      const eyeY = bot.entity.position.y + (bot.entity.height ?? 1.8) * 0.9;
      const dx = targetPos.x - bot.entity.position.x;
      const dy = targetPos.y - eyeY;
      const dz = targetPos.z - bot.entity.position.z;
      const r = Math.sqrt(dx * dx + dz * dz);

      const targetYaw   = Math.atan2(-dx, -dz);
      const targetPitch = -Math.atan2(dy, r);
      const clampPitch  = (p) => Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, p));

      const startYaw   = bot.entity.yaw;
      const startPitch = bot.entity.pitch;
      const yawDelta   = normAngle(targetYaw - startYaw);
      const pitchDelta = targetPitch - startPitch;

      for (let i = 1; i <= steps; i++) {
        if (!this._running && !this._inCombat) break;
        const t = i / steps;
        const e = easeInOut(t);
        // tiny random noise on last-but-one step (simulates human imprecision then correction)
        const noise = i < steps ? (Math.random() - 0.5) * 0.025 : 0;
        const yaw   = startYaw + yawDelta * e + noise;
        const pitch = clampPitch(startPitch + pitchDelta * e);
        await bot.look(yaw, pitch, false);
        await delay(35 + Math.random() * 30); // 35–65 ms per step
      }
    } catch {}
  }

  // ── Проверка FOV (защита от KillAura детекта) ─────────────────────────────

  /**
   * Returns true if `entity` is within `fovDeg` degrees of bot's look direction.
   * Grim flags attacks on entities outside ~120° FOV.
   */
  isInFov(entity, fovDeg = 120) {
    const bot = this.bot;
    if (!bot?.entity || !entity?.position) return true; // assume yes if can't check
    try {
      const dx = entity.position.x - bot.entity.position.x;
      const dz = entity.position.z - bot.entity.position.z;
      const entityYaw = Math.atan2(-dx, -dz);
      const angleDiff = Math.abs(normAngle(entityYaw - bot.entity.yaw));
      return angleDiff <= (fovDeg / 2) * (Math.PI / 180);
    } catch {
      return true;
    }
  }

  // ── Рандомный кулдаун атаки (сбивает таймер-чеки) ────────────────────────

  /** Randomised 1.9 PvP attack window: 580-730ms */
  static attackDelay() {
    return 580 + Math.random() * 150;
  }

  /** Extra jitter BEFORE the hit (50-180ms) — humans have reaction time */
  static preAttackDelay() {
    return 50 + Math.random() * 130;
  }

  // ── Задержка симуляции набора текста ─────────────────────────────────────

  static async chatDelay(text) {
    const ms = Math.min(text.length * (40 + Math.random() * 25), 3500);
    await delay(ms);
  }

  // ── Idle анимации ─────────────────────────────────────────────────────────

  async _doIdleLook() {
    if (!this._running || this._inCombat) return;
    const bot = this.bot;
    if (!bot?.entity) return;
    try {
      // Players naturally look slightly down and sideways
      const yaw   = bot.entity.yaw + (Math.random() - 0.5) * 1.8;
      const pitch = Math.random() * 0.5 - 0.05; // -0.05..0.45 (slightly down)
      // Smooth the idle look too (2 steps)
      const startYaw = bot.entity.yaw;
      for (let i = 1; i <= 2; i++) {
        const t = i / 2;
        await bot.look(startYaw + normAngle(yaw - startYaw) * t, pitch * t, false);
        await delay(80 + Math.random() * 60);
      }
    } catch {}
    this._scheduleIdleLook();
  }

  _scheduleIdleLook() {
    if (!this._running) return;
    // 8–25 seconds between idle head turns
    this._idleTimer = setTimeout(() => this._doIdleLook(), 8000 + Math.random() * 17000);
  }

  async _doJitter() {
    if (!this._running || this._inCombat) return;
    const bot = this.bot;
    if (!bot?.entity) return;
    try {
      const j = (Math.random() - 0.5) * 0.05; // ±0.025 rad ≈ ±1.4°
      await bot.look(bot.entity.yaw + j, bot.entity.pitch, false);
    } catch {}
    this._scheduleJitter();
  }

  _scheduleJitter() {
    if (!this._running) return;
    // 1–4 seconds between micro-jitters
    this._jitterTimer = setTimeout(() => this._doJitter(), 1000 + Math.random() * 3000);
  }
}

module.exports = { AntiDetect };
