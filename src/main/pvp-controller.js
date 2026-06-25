/**
 * PvpController v5.2 — FIXES:
 * - Line-of-sight проверка перед атакой (не бьём сквозь блоки)
 * - _isEating флаг: удар не прерывает еду
 * - Криты: пересчёт прицела по ЖИВОЙ позиции цели после прыжка
 * - Ритм критов: % 2 (1 крит → 1 обычный, и т.д.)
 * - _autoBuffPotions добавлен (был краш каждые 8 тиков)
 * - Зелья на себя: splash → activateItem (бросок), обычные → consume
 * - Еда при низком HP даже без цели
 * - Движение: только один режим (pathfinder ИЛИ прямое управление), смотрим куда идём
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

function rand(lo, hi) { return lo + Math.random() * (hi - lo); }
function sleep(ms)    { return new Promise(r => setTimeout(r, ms)); }
function clamp(v,lo,hi){ return Math.max(lo, Math.min(hi, v)); }

// Проверка прямой видимости (нет блоков между ботом и целью)
function hasLineOfSight(bot, target) {
  try {
    if (!bot?.entity || !target?.position) return false;
    const from = bot.entity.position.offset(0, 1.62, 0); // глаза бота
    const to   = target.position.offset(0, target.type === 'player' ? 0.85 : (target.height || 1.8) * 0.5, 0);
    const dir  = to.minus(from);
    const dist = dir.norm();
    if (dist < 0.1) return true;
    const norm = dir.scaled(1 / dist);

    // Проверяем блоки по лучу
    let step = 0;
    while (step < dist - 0.5) {
      step = Math.min(step + 0.5, dist - 0.1);
      const pt   = from.offset(norm.x * step, norm.y * step, norm.z * step);
      const block = bot.blockAt(pt);
      if (block && block.boundingBox === 'block') return false;
    }
    return true;
  } catch { return true; } // при ошибке — разрешаем атаку
}

class PvpController {
  constructor(instance, emit) {
    this.instance   = instance;
    this.emit       = emit;
    this.brain      = new PvpBrain();
    // FIX: callback для логирования кол-ва онлайн-обучений в лог вкладки
    this.brain._onLogTrainCount = (count) => {
      this._log('🧠 Онлайн-обучений: ' + count);
    };
    this._running   = false;
    this._loopTimer = null;
    this._target    = null;
    this._lastKnownTargetPos = null; // кэш последней валидной позиции цели
    this._teammates = new Set();
    this._attackCount   = 0;
    this._tickCount     = 0;
    this._hitCount      = 0;
    this._critCount     = 0;
    this._lastAttackMs  = 0;
    this._forceAttack   = 0;
    this._isDoingAction = false;
    this._isEating      = false;  // FIX: отдельный флаг еды — не прерывается от урона
    this._actionStartedAt = 0;
    this._lastHealthCheck = 0;
    this._lastHP         = 20;
    this._spawnTime      = Date.now();
    this._detectedPlayers = [];

    this._gappleCooldown             = 0;
    this._enchantedGappleCooldown    = 120000;
    this._gappleCooldownEnd          = 0;
    this._enchantedGappleCooldownEnd = 0;

    this._critCycleMs = 350 + 200;
  }

  start(opts = {}) {
    if (this._running) return;
    const { bot } = this.instance;
    if (!bot?.entity) { log.warn("[PvpController] no bot entity"); return; }

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
    this._isEating      = false;
    this._lastHP = bot.health ?? 20;
    this._gappleCooldownEnd          = 0;
    this._enchantedGappleCooldownEnd = 0;

    try {
      const { Movements } = require("mineflayer-pathfinder");
      const m = new Movements(bot);
      m.allowSprinting  = true;
      m.allow1by1towers = false;
      m.canDig          = false;
      bot.pathfinder.setMovements(m);
    } catch {}

    // FIX: используем 'health' (не 'entityHurt') — 'health' срабатывает когда меняется
    // HP самого бота. 'entityHurt' срабатывает для ДРУГИХ существ, не для бота.
    this._onHurt = () => {
      const currentHP = bot.health ?? 20;
      if (currentHP < this._lastHP - 0.5) {
        // Получили урон — сбрасываем jump если висим в воздухе (нокбэк после крита)
        if (!bot.entity?.onGround) {
          try { bot.setControlState('jump', false); } catch {}
          log.debug("[PvpController] 🔽 Сброс jump — получили урон в воздухе");
        }
        if (!this._isEating && this._isDoingAction) {
          if (currentHP <= 1) {
            log.debug("[PvpController] 🛡️ Тотем сработал — продолжаем лечение");
            this._isDoingAction = false;
            this._forceAttack = 0;
          } else {
            log.debug("[PvpController] урон во время действия — прерываем (не еду)");
            this._isDoingAction = false;
            this._forceAttack = 3;
          }
        }
        // Если едим — НЕ прерываем, продолжаем есть
      }
      this._lastHP = currentHP;
    };
    try { bot.on("health", this._onHurt); } catch {}

    this.emit("bot:pvpStarted", { botId: this.instance.id });
    this._addChat("⚔️ PVP v5.1 [LOS+крит+спринт]");
    this._scheduleTick(200);
    log.info(`[PvpController] v5.1 started team=[${[...this._teammates].join(",")}]`);
  }

  _log(msg) {
    try { log.debug('[PvpController] ' + msg); } catch {}
    try { this.emit('bot:actionLog', { botId: this.instance.id, logType: 'pvp', msg }); } catch {}
  }

  stop() {
    this._running = false;
    if (this._loopTimer) { clearTimeout(this._loopTimer); this._loopTimer = null; }
    const { bot } = this.instance;
    if (bot) {
      try { bot.off("health", this._onHurt); } catch {}
      try { bot.pathfinder?.stop(); } catch {}
      try { bot.setControlState?.("forward", false); } catch {}
      try { bot.setControlState?.("sprint",  false); } catch {}
      try { bot.setControlState?.("jump",    false); } catch {}
    }
    this._isDoingAction = false;
    this._isEating      = false;
    this._target = null;
    this.emit("bot:pvpStopped", { botId: this.instance.id });
    this._addChat("🛑 PVP остановлен");
  }

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
      this._scanNearby80();

      // Нет цели — следуем за тимейтом, едим если надо
      if (!this._target) {
        const _pK2 = Object.keys(bot.players || {});
        const _pE2 = _pK2.filter(k => bot.players[k]?.entity).length;
        this._log('[NO-TARGET] players=[' + (_pK2.join(',') || 'none') + '] withEntity=' + _pE2 + '/' + _pK2.length);
        const hp   = bot.health ?? 20;
        const food = bot.food   ?? 20;
        if (!this._isDoingAction && !this._isEating) {
          const eatMode = this._shouldEatNoCombat(hp, food);
          if (eatMode) {
            await this._doEatSmart(bot, eatMode);
          } else {
            await this._followTeammate(bot);
          }
        }
        this._scheduleTick(500);
        return;
      }

      const hp   = bot.health ?? 20;
      const food = bot.food   ?? 20;
      // Кэшируем позицию когда она есть, используем кэш когда null (~80-800мс после удара).
      // НИКОГДА не обнуляем target из-за null position — иначе 600-800мс потери цели на каждый удар.
      // FIX: клонируем позицию — иначе ссылка мутируется Mineflayer'ом
      if (this._target?.position) {
        try { this._lastKnownTargetPos = this._target.position.clone(); }
        catch { this._lastKnownTargetPos = this._target.position; }
      }
      const tgtPos = this._target?.position ?? this._lastKnownTargetPos;
      if (!tgtPos) { this._target = null; this._scheduleTick(150); return; }
      const dist = bot.entity.position.distanceTo(tgtPos);

      // Лог каждые 5 тиков
      if (this._tickCount % 5 === 0) {
        this._log(`📊 HP=${hp.toFixed(1)} еда=${food} dist=${dist.toFixed(1)} цель=${this._target?.username||this._target?.name||'?'} eating=${this._isEating} forceAtk=${this._forceAttack}`);
      }

      // Сброс зависших действий (не еды — у еды свой флаг)
      if (this._isDoingAction && !this._isEating && Date.now() - this._actionStartedAt > 3000) {
        const _sA = Math.round((Date.now()-this._actionStartedAt)/1000);
        this._log('[STUCK] _isDoingAction timeout ' + _sA + 's window=' + !!bot.currentWindow);
        this._isDoingAction = false;
        this._forceAttack = 2;
        try { if (bot.currentWindow) bot.closeWindow(bot.currentWindow); } catch {}
      }
      // Еда слишком долго (>3.5 сек)
      if (this._isEating && Date.now() - this._actionStartedAt > 3500) {
        const _sE = Math.round((Date.now()-this._actionStartedAt)/1000);
        this._log('[STUCK] _isEating timeout ' + _sE + 's window=' + !!bot.currentWindow);
        this._isEating = false;
        this._isDoingAction = false;
        try { if (bot.currentWindow) bot.closeWindow(bot.currentWindow); } catch {}
      }
      if (this._isDoingAction || this._isEating) { this._scheduleTick(150); return; }

      // 1. ЭКСТРЕННОЕ ЛЕЧЕНИЕ (HP ≤ 4)
      if (hp <= 4) {
        const healed = await this._emergency(bot);
        if (healed) { this._scheduleTick(300); return; }
      }

      // 2. ЕДА по HP-логике
      // FIX: не едим если враг < 6 блоков (атакуем сначала, иначе вечный цикл еды)
      const eatMode = this._shouldEat(hp, food);
      if (eatMode && this._forceAttack === 0 && dist > 6) {
        this._log(`🍗 Едим: HP=${hp.toFixed(1)}, режим=${eatMode}, dist=${dist.toFixed(1)}`);
        await this._doEatSmart(bot, eatMode);
        // FIX: форсируем атаку после еды — иначе следующий тик снова съест!
        this._forceAttack = 5;
        this._scheduleTick(350);
        return;
      }
      if (eatMode && dist <= 6) {
        this._log(`⚔️ Враг близко dist=${dist.toFixed(1)} — бьём, не едим (HP=${hp.toFixed(1)})`);
      }

      // 3. Принудительная атака после еды/зелья
      if (this._forceAttack > 0) this._forceAttack--;

      // 4. ДВИЖЕНИЕ + АТАКА
      await this._doMoveAndAttack(bot, dist);

      // 5. БАФ-ЗЕЛЬЯ
      if (this._tickCount % 8  === 0) await this._autoBuffPotions(bot);
      if (this._tickCount % 15 === 0) await this._tryDebuffPotion(bot);
      if (this._tickCount % 50 === 0) await this._tryBuffPotion(bot);

      // 6. ХИЛ-ЗЕЛЬЕ при HP < 10
      if (hp < 10 && this._tickCount % 8 === 0) await this._tryHealPotion(bot);

      // 7. Онлайн-обучение
      this._trainBrain(bot, hp);

    } catch (err) {
      log.debug("[PvpController] tick error:", err.message);
    }

    this._scheduleTick(this._target ? 80 : 400);
  }

  async _doMoveAndAttack(bot, dist) {
    if (this._isDoingAction || this._isEating) {
      this._log(`⏸ заблокирован: doingAction=${this._isDoingAction} eating=${this._isEating}`);
      return;
    }
    const target = this._target;
    // FIX: используем lastKnownTargetPos если position временно null (после удара)
    const rawTpos = target?.position ?? this._lastKnownTargetPos;
    if (!rawTpos || !bot.entity) return;

    const pos  = bot.entity.position;
    const tpos = rawTpos; // FIX: может быть lastKnownTargetPos если entity.position==null

    const dx     = tpos.x - pos.x;
    const dz     = tpos.z - pos.z;
    const dist2d = Math.max(Math.sqrt(dx*dx + dz*dz), 0.01);
    const yaw    = Math.atan2(-dx, -dz);
    const aimY   = tpos.y + (target.type === 'player' ? 0.85 : (target.height || 1.8) * 0.5);
    const pitch  = -Math.atan2(aimY - (pos.y + 1.62), dist2d);

    // Закрываем инвентарь
    try { if (bot.currentWindow) bot.closeWindow(bot.currentWindow); } catch {}

    // Оружие
    const eq = target.equipment || [];
    const enemyHasShield = [eq[0], eq[1]].some(i => i?.name?.includes('shield'));
    const items  = bot.inventory.items();
    const sword  = items.find(i => SWORD_NAMES.some(n => i.name.includes(n)));
    const axe    = items.find(i => AXE_NAMES.some(n  => i.name.includes(n)));
    const totem  = items.find(i => i.name === 'totem_of_undying');
    const weapon = (enemyHasShield && axe) ? axe : (sword || axe);
    const weaponCD = (weapon && AXE_NAMES.some(n => weapon.name.includes(n))) ? 975 : 600;

    if ((bot.health ?? 20) <= 5 && totem) {
      try { await bot.equip(totem, 'off-hand'); } catch {}
    }

    // FIX: ДВИЖЕНИЕ — только один режим управления
    this._log(`🗺 dist=${dist.toFixed(2)} → ${dist>8?"PATHFINDER (>8)":dist>3.5?"СПРИНТ (3.5-8)":"АТАКА (≤3.5)"}`);
    if (dist > 3.5) {
      if (dist > 8) {
        // Далеко: pathfinder сам управляет и поворотом и движением
        // НЕ вызываем bot.look — это конфликтует с pathfinder и вызывает зависание на 15 блоках
        // Используем pathfinder для навигации через препятствия
        try {
          const { goals } = require('mineflayer-pathfinder');
          // FIX: обновляем цель каждые 500мс или если цель сместилась > 1.5 блока
          // Гарантирует что бот не зависнет когда pathfinder достиг старой позиции цели
          const _nowMs = Date.now();
          if (!this._lastGoalPos || this._lastGoalPos.distanceTo(tpos) > 1.5 ||
              (_nowMs - (this._lastGoalUpdate || 0)) > 500) {
            this._lastGoalPos = tpos.clone();
            this._lastGoalUpdate = _nowMs;
            this._log(`🏃 Pathfinder → X=${Math.round(tpos.x)} Z=${Math.round(tpos.z)} dist=${dist.toFixed(1)}`); bot.pathfinder.setGoal(new goals.GoalNear(tpos.x, tpos.y, tpos.z, 2), true);
          }
        } catch {
          // Фоллбэк: прямой контроль
          try { bot.setControlState('forward', true); bot.setControlState('sprint', true); } catch {}
        }
      } else {
        // 3.5-8 блоков: смотрим на цель + прямой контроль
        this._log(`🏃 Спринт к цели dist=${dist.toFixed(2)}`);
        // FIX: pitch=-0.3 было "смотреть вверх" — теперь прицел на тело цели (pitch≥0)
        const sprintPitch = Math.max(pitch, 0.05);
        try { await bot.look(yaw, sprintPitch, false); } catch {}
        try { bot.pathfinder?.stop(); } catch {}
        try { bot.setControlState('forward', true); bot.setControlState('sprint', true); } catch {}
      }
      return;
    }

    // В зоне удара (≤3.5 блоков)
    this._lastGoalPos = null;
    try { bot.pathfinder?.stop(); } catch {}
    try { bot.setControlState('sprint',  false); } catch {}

    if (dist > 2.5) {
      try { bot.setControlState('forward', true); } catch {}
    } else {
      try { bot.setControlState('forward', false); } catch {}
    }

    // Берём оружие
    if (weapon && bot.heldItem?.name !== weapon.name) {
      try { await bot.equip(weapon, 'hand'); await sleep(45 + rand(0,20)); } catch {}
    }

    this._log(`⚔️ ЗОНА УДАРА dist=${dist.toFixed(2)} оружие=${weapon?.name||'нет'} onGround=${bot.entity.onGround}`);
    // КД атаки — страфим пока ждём
    const _cdLeft = weaponCD - (Date.now() - this._lastAttackMs);
    if (_cdLeft > 0) {
      // FIX: страфинг во время кулдауна — бот не стоит столбом
      const _stDir = Math.floor(this._tickCount / 3) % 2 === 0;
      try { bot.setControlState('left',  _stDir);  } catch {}
      try { bot.setControlState('right', !_stDir); } catch {}
      this._log(`⏳ КД оружия ${_cdLeft}мс — стрейф ${_stDir ? 'влево' : 'вправо'}`);
      return;
    }
    // CD готов — сбрасываем страфинг перед ударом
    try { bot.setControlState('left',  false); } catch {}
    try { bot.setControlState('right', false); } catch {}

    // FIX: LoS — при dist < 2.5 всегда бьём (вплотную), иначе проверяем
    const _los = dist < 2.5 || hasLineOfSight(bot, target);
    if (!_los) {
      this._log(`👁 Нет LoS — цель за блоком dist=${dist.toFixed(2)}`);
      try { bot.setControlState('forward', true); } catch {}
      return;
    }
    this._log(`👁 LoS OK dist=${dist.toFixed(2)}`);

    // Прицел + look
    try { await bot.look(yaw, pitch, true); } catch {}
    await sleep(30 + rand(0, 30));

    let finalDist;
    try { finalDist = bot.entity.position.distanceTo(tpos); } catch { finalDist = dist; }
    if (isNaN(finalDist)) finalDist = dist; // entity position temporarily invalid — use last known dist
    this._log(`📏 finalDist=${finalDist.toFixed(2)}`);
    if (finalDist > 3.5) {
      this._log(`⚠️ finalDist=${finalDist.toFixed(2)} > 3.5 — цель ушла пока смотрели`);
      try { bot.setControlState('forward', true); } catch {}
      return;
    }

    // FIX: КРИТ — каждый 2-й удар (1 крит, 1 обычный)
    const doCrit = bot.entity.onGround && (this._hitCount % 2 === 0) && finalDist < 3.0;
    this._log(`🎯 АТАКУЕМ! hitCount=${this._hitCount} doCrit=${doCrit} onGround=${bot.entity.onGround}`);

    if (doCrit) {
      try { bot.setControlState('jump', true); } catch {}
      // Ждём отрыва от земли (макс 350мс — защита от вечного ожидания)
      let waited = 0;
      while (bot.entity.onGround && waited < 350) { await sleep(20); waited += 20; }
      try { bot.setControlState('jump', false); } catch {}

      // Ждём пик прыжка (~130мс от отрыва)
      await sleep(130 + rand(0, 20));

      // FIX: прицел на ТЕЛО цели (y+1.0 = центр тела), НЕ на голову и не в небо
      // Во время прыжка бот выше → pitch автоматически смотрит ВНИЗ на тело
      const freshTarget = this._target;
      if (freshTarget?.position) {
        const cp    = bot.entity.position;
        const ftpos = freshTarget.position;
        const ndx   = ftpos.x - cp.x;
        const ndz   = ftpos.z - cp.z;
        const nd2d  = Math.max(Math.sqrt(ndx*ndx + ndz*ndz), 0.01);
        // Прицел на центр тела (y+1.0), не на голову (y+1.8) и не в воздух
        const aimBodyY = ftpos.y + 1.0;
        const newYaw   = Math.atan2(-ndx, -ndz);
        // pitch > 0 = смотреть вниз; Clamp чтобы никогда не смотреть вверх
        const rawPitch = -Math.atan2(aimBodyY - (cp.y + 1.62), nd2d);
        const newPitch = Math.max(rawPitch, 0.10); // минимум 0.10 = всегда вниз
        try { await bot.look(newYaw, newPitch, true); } catch {}
      }
      await sleep(20);

      // FIX: защита от зависания — если всё ещё в воздухе, ждём приземления (макс 400мс)
      let airWait = 0;
      while (!bot.entity.onGround && airWait < 400) { await sleep(20); airWait += 20; }
      if (!bot.entity.onGround) {
        // Не приземлились — принудительно сбрасываем прыжок и пропускаем крит
        try { bot.setControlState('jump', false); } catch {}
        this._log('⚠️ Завис в воздухе — пропускаем крит, ждём земли');
        return;
      }

      // Проверяем дистанцию снова после прыжка
      const _checkPos = this._target?.position ?? this._lastKnownTargetPos;
      if (this._target && _checkPos && bot.entity.position.distanceTo(_checkPos) > 3.8) {
        this._log('⚠️ Цель убежала во время прыжка — отменяем удар');
        return;
      }
    }

    // АТАКА
    try {
      bot.attack(target);
      this._lastAttackMs = Date.now();
      this._attackCount++;
      this._hitCount++;
      if (doCrit) {
        this._critCount++;
        this._log(`💥 КРИТ #${this._critCount} | атак=${this._attackCount}`);
      } else {
        this._log(`🗡 Удар #${this._attackCount} обычный`);
      }
      // W-TAP + боковой шаг (сайдстеп) при каждом ударе — бот не стоит столбом
      try { bot.setControlState('forward', false); } catch {}
      const _tapStDir = this._hitCount % 2 === 0;
      try { bot.setControlState('left',  _tapStDir);  } catch {}
      try { bot.setControlState('right', !_tapStDir); } catch {}
      await sleep(50 + rand(0, 30));
      try { bot.setControlState('left',  false); } catch {}
      try { bot.setControlState('right', false); } catch {}
      if (this._running && this._target) {
        const aftD = bot.entity?.position?.distanceTo(this._target.position) ?? 0;
        if (aftD > 2) { try { bot.setControlState('forward', true); } catch {} }
      }
    } catch (err) {
      log.debug('[PvpController] attack:', err.message);
    }
    if (doCrit) { await sleep(180 + rand(0,40)); }
  }

  // ── HP-ЛОГИКА ЕДЫ (во время боя) ─────────────────────────────────────────
  _shouldEat(hp, food) {
    // Схема юзера: HP≤10 → если голоден (food<18) ешь еду → всегда гапл
    //              HP≤10 → если сыт (food≥18) → сразу гапл
    if (hp <= 10) {
      if (food < 18) return "food_then_gapple";   // сначала еда, потом гапл
      return "gapple";                             // сразу гапл
    }
    return null; // выше 10HP — не едим, продолжаем биться
  }

  // FIX: Еда без цели (вне боя)
  _shouldEatNoCombat(hp, food) {
    if (hp <= 14) return "gapple_if_have";
    if (hp < 20 && food < 16) return "regular";
    if (food < 12) return "regular";
    return null;
  }

  async _doEatSmart(bot, mode) {
    this._isDoingAction = true;
    this._isEating = true;   // FIX: отдельный флаг
    this._actionStartedAt = Date.now();
    try {
      try { bot.setControlState("forward", false); bot.setControlState("sprint", false); } catch {}
      if (!this._target) {
        // Вне боя — можем отойти назад
        try { bot.setControlState("back", true); } catch {}
      }
      await sleep(60 + rand(0, 40));

      if (mode === "gapple") {
        await this._eatBestGapple(bot);
      } else if (mode === "food_then_gapple") {
        // Схема юзера: сначала обычная еда (мясо/морковь/etc), ПОТОМ гапл
        const regularFood = this._selectRegularFood(bot);
        if (regularFood) {
          await this._eatItem(bot, regularFood);
          await sleep(80 + rand(0, 40)); // небольшая пауза между едой и гаплом
        }
        await this._eatBestGapple(bot); // гапл всегда, независимо от HP
      } else if (mode === "gapple_if_have") {
        const had = await this._eatBestGapple(bot);
        if (!had) { const food = this._selectRegularFood(bot); if (food) await this._eatItem(bot, food); }
      } else if (mode === "regular_then_gapple") {
        const food = this._selectRegularFood(bot);
        if (food) await this._eatItem(bot, food);
        await sleep(100);
        await this._eatBestGapple(bot);
      } else {
        const food = this._selectRegularFood(bot);
        if (food) await this._eatItem(bot, food);
      }
      try { bot.setControlState("back", false); } catch {}
    } finally {
      this._isEating      = false;
      this._isDoingAction = false;
      this._forceAttack   = 15;  // 15 тиков × 80мс = 1.2с боя после еды
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

  // ── ЭКСТРЕННОЕ ЛЕЧЕНИЕ ────────────────────────────────────────────────────
  async _emergency(bot) {
    const healed = await this._tryHealPotion(bot);
    if (healed) return true;
    return await this._eatBestGapple(bot);
  }

  async _tryHealPotion(bot) {
    const p = bot.inventory.items().find(i => HEAL_POTION.some(k => i.name.toLowerCase().includes(k)));
    if (!p) return false;
    await this._applyPotionOnSelf(bot, p);
    return true;
  }

  async _tryBuffPotion(bot) {
    const p = bot.inventory.items().find(i => BUFF_POTION.some(k => i.name.toLowerCase().includes(k)));
    if (!p) return;
    await this._applyPotionOnSelf(bot, p);
  }

  // FIX: _autoBuffPotions — был краш (метод не существовал)
  async _autoBuffPotions(bot) {
    if (this._isDoingAction || this._isEating || !this._target) return;
    const hp = bot.health ?? 20;
    if (hp < 12) return;

    const items = bot.inventory.items();
    if (!items.length) return;

    // effectId → keyword (Minecraft vanilla effect IDs)
    const EFFECT_MAP = {
      1:  'speed',
      5:  'strength',
      3:  'haste',
      8:  'jump',
      11: 'resistance',
      12: 'fire_resistance',
      22: 'absorption',
    };

    const enemyEffects = this._target.effects || {};
    const myEffects    = bot.entity?.effects || {};

    // 1. Match enemy buffs — use same type, prefer same strength
    for (const [idStr, keyword] of Object.entries(EFFECT_MAP)) {
      const eid = Number(idStr);
      const enemyFx = enemyEffects[eid];
      const myFx    = myEffects[eid];
      if (!enemyFx) continue;
      const enemyAmp = enemyFx.amplifier ?? 0;
      if (myFx && (myFx.amplifier ?? 0) >= enemyAmp) continue;

      const candidates = items.filter(i => i.name.toLowerCase().includes(keyword));
      if (!candidates.length) continue;
      const strong = enemyAmp >= 1
        ? candidates.find(i => { const n = i.name.toLowerCase(); return n.includes('strong') || n.includes('_ii'); })
        : null;
      const chosen = strong || candidates[0];
      this._log(`🧪 Матчим бафф врага: ${keyword} (ур.${enemyAmp+1}) → ${chosen.name}`);
      await this._applyPotionOnSelf(bot, chosen);
      return;
    }

    // 2. General buff if we have no active buff effects
    const hasAnyBuff = Object.keys(myEffects).some(id => EFFECT_MAP[Number(id)] !== undefined);
    if (hasAnyBuff) return;

    const buff = items.find(i => BUFF_POTION.some(k => i.name.toLowerCase().includes(k)));
    if (!buff) return;
    this._log(`🧪 Бафф (нет активных эффектов): ${buff.name}`);
    await this._applyPotionOnSelf(bot, buff);
  }

  // FIX: различаем splash (бросок вверх) vs обычное зелье (drink = consume)
  async _applyPotionOnSelf(bot, potion) {
    if (this._isDoingAction || this._isEating) return;
    this._isDoingAction = true;
    this._actionStartedAt = Date.now();
    try {
      try { bot.setControlState("forward", false); bot.setControlState("sprint", false); } catch {}
      await sleep(60 + rand(0, 40));
      await bot.equip(potion, "hand");
      await sleep(50 + rand(0, 30));

      const name = potion.name.toLowerCase();
      const isSplash = name.includes('splash') || name.includes('lingering');

      if (isSplash) {
        // Бросаем вверх на себя (падает на нас)
        const curYaw = bot.entity?.yaw ?? 0;
        try { await bot.look(curYaw, -Math.PI * 0.42, false); } catch {}
        await sleep(40);
        bot.activateItem();
        this._addChat("💊 Зелье (бросок)!", "system");
      } else {
        // Обычное зелье — пьём
        await bot.consume();
        this._addChat("💊 Зелье (выпито)!", "system");
      }
      this._forceAttack = 3;
    } catch (err) {
      log.debug("[PvpController] applyPotion:", err.message);
    } finally {
      this._isDoingAction = false;
    }
  }

  async _doSplashPotion(bot, type, potion) {
    if (this._isDoingAction || this._isEating) return;
    this._isDoingAction = true;
    this._actionStartedAt = Date.now();
    try {
      try { bot.setControlState("forward", false); bot.setControlState("sprint", false); } catch {}
      await sleep(80 + rand(0, 50));
      await bot.equip(potion, "hand");
      await sleep(60 + rand(0, 40));

      if (type === "heal" || type === "buff") {
        await this._applyPotionOnSelf(bot, potion);
        return; // applyPotionOnSelf сам управляет _isDoingAction
      } else {
        // На врага
        if (this._target?.position && bot.entity) {
          const dx  = this._target.position.x - bot.entity.position.x;
          const dz  = this._target.position.z - bot.entity.position.z;
          const yaw = Math.atan2(-dx, -dz);
          try { await bot.look(yaw, -0.4, false); } catch {}
          await sleep(50);
          bot.activateItem();
          this._addChat("☠️ Дебаф!", "system");
        }
        this._forceAttack = 3;
      }
    } catch (err) {
      log.debug("[PvpController] splashPotion:", err.message);
    } finally {
      this._isDoingAction = false;
    }
  }

  async _tryDebuffPotion(bot) {
    if (!this._target || this._isDoingAction || this._isEating) return;
    const cfg = this.instance.config || {};
    if (cfg.useSplashPotions === false) return;
    const _dpPos = this._target?.position ?? this._lastKnownTargetPos;
    if (!_dpPos) return;
    const dist = bot.entity.position.distanceTo(_dpPos);
    if (dist > 6) return;
    const items = bot.inventory.items();
    const debuff = items.find(i => {
      const n = i.name.toLowerCase();
      return (n.includes('splash') || n.includes('lingering')) &&
             (n.includes('instant_damage') || n.includes('harming') ||
              n.includes('poison') || n.includes('weakness') || n.includes('slowness'));
    });
    if (!debuff) return;
    await this._doSplashPotion(bot, 'debuff', debuff);
  }

  // ── СЛЕДОВАНИЕ ЗА ТИМЕЙТОМ (когда нет цели) ────────────────────────────
  async _followTeammate(bot) {
    if (!bot?.entity) return;
    try {
      // Ищем ближайшего тимейта в зоне видимости
      let nearestTeam = null;
      let minD = 100;
      for (const e of Object.values(bot.entities || {})) {
        if (!e?.position || e === bot.entity || e.type !== 'player') continue;
        const uname = typeof e.username === 'string' ? e.username.toLowerCase() : null;
        if (!uname) continue;
        if (!this._teammates.has(uname)) continue; // только тимейты
        const d = bot.entity.position.distanceTo(e.position);
        if (d < minD) { minD = d; nearestTeam = e; }
      }

      if (!nearestTeam) {
        // Тимейтов нет рядом — стоим
        try { bot.pathfinder?.stop(); } catch {}
        try { bot.setControlState('forward', false); bot.setControlState('sprint', false); } catch {}
        return;
      }

      if (minD < 4) {
        // Уже рядом — стоим
        try { bot.pathfinder?.stop(); } catch {}
        try { bot.setControlState('forward', false); bot.setControlState('sprint', false); } catch {}
        return;
      }

      // Идём к тимейту
      try {
        const { goals } = require('mineflayer-pathfinder');
        const tpos = nearestTeam.position;
        if (!this._followGoalPos || this._followGoalPos.distanceTo(tpos) > 3) {
          this._followGoalPos = tpos.clone();
          bot.pathfinder.setGoal(new goals.GoalNear(tpos.x, tpos.y, tpos.z, 2.5), false);
        }
      } catch {
        // Фоллбэк: прямой контроль
        const tpos = nearestTeam.position;
        const dx = tpos.x - bot.entity.position.x;
        const dz = tpos.z - bot.entity.position.z;
        const yaw = Math.atan2(-dx, -dz);
        try { await bot.look(yaw, 0, false); } catch {}
        try { bot.setControlState('forward', true); bot.setControlState('sprint', minD > 8); } catch {}
      }
    } catch (err) {
      log.debug('[PvpController] followTeammate:', err.message);
    }
  }

  // ── ПОИСК ЦЕЛИ ────────────────────────────────────────────────────────────
  // ПРАВИЛО: никогда не ставим closest = entity с position===null,
  // иначе _tick падает в distanceTo(null) и бот молча перестаёт бить.
  _findTarget() {
    const { bot } = this.instance;
    if (!bot?.entity) { this._target = null; return; }
    let closest = null, minDist = 80;
    const myPos = bot.entity.position;
    const botName = (bot.username || '').toLowerCase();
  // DEBUG: log player/entity counts every 10 ticks in _findTarget
  if (this._tickCount % 10 === 0) {
    const _pK  = Object.keys(bot.players || {});
    const _pWE = _pK.filter(k => bot.players[k]?.entity).length;
    const _eC  = Object.keys(bot.entities || {}).length;
    this._log('[SCAN] findTarget: players=' + _pK.length + '(ent=' + _pWE + ') entities=' + _eC);
  }

    // ── ПРИОРИТЕТ 1: bot.players ──────────────────────────────────────────
    for (const [pKey, pInfo] of Object.entries(bot.players || {})) {
      if (!pInfo?.entity) continue;
      const uname = (typeof pInfo.username === 'string' ? pInfo.username : pKey).toLowerCase();
      if (uname === botName || this._teammates.has(uname)) continue;
      const e = pInfo.entity;
      if (e === bot.entity) continue;

      if (!e.position) {
        // position временно null (~80мс после удара) — продлеваем sticky и пропускаем
        if (uname === this._lastTargetName) this._stickyTargetTs = Date.now();
        continue; // ← НЕ ставим closest=e: null position → crash
      }

      let d;
      try { d = myPos.distanceTo(e.position); } catch { continue; }
      if (isNaN(d) || d >= minDist) continue;
      minDist = d; closest = e;
    }

    // FIX ПРИОРИТЕТ 2: bot.entities — мобы + игроки которых нет в bot.players
    // pInfo.entity бывает null даже когда игрок физически виден (mineflayer timing race)
    const foundInPlayers = new Set();
    for (const [, pInfo] of Object.entries(bot.players || {})) {
      if (pInfo?.entity) {
        const u = (typeof pInfo.username === 'string' ? pInfo.username : '').toLowerCase();
        if (u) foundInPlayers.add(u);
      }
    }
    for (const e of Object.values(bot.entities || {})) {
      if (!e?.position || e === bot.entity) continue;
      const hasUsername = typeof e.username === 'string' && e.username.length > 0;
      if (hasUsername) {
        // FIX: берём игрока из entities только если НЕ нашли его в bot.players
        const uname = e.username.toLowerCase();
        if (uname === botName || this._teammates.has(uname)) continue;
        if (foundInPlayers.has(uname)) continue;
        this._log('[FIX] player in entities not in players: ' + e.username);
      } else {
        const isMob = e.type === 'mob' || e.type === 'hostile';
        if (!isMob || e.isValid === false) continue;
      }
      let d;
      try { d = myPos.distanceTo(e.position); } catch { continue; }
      if (isNaN(d) || d >= minDist) continue;
      minDist = d; closest = e;
    }

    // ── Sticky: держим цель 8 сек по ИМЕНИ ─────────────────────────────────────
    // ПРОБЛЕМА: после bot.attack() Mineflayer временно убирает entity из bot.players[name]
    // (entity = undefined, не null). Старый sticky-код падал в else if (stickyAge < 2000)
    // и терял цель через 2 сек. Новый код:
    //   1. Ищет свежую ссылку в bot.players (case-insensitive)
    //   2. Если не нашёл в players — сканирует bot.entities напрямую по username
    //   3. Если нашёл entity без position — возвращает его (_tick использует lastKnownTargetPos)
    //   4. Если совсем ничего — держит _stickyTarget до 8 сек (не 2!)
    if (!closest && this._lastTargetName) {
      const stickyAge = Date.now() - (this._stickyTargetTs || 0);
      if (stickyAge < 8000) {
        // Шаг 1: ищем в bot.players (case-insensitive по username)
        let freshEntity = null;
        const players = bot.players || {};
        for (const [pKey, pInfo] of Object.entries(players)) {
          const uname = (typeof pInfo?.username === 'string' ? pInfo.username : pKey).toLowerCase();
          if (uname !== this._lastTargetName) continue;
          if (pInfo?.entity) { freshEntity = pInfo.entity; break; }
        }

        // Шаг 2: не нашли в players — сканируем bot.entities напрямую по username
        // КЛЮЧЕВОЙ ФИX: после knockback entity может исчезнуть из bot.players,
        // но остаться в bot.entities с валидной позицией!
        if (!freshEntity) {
          for (const e of Object.values(bot.entities || {})) {
            if (!e || e === bot.entity) continue;
            if (typeof e.username !== 'string') continue;
            if (e.username.toLowerCase() !== this._lastTargetName) continue;
            freshEntity = e;
            break;
          }
        }

        if (freshEntity) {
          this._stickyTarget = freshEntity;
          if (freshEntity.position) {
            let d;
            try { d = myPos.distanceTo(freshEntity.position); } catch {}
            if (!isNaN(d) && d < 40) {
              closest = freshEntity;
              if (stickyAge > 200) this._log('🕯 Sticky[recover] ' + Math.round(stickyAge) + 'мс → ' + this._lastTargetName);
            }
          } else {
            // Entity найден но position==null — передаём в _tick, там lastKnownTargetPos
            closest = freshEntity;
            this._log('🕯 Sticky[pos=null] ' + Math.round(stickyAge) + 'мс — ждём позицию');
          }
        } else if (this._stickyTarget) {
          // Нигде не нашли entity — используем стale-ссылку (8 сек, не 2!)
          closest = this._stickyTarget;
          this._log('🕯 Sticky[stale] ' + Math.round(stickyAge) + 'мс — ' + this._lastTargetName);
        }
      } else {
        // Sticky истёк (8 сек) — сбрасываем
        this._log('🕯 Sticky истёк (' + Math.round(stickyAge/1000) + 'с) — цель сброшена');
        this._lastTargetName = null;
        this._stickyTarget = null;
      }
    }

    if (closest) {
      const uname = typeof closest.username === 'string' ? closest.username.toLowerCase() : null;
      if (uname) this._lastTargetName = uname;
      this._stickyTarget    = closest;
      this._stickyTargetTs  = Date.now();
      this._targetLostAt    = 0;
    } else if (this._target && !this._targetLostAt) {
      this._targetLostAt = Date.now();
    }
    this._target = closest;
  }

  _scanNearby80() {
    const { bot } = this.instance;
    if (!bot?.entity || this._tickCount % 5 !== 0) return;
    const detected = [];
    const botPos = bot.entity.position;
    const botYaw = bot.entity.yaw;
    for (const e of Object.values(bot.entities || {})) {
      if (!e?.position || e === bot.entity || e.type !== "player") continue;
      const uname = typeof e.username === "string" ? e.username.toLowerCase() : null;
      if (uname && this._teammates.has(uname)) continue;
      if (uname && uname === (bot.username || "").toLowerCase()) continue;
      const d = botPos.distanceTo(e.position);
      if (d > 80) continue;
      const dx = e.position.x - botPos.x;
      const dz = e.position.z - botPos.z;
      const angleToTarget = Math.atan2(-dx, -dz);
      let angleDiff = Math.abs(angleToTarget - botYaw) % (2 * Math.PI);
      if (angleDiff > Math.PI) angleDiff = 2 * Math.PI - angleDiff;
      const inFOV = angleDiff < Math.PI * 0.5;
      if (inFOV || d < 16) detected.push({ username: e.username, distance: Math.round(d), inFOV });
    }
    if (detected.length > 0) {
      this._detectedPlayers = detected;
      this.emit("bot:pvpDetected", { botId: this.instance.id, players: detected });
    }
  }

  // Онлайн-обучение: бот учится на своих ошибках в реальном времени.
  // Каждые 5 тиков (~400мс) сравниваем HP тогда и сейчас — если упало, действие было плохим.
  _trainBrain(bot, hp) {
    if (!this._target || this._tickCount % 5 !== 0) return;
    try {
      const features = this.brain._getFeatures?.(bot, this._target, [...this._teammates]);
      if (!features) return;
      const curHp  = bot.health ?? 20;
      const hpDrop = this._lastHP - curHp;
      const wasGood = hpDrop < 1.0; // потеря < 1 HP = действие нейтральное/хорошее

      let actionMap;
      if (hpDrop >= 2.0) {
        actionMap = { retreat: true }; // получили сильный урон — надо было отступить
      } else if (this._hitCount > 0 && hpDrop < 0.5) {
        actionMap = { attack: true };  // ударили без потерь — продолжаем атаковать
      } else if (this._tickCount % 2 === 0) {
        actionMap = { strafe: true };  // нейтрально — учим страфингу
      } else {
        actionMap = { attack: true };
      }

      this.brain.recordExperience(features, actionMap, wasGood);
    } catch {}
    this._lastHP = hp;
  }

  _addChat(msg) {
    this.emit('bot:actionLog', { botId: this.instance.id, logType: 'pvp', msg: String(msg) });
  }

  isRunning()   { return this._running; }
  getTarget()   { return this._target?.username || null; }
  getStats()    { return { attacks: this._attackCount, crits: this._critCount, hits: this._hitCount }; }
}

module.exports = { PvpController };
