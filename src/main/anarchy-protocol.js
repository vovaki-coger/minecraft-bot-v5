/**
 * AnarchyProtocol v2 — расширенный протокол анархии с нейросетью AnarchyBrain.
 *
 * Цикл:
 *  1. AnarchyBrain выбирает поведение (14 вариантов) или задача задана вручную
 *  2. Выполняет задачу через taskManager
 *  3. Когда инвентарь полон (>28 стаков) ИЛИ прошло N минут → идёт на базу (/home)
 *  4. На базе: складывает ресурсы, берёт еду и инструменты
 *  5. Повторяет
 */

const { goals } = require("mineflayer-pathfinder");
const log = require("electron-log");
const { AnarchyBrain } = require("./anarchy-brain");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Предметы которые НЕ сдаём на базе
const KEEP_ITEMS = new Set([
  "iron_sword","diamond_sword","netherite_sword","stone_sword","wooden_sword",
  "iron_pickaxe","diamond_pickaxe","netherite_pickaxe","stone_pickaxe","wooden_pickaxe",
  "iron_axe","diamond_axe","netherite_axe","stone_axe","wooden_axe",
  "iron_shovel","diamond_shovel","netherite_shovel","stone_shovel","wooden_shovel",
  "iron_helmet","diamond_helmet","netherite_helmet","iron_chestplate","diamond_chestplate",
  "netherite_chestplate","iron_leggings","diamond_leggings","netherite_leggings",
  "iron_boots","diamond_boots","netherite_boots",
  "elytra","shield","bow","crossbow","trident",
  "torch","crafting_table","furnace","fishing_rod",
]);

const FOOD_ITEMS = [
  "cooked_beef","cooked_porkchop","cooked_chicken","cooked_mutton",
  "cooked_salmon","cooked_cod","bread","golden_apple","enchanted_golden_apple",
  "golden_carrot","cooked_rabbit","mushroom_stew","suspicious_stew",
  "apple","carrot","baked_potato","dried_kelp",
];

class AnarchyProtocol {
  constructor(instance, ollamaManager, emit) {
    this.instance = instance;
    this.ollamaManager = ollamaManager;
    this.emit = emit;
    this.isRunning = false;
    this._task = "";
    this._homeCommand = "/home";
    this._rtpCommand = "";
    this._cycleMinutes = 5;
    this._maxInventorySlots = 28;
    this._loop = null;
    this._phase = "idle";
    this._cycleCount = 0;
    this._log = [];
    this._brain = null;
    this._useBrain = false;  // true когда задача = "auto" (режим авто-выбора)
    this._lastBrainAction = null;
  }

  get bot() { return this.instance.bot; }

  // ── Запуск ──────────────────────────────────────────────────────────

  async start({ task, homeCommand = "/home", rtpCommand = "", cycleMinutes = 5, maxInventory = 28 }) {
    if (this.isRunning) await this.stop();
    this._task = task;
    this._homeCommand = homeCommand;
    this._rtpCommand = rtpCommand;
    this._cycleMinutes = cycleMinutes;
    this._maxInventorySlots = maxInventory;
    this.isRunning = true;
    this._cycleCount = 0;
    this._log = [];

    // Авто-режим (нейросеть выбирает что делать)
    this._useBrain = !task || task.toLowerCase() === "auto" || task.toLowerCase() === "авто";

    // Инициализируем мозг анархии
    if (!this._brain) {
      this._brain = new AnarchyBrain();
      this._brain._onProgress = (pct, msg) => {
        this.emit("bot:anarchyBrainTraining", { botId: this.instance.id, pct, msg });
        this._addLog(`🧠 Обучение мозга: ${pct}% — ${msg}`);
      };
      this._brain._onReady = () => {
        this._addLog("✅ Мозг анархии обучен! Все 14 поведений активны.");
        this.emit("bot:anarchyBrainReady", { botId: this.instance.id });
      };
    }

    this._addLog(`🏴 Протокол анархии v2 запущен. ${this._useBrain ? "Режим: АВТО (нейросеть)" : `Задача: "${task}"`}`);
    this._addLog(`🏠 База: ${homeCommand} | Цикл: ${cycleMinutes} мин | Мозг: ${this._brain.ready ? "готов" : "обучается..."}`);
    this.emit("bot:anarchyStarted", { botId: this.instance.id, task, homeCommand });

    this._runLoop();
  }

  stop() {
    // Останавливаем текущую задачу taskManager
    try {
      const tm = this.instance?.taskManager;
      if (tm && tm._running) tm.stop();
    } catch {}
    // Останавливаем pathfinder
    try { const bot = this.instance?.bot; if (bot?.pathfinder) bot.pathfinder.stop(); } catch {}
    this.isRunning = false;
    this._phase = "idle";
    if (this._loop) { clearTimeout(this._loop); this._loop = null; }
    this._addLog("🛑 Протокол анархии остановлен");
    this.emit("bot:anarchyStopped", { botId: this.instance.id });
    log.info("[Anarchy] Stopped");
  }

  getState() {
    return {
      isRunning: this.isRunning,
      task: this._task,
      homeCommand: this._homeCommand,
      rtpCommand: this._rtpCommand,
      phase: this._phase,
      cycleCount: this._cycleCount,
      brainReady: this._brain?.ready || false,
      lastBrainAction: this._lastBrainAction,
      log: this._log.slice(-50),
    };
  }

  // ── Главный цикл ────────────────────────────────────────────────────

  async _runLoop() {
    while (this.isRunning) {
      try {
        await this._doTaskPhase();
        if (!this.isRunning) break;
        await this._goHomeAndDeposit();
        if (!this.isRunning) break;
        this._cycleCount++;
        this._addLog(`✅ Цикл ${this._cycleCount} завершён. Возобновляю...`);
      } catch (err) {
        log.error("[Anarchy] Loop error:", err.message);
        this._addLog(`⚠️ Ошибка: ${err.message}. Продолжаю...`);
        await sleep(5000);
      }
    }
  }

  // ── Фаза выполнения задачи ───────────────────────────────────────────

  async _doTaskPhase() {
    this._setPhase("task");
    const bot = this.bot;
    if (!bot?.entity) { await sleep(3000); return; }

    const startTime = Date.now();
    const maxMs = this._cycleMinutes * 60 * 1000;
    const tm = this.instance.taskManager;

    // Определяем задачу: вручную или через мозг
    let parsedTask = this._useBrain ? null : this._parseAnarchyTask(this._task);

    while (this.isRunning && (Date.now() - startTime) < maxMs) {
      const items = bot.inventory?.items() || [];
      if (items.length >= this._maxInventorySlots) {
        this._addLog(`📦 Инвентарь заполнен (${items.length}/${this._maxInventorySlots}). Иду на базу!`);
        return;
      }

      const elapsed = Math.round((Date.now() - startTime) / 1000);
      const remaining = Math.round(this._cycleMinutes * 60 - elapsed);

      // Авто-режим: спрашиваем мозг что делать
      if (this._useBrain && this._brain) {
        const features = this._getBotFeatures();
        const decision = this._brain.decide(features);
        this._lastBrainAction = decision.action;
        parsedTask = this._brain.actionToTask(decision.action, {});

        if (parsedTask) {
          this._addLog(`🧠 Мозг: ${decision.action} (${Math.round(decision.confidence*100)}%) | ${elapsed}с прошло, ${remaining}с осталось`);
        } else if (decision.action === "go_home") {
          this._addLog("🏠 Мозг: идём домой (инвентарь/голод)");
          return;
        } else {
          this._addLog(`🧠 Мозг: ${decision.action} — нет обработчика, жду...`);
          await sleep(8000);
          continue;
        }
      } else {
        this._addLog(`▶️ Задача: ${this._task} (${elapsed}с, ${remaining}с осталось, инв: ${items.length}/${this._maxInventorySlots})`);
      }

      if (parsedTask && tm) {
        await tm.runTask(parsedTask.name, parsedTask.args).catch(err => {
          this._addLog(`⚠️ Задача завершилась: ${err?.message || 'готово'}`);
          // Запоминаем опыт (не повезло)
          if (this._useBrain && this._lastBrainAction) {
            try { this._brain.recordExperience(this._getBotFeatures(), this._lastBrainAction, false); } catch {}
          }
        });
        // Положительный опыт после успешной задачи
        if (this._useBrain && this._lastBrainAction) {
          try { this._brain.recordExperience(this._getBotFeatures(), this._lastBrainAction, true); } catch {}
        }
        await sleep(2000);
      } else {
        this._addLog('Задача не распознана. Укажите задачу из списка или используйте режим "авто".');
        await sleep(30000);
      }
    }

    this._addLog(`⏱️ Время вышло (${this._cycleMinutes} мин). Иду домой.`);
  }

  // ── Сбор признаков бота для мозга ────────────────────────────────────

  _getBotFeatures() {
    const bot = this.bot;
    if (!bot?.entity) return new Array(12).fill(0.5);
    const clamp = (v,lo,hi) => Math.max(lo,Math.min(hi,v));

    const items = bot.inventory?.items() || [];
    const hasTool = items.some(i => /pickaxe|axe|shovel/.test(i.name)) ? 1 : 0;
    const hasFood = items.some(i => FOOD_ITEMS.includes(i.name)) ? 1 : 0;
    const hasSeeds = items.some(i => /wheat_seeds|carrot|potato|beetroot/.test(i.name)) ? 1 : 0;
    const invFull = clamp(items.length / 36, 0, 1);

    const hp = clamp((bot.health || 20) / 20, 0, 1);
    const hunger = clamp((bot.food || 20) / 20, 0, 1);

    // Враги поблизости
    const enemies = Object.values(bot.entities || {}).filter(e =>
      e.position && (e.type === "mob" || (e.type === "player" && e.username !== bot.username)) &&
      e.position.distanceTo(bot.entity.position) < 12
    ).length;
    const enemiesNorm = clamp(enemies / 5, 0, 1);

    // Время суток (0=ночь, 1=день)
    const timeRaw = bot.time?.timeOfDay ?? 6000;
    const timeDay = clamp(1 - Math.abs((timeRaw % 24000) - 6000) / 12000, 0, 1);

    // Ближний сундук
    let nearChest = 0;
    try {
      const mcData = require("minecraft-data")(bot.version);
      const chestId = mcData.blocksByName["chest"]?.id;
      const found = chestId ? bot.findBlock({ matching: chestId, maxDistance: 12 }) : null;
      nearChest = found ? 1 : 0;
    } catch {}

    // Природа (деревья/трава)
    let nearNature = 0;
    try {
      const mcData = require("minecraft-data")(bot.version);
      const logIds = ["oak_log","birch_log","spruce_log","jungle_log","acacia_log","dark_oak_log"]
        .map(n => mcData.blocksByName[n]?.id).filter(Boolean);
      const log_ = logIds.length ? bot.findBlock({ matching: b => logIds.includes(b.type), maxDistance: 15 }) : null;
      nearNature = log_ ? clamp(1 - log_.position.distanceTo(bot.entity.position) / 15, 0, 1) : 0;
    } catch {}

    // Ближние посевы
    let nearCrops = 0;
    try {
      const mcData = require("minecraft-data")(bot.version);
      const cropIds = ["wheat","carrots","potatoes"].map(n => mcData.blocksByName[n]?.id).filter(Boolean);
      const crop_ = cropIds.length ? bot.findBlock({ matching: b => cropIds.includes(b.type), maxDistance: 15 }) : null;
      nearCrops = crop_ ? clamp(1 - crop_.position.distanceTo(bot.entity.position) / 15, 0, 1) : 0;
    } catch {}

    // Дистанция до ближайшей интересной цели
    const dist = clamp(Math.min(nearNature, nearCrops) > 0 ? 0.1 : 0.5, 0, 1);

    return [dist, hunger, invFull, hasTool, hasFood, hasSeeds, enemiesNorm, timeDay, nearChest, nearNature, nearCrops, hp];
  }

  // ── Фаза возврата на базу ────────────────────────────────────────────

  async _goHomeAndDeposit() {
    const bot = this.bot;
    if (!bot?.entity) return;

    this._setPhase("going_home");
    this._addLog(`🏠 Иду домой: ${this._homeCommand}`);

    try { bot.pathfinder.stop(); } catch {}
    await sleep(500);

    bot.chat(this._homeCommand);

    const posBefore = bot.entity.position.clone();
    let teleported = false;
    for (let i = 0; i < 20; i++) {
      await sleep(500);
      if (!bot.entity) break;
      const dist = bot.entity.position.distanceTo(posBefore);
      if (dist > 5) { teleported = true; break; }
    }

    if (!teleported) {
      this._addLog(`⚠️ Телепортация не сработала. Продолжаю без базы.`);
      return;
    }

    this._addLog(`✅ Прибыл на базу!`);
    await sleep(2000);

    this._setPhase("depositing");
    await this._depositToChest();
    await this._takeSupplies();

    this._addLog(`✅ База готова. Возвращаюсь к задаче.`);
    this._setPhase("resuming");

    if (this._rtpCommand && bot?.entity) {
      this._addLog(`🌐 RTP: ${this._rtpCommand}`);
      bot.chat(this._rtpCommand);
      await sleep(6000);
    }

    await sleep(1000);
  }

  // ── Сдать ресурсы в сундук ────────────────────────────────────────────

  async _depositToChest() {
    const bot = this.bot;
    const mcData = require("minecraft-data")(bot.version);
    const chestIds = ["chest","barrel","hopper"].map(n => mcData.blocksByName[n]?.id).filter(Boolean);
    const chestBlock = bot.findBlock({ matching: b => chestIds.includes(b.type), maxDistance: 20 });

    if (!chestBlock) { this._addLog(`⚠️ Сундук не найден рядом с базой`); return; }

    try {
      await bot.pathfinder.goto(new goals.GoalNear(chestBlock.position.x, chestBlock.position.y, chestBlock.position.z, 2));
    } catch {}

    try {
      const chest = await bot.openContainer(chestBlock);
      await sleep(300);
      const items = bot.inventory.items();
      let deposited = 0;
      for (const item of items) {
        if (KEEP_ITEMS.has(item.name)) continue;
        if (FOOD_ITEMS.includes(item.name) && item.count <= 8) continue;
        try { await chest.deposit(item.type, null, item.count); deposited++; await sleep(100); } catch {}
      }
      await bot.closeWindow(chest);
      this._addLog(`📦 Сдал ${deposited} видов предметов`);
    } catch (err) { this._addLog(`⚠️ Ошибка при сдаче: ${err.message}`); }
  }

  // ── Взять провизию из сундука ─────────────────────────────────────────

  async _takeSupplies() {
    const bot = this.bot;
    const mcData = require("minecraft-data")(bot.version);
    const chestIds = ["chest","barrel"].map(n => mcData.blocksByName[n]?.id).filter(Boolean);
    const chestBlock = bot.findBlock({ matching: b => chestIds.includes(b.type), maxDistance: 20 });
    if (!chestBlock) return;

    try {
      await bot.pathfinder.goto(new goals.GoalNear(chestBlock.position.x, chestBlock.position.y, chestBlock.position.z, 2));
      const chest = await bot.openContainer(chestBlock);
      await sleep(300);
      const chestItems = chest.containerItems() || [];
      let took = 0;
      for (const item of chestItems) {
        if (!FOOD_ITEMS.includes(item.name)) continue;
        const inInv = bot.inventory.items().find(i => i.name === item.name);
        const have = inInv?.count || 0;
        if (have >= 16) continue;
        const toTake = Math.min(32 - have, item.count);
        if (toTake <= 0) continue;
        try { await chest.withdraw(item.type, null, toTake); took++; await sleep(100); } catch {}
      }
      await bot.closeWindow(chest);
      if (took > 0) this._addLog(`🍖 Взял ${took} видов еды`);
    } catch (err) { this._addLog(`⚠️ Ошибка при взятии: ${err.message}`); }
  }

  // ── Парсинг задачи в команду taskManager (20+ поведений) ─────────────

  _parseAnarchyTask(task) {
    if (!task) return null;
    const t = task.toLowerCase();

    // ─ ДЕРЕВО ─
    if (/wood|log|дерев|руби|рубить|oak|birch|spruce|jungle/.test(t)) {
      const m = t.match(/(\d+)/);
      return { name: "gather_wood", args: { count: m ? parseInt(m[1]) : 32 } };
    }
    // ─ КАМЕНЬ / РУДА ─
    if (/stone|cobble|камень|камни|cobblestone/.test(t)) {
      const m = t.match(/(\d+)/);
      return { name: "gather_stone", args: { count: m ? parseInt(m[1]) : 64 } };
    }
    // ─ ЕДА / ОХОТА ─
    if (/еда|охот|корова|свинья|food|hunt|мясо|голод|chicken|pig|cow/.test(t)) {
      return { name: "gather_food", args: {} };
    }
    // ─ ИССЛЕДОВАНИЕ ─
    if (/explore|исследу|гуля|rtp|путешеств/.test(t)) {
      return { name: "explore", args: {} };
    }
    // ─ ПШЕНИЦА ─
    if (/пшениц|wheat/.test(t)) {
      const r = t.match(/радиус\s*(\d+)|radius\s*(\d+)/);
      return { name: "farm_crops", args: { crop: "wheat_seeds", radius: r ? parseInt(r[1]||r[2]) : 15, bonemeal: true } };
    }
    // ─ МОРКОВЬ ─
    if (/морков|carrot/.test(t)) {
      return { name: "farm_crops", args: { crop: "carrot", radius: 15, bonemeal: true } };
    }
    // ─ КАРТОФЕЛЬ ─
    if (/картофел|potato/.test(t)) {
      return { name: "farm_crops", args: { crop: "potato", radius: 15, bonemeal: true } };
    }
    // ─ СВЁКЛА ─
    if (/свёкл|свекл|beet/.test(t)) {
      return { name: "farm_crops", args: { crop: "beetroot_seeds", radius: 15, bonemeal: true } };
    }
    // ─ БЫСТРЫЙ ФАРМ ─
    if (/быстр|quick|боне|bone/.test(t)) {
      return { name: "farm_quick", args: { crop: "wheat_seeds", bonemeal: true } };
    }
    // ─ ФЕРМА ДЕРЕВЬЕВ ─
    if (/ферм.*дерев|tree.*farm|farm.*tree|деревья/.test(t)) {
      const sap = /birch|берёз/.test(t) ? "birch_sapling" :
                  /spruce|ёлк|ель/.test(t) ? "spruce_sapling" :
                  /jungle|джунгл/.test(t) ? "jungle_sapling" : "oak_sapling";
      return { name: "farm_trees_full", args: { sapling: sap, spacing: 3, bonemeal: true, radius: 20 } };
    }
    // ─ ШАХТА / ДОБЫЧА ─
    if (/шахт|mine|добыч|excavat|тоннел|tunnel|копать/.test(t)) {
      const m = t.match(/(\d+)/);
      const depth = m ? parseInt(m[1]) : 30;
      return { name: "excavate", args: { width: 3, height: 3, depth } };
    }
    // ─ РЫБАЛКА ─
    if (/рыб|fish/.test(t)) {
      // Базовая рыбалка через отдельную логику
      if (/руд[ыа]|mine.ore|ore.mine|добыч.*руд|шахт.*руд/.test(t))
        return { task: "mine_ores", args: { radius: 48, targetY: 11 } };

      return null; // TODO: добавить задачу рыбалки в bot-tasks
    }
    // ─ СТРОИТЬ ФЕРМУ (построить поля) ─
    if (/строй|build.*farm|farm.*build/.test(t)) {
      const m = t.match(/(\d+)/);
      return { name: "build_farm", args: { size: m ? parseInt(m[1]) : 5 } };
    }
    // ─ ЗЕРНО (общий термин) ─
    if (/зерн|grain|crop|посев|сеять/.test(t)) {
      return { name: "farm_crops", args: { crop: "wheat_seeds", radius: 12, bonemeal: true } };
    }
    // ─ ЛЕС (общий) ─
    if (/лес|forest|рубк/.test(t)) {
      return { name: "gather_wood", args: { count: 64 } };
    }
    // ─ РЕСУРСЫ (широкое) ─
    if (/ресурс|resource|material|матери/.test(t)) {
      return { name: "gather_stone", args: { count: 64 } };
    }
    // ─ АВТО (нейросеть) — для совместимости ─
    if (/авто|auto/.test(t)) {
      return null; // обрабатывается через _useBrain
    }
    return null;
  }

  // ── Утилиты ──────────────────────────────────────────────────────────

  _setPhase(phase) {
    this._phase = phase;
    this.emit("bot:anarchyPhase", { botId: this.instance.id, phase });
  }

  _addLog(msg) {
    const entry = { msg, time: Date.now() };
    this._log.push(entry);
    if (this._log.length > 200) this._log.shift();
    log.info("[Anarchy]", msg);
    this.emit("bot:anarchyLog", { botId: this.instance.id, msg, time: entry.time });
  }
}

module.exports = { AnarchyProtocol };
