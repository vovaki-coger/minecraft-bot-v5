/**
 * brewing-task.js — Зельеварение для Протокола Анархии
 * Поддерживает топ-зелья анархии: Сила I/II, Скорость I/II, Огнестойкость,
 * Невидимость, Прыжок I/II, Водное дыхание, Ночное зрение,
 * Регенерация I/II, Лечение I/II, Отравление, Замедление.
 * + их Сплеш-версии (Gunpowder).
 * + Стойкие (8 мин) если в инвентаре есть Redstone (необязательно).
 */

"use strict";

const log = { info: (...a) => console.log("[Brew]", ...a), error: (...a) => console.error("[Brew]", ...a) };

// ═══════════════════════════════════════════════════════════════════════════
// РЕЦЕПТЫ ЗЕЛИЙ (ванильная Minecraft Java Edition)
// ═══════════════════════════════════════════════════════════════════════════
const POTION_RECIPES = {
  // ── Зелья силы ───────────────────────────────────────────────────────────
  strength_1: {
    label: "Сила I",
    base: "awkward_potion",
    ingredient: "blaze_powder",   // blaze_powder → Strength I
    duration: 180,
    result: "potion_of_strength",
  },
  strength_2: {
    label: "Сила II",
    base: "potion_of_strength",
    ingredient: "glowstone_dust",
    duration: 90,
    result: "potion_of_strength",
    level: 2,
  },

  // ── Скорость ─────────────────────────────────────────────────────────────
  speed_1: {
    label: "Скорость I",
    base: "awkward_potion",
    ingredient: "sugar",
    duration: 180,
    result: "potion_of_swiftness",
  },
  speed_2: {
    label: "Скорость II",
    base: "potion_of_swiftness",
    ingredient: "glowstone_dust",
    duration: 90,
    result: "potion_of_swiftness",
    level: 2,
  },

  // ── Огнестойкость ─────────────────────────────────────────────────────────
  fire_resistance: {
    label: "Огнестойкость",
    base: "awkward_potion",
    ingredient: "magma_cream",
    duration: 240,
    result: "potion_of_fire_resistance",
  },

  // ── Невидимость ───────────────────────────────────────────────────────────
  invisibility: {
    label: "Невидимость",
    base: "potion_of_night_vision",   // Ночное зрение → Невидимость
    ingredient: "fermented_spider_eye",
    duration: 180,
    result: "potion_of_invisibility",
  },

  // ── Прыжок ────────────────────────────────────────────────────────────────
  leaping_1: {
    label: "Прыжок I",
    base: "awkward_potion",
    ingredient: "rabbit_foot",
    duration: 180,
    result: "potion_of_leaping",
  },
  leaping_2: {
    label: "Прыжок II",
    base: "potion_of_leaping",
    ingredient: "glowstone_dust",
    duration: 90,
    result: "potion_of_leaping",
    level: 2,
  },

  // ── Водное дыхание ────────────────────────────────────────────────────────
  water_breathing: {
    label: "Водное дыхание",
    base: "awkward_potion",
    ingredient: "pufferfish",
    duration: 240,
    result: "potion_of_water_breathing",
  },

  // ── Ночное зрение ─────────────────────────────────────────────────────────
  night_vision: {
    label: "Ночное зрение",
    base: "awkward_potion",
    ingredient: "golden_carrot",
    duration: 240,
    result: "potion_of_night_vision",
  },

  // ── Регенерация ───────────────────────────────────────────────────────────
  regeneration_1: {
    label: "Регенерация I",
    base: "awkward_potion",
    ingredient: "ghast_tear",
    duration: 45,
    result: "potion_of_regeneration",
  },
  regeneration_2: {
    label: "Регенерация II",
    base: "potion_of_regeneration",
    ingredient: "glowstone_dust",
    duration: 22,
    result: "potion_of_regeneration",
    level: 2,
  },

  // ── Лечение ───────────────────────────────────────────────────────────────
  healing_1: {
    label: "Лечение I",
    base: "awkward_potion",
    ingredient: "glistering_melon_slice",
    duration: 0,  // моментальное
    result: "potion_of_healing",
  },
  healing_2: {
    label: "Лечение II",
    base: "potion_of_healing",
    ingredient: "glowstone_dust",
    duration: 0,
    result: "potion_of_healing",
    level: 2,
  },

  // ── Отравление ────────────────────────────────────────────────────────────
  poison_1: {
    label: "Отравление I",
    base: "awkward_potion",
    ingredient: "spider_eye",
    duration: 45,
    result: "potion_of_poison",
  },

  // ── Замедление ────────────────────────────────────────────────────────────
  slowness: {
    label: "Замедление",
    base: "potion_of_swiftness",
    ingredient: "fermented_spider_eye",
    duration: 90,
    result: "potion_of_slowness",
  },
};

// Отображение потенциальных ингредиентов для UI (что нужно собрать)
function getIngredients(potionId, wantSplash, wantLong) {
  const rec = POTION_RECIPES[potionId];
  if (!rec) return [];
  const list = [
    { item: "blaze_rod",         label: "Стержень визера → топливо для стойки" },
    { item: "nether_wart",       label: "Адский гриб → Неловкое зелье (основа)" },
    { item: rec.ingredient,      label: _ingredientLabel(rec.ingredient) },
  ];
  if (wantSplash) list.push({ item: "gunpowder", label: "Порох → Сплеш-зелье" });
  if (wantLong)   list.push({ item: "redstone",  label: "Красный камень → 8 минут (по желанию)" });
  // Если нужно промежуточное зелье (Невидимость, Замедление)
  if (rec.base !== "awkward_potion") {
    list.splice(2, 0, { item: "fermented_spider_eye", label: "Паучий глаз → промежуточное зелье" });
  }
  return list;
}

function _ingredientLabel(item) {
  const MAP = {
    blaze_powder: "Пыль визера → Сила I",
    sugar: "Сахар → Скорость I",
    magma_cream: "Магматический крем → Огнестойкость",
    fermented_spider_eye: "Паучий глаз (фермент.) → Невидимость/Замедление",
    rabbit_foot: "Кроличья лапка → Прыжок I",
    pufferfish: "Рыба-шар → Водное дыхание",
    golden_carrot: "Золотая морковь → Ночное зрение",
    ghast_tear: "Слеза гаста → Регенерация",
    glistering_melon_slice: "Блестящая дыня → Лечение",
    spider_eye: "Паучий глаз → Отравление",
    glowstone_dust: "Светокаменная пыль → уровень II",
  };
  return MAP[item] || item;
}

// ═══════════════════════════════════════════════════════════════════════════
// BREWING TASK — основной класс
// ═══════════════════════════════════════════════════════════════════════════
class BrewingTask {
  /**
   * @param {object} instance  — BotInstance (mineflayer bot + stats + id)
   * @param {object} emit      — emit функция для IPC событий
   * @param {object} opts
   *   opts.potionId   {string}  — ключ из POTION_RECIPES
   *   opts.wantSplash {boolean} — варить Сплеш-версию (добавить порох)
   *   opts.wantLong   {boolean} — варить стойкую версию (добавить redstone, 8 мин) — только если есть redstone
   *   opts.batchSize  {number}  — сколько зелий за сессию (3 = 1 стойка × 3 флакона)
   */
  constructor(instance, emit, opts = {}) {
    this.instance = instance;
    this.bot = instance.bot;
    this.emit = emit;
    this.potionId = opts.potionId || "strength_1";
    this.wantSplash = !!opts.wantSplash;
    this.wantLong = !!opts.wantLong;
    this.batchSize = opts.batchSize || 3;
    this._running = true;
    this._log = (msg) => {
      log.info(msg);
      this.emit("bot:anarchyLog", { botId: instance.id, msg, time: Date.now() });
    };
  }

  stop() { this._running = false; }

  async run() {
    const recipe = POTION_RECIPES[this.potionId];
    if (!recipe) {
      this._log("Неизвестный рецепт: " + this.potionId);
      return;
    }
    this._log(`Начинаю зельеварение: ${recipe.label}${this.wantSplash ? " (Сплеш)" : ""}${this.wantLong ? " (8 мин)" : ""}`);

    // 1. Найти стойку зельеварения
    const stand = await this._findBrewingStand();
    if (!stand) { this._log("Стойка зельеварения не найдена (радиус 32м)"); return; }
    this._log("Стойка найдена: " + stand.position.toString());

    // 2. Найти сундук для ингредиентов
    const chest = await this._findChest();

    // 3. Взять ингредиенты из сундука
    await this._collectIngredients(recipe, chest);
    if (!this._running) return;

    // 4. Подойти к стойке
    await this._gotoBlock(stand.position);
    if (!this._running) return;

    // 5. Варим основу: Нежеланное → Неловкое (если нужно)
    const hasAwkward = this._countItem("awkward_potion") >= 3;
    const hasBase = recipe.base === "awkward_potion" ? hasAwkward : this._countItem(recipe.base) >= 3;

    if (!hasBase) {
      const netherWart = this._countItem("nether_wart");
      if (netherWart < 3) {
        this._log(`Нужно минимум 3x nether_wart, есть ${netherWart}`);
        return;
      }
      this._log("Варю основу (Неловкое зелье)...");
      const brewSuccess = await this._brew(stand, "nether_wart", 3);
      if (!brewSuccess || !this._running) return;
    }

    // 6. Варим само зелье
    this._log(`Варю ${recipe.label}...`);
    const mainBrewOk = await this._brew(stand, recipe.ingredient, 3);
    if (!mainBrewOk || !this._running) return;

    // 7. Стойкое зелье (если есть redstone и wantLong)
    if (this.wantLong) {
      const hasRedstone = this._countItem("redstone") >= 3;
      if (hasRedstone) {
        this._log("Добавляю Redstone (стойкое зелье 8 мин)...");
        await this._brew(stand, "redstone", 3);
      } else {
        this._log("Redstone не найден — варю стандартной длины");
      }
    }

    // 8. Сплеш-версия (если нужно)
    if (this.wantSplash && this._running) {
      const hasPowder = this._countItem("gunpowder") >= 3;
      if (hasPowder) {
        this._log("Добавляю порох (Сплеш-зелье)...");
        await this._brew(stand, "gunpowder", 3);
      } else {
        this._log("Порох не найден — оставляю обычное зелье");
      }
    }

    this._log(`✅ Зельеварение завершено: ${recipe.label}`);
  }

  // ── Найти стойку зельеварения ───────────────────────────────────────────
  async _findBrewingStand() {
    const block = this.bot.findBlock({
      matching: b => b.name === "brewing_stand",
      maxDistance: 32,
    });
    return block || null;
  }

  // ── Найти сундук поблизости ─────────────────────────────────────────────
  async _findChest() {
    return this.bot.findBlock({
      matching: b => b.name === "chest" || b.name === "trapped_chest" || b.name === "barrel",
      maxDistance: 32,
    }) || null;
  }

  // ── Собрать ингредиенты из сундука ──────────────────────────────────────
  async _collectIngredients(recipe, chest) {
    if (!chest) { this._log("Сундук не найден — работаю с инвентарём"); return; }

    const needed = [
      { item: "glass_bottle",   count: 3 },
      { item: "blaze_powder",   count: 1 },  // топливо
      { item: "nether_wart",    count: 3 },
      { item: recipe.ingredient, count: 3 },
    ];
    if (this.wantSplash) needed.push({ item: "gunpowder", count: 3 });
    if (this.wantLong)   needed.push({ item: "redstone",  count: 3 });

    // Иди к сундуку
    await this._gotoBlock(chest.position);
    if (!this._running) return;

    try {
      const container = await this.bot.openContainer(chest).catch(() => null);
      if (!container) { this._log("Не могу открыть сундук"); return; }
      await this._sleep(300);

      for (const need of needed) {
        const have = this._countItem(need.item);
        const toTake = Math.max(0, need.count - have);
        if (toTake <= 0) continue;
        try {
          await container.withdraw(
            this.bot.registry.itemsByName[need.item]?.id,
            null,
            toTake
          );
          await this._sleep(100);
          this._log(`Взял из сундука: ${need.item} x${toTake}`);
        } catch { /* предмета нет в сундуке */ }
      }
      container.close();
      await this._sleep(200);
    } catch (err) {
      this._log("Ошибка сундука: " + err.message);
    }
  }

  // ── Варить (добавить ингредиент в стойку и ждать) ───────────────────────
  async _brew(stand, ingredientName, slots = 3) {
    if (!this._running) return false;
    try {
      // Открываем стойку
      const window = await this.bot.openBlock(stand).catch(() => null);
      if (!window) { this._log("Не могу открыть стойку зельеварения"); return false; }
      await this._sleep(400);

      // Кладём топливо (blaze_powder) если нужно
      const fuelItem = this.bot.inventory.items().find(i => i.name === "blaze_powder");
      if (fuelItem) {
        try {
          // Слот топлива в стойке = слот 4 (индекс 4 в окне brewing_stand)
          await window.put(fuelItem.type, null, 1, 4).catch(() => {});
          await this._sleep(200);
        } catch {}
      }

      // Берём ингредиент из инвентаря
      const ingr = this.bot.inventory.items().find(i => i.name === ingredientName);
      if (!ingr) {
        window.close();
        this._log(`Нет ингредиента: ${ingredientName}`);
        return false;
      }

      // Слот ингредиента = слот 3 (верхний слот стойки)
      await window.put(ingr.type, null, ingr.count, 3).catch(() => {});
      await this._sleep(200);

      // Заполняем флаконами слоты 0,1,2 если они пусты
      const bottles = this.bot.inventory.items().filter(i => i.name === "glass_bottle" || i.name.endsWith("_potion"));
      for (let slot = 0; slot < 3 && bottles.length > 0; slot++) {
        const bot_item = bottles.shift();
        if (!bot_item) continue;
        await window.put(bot_item.type, null, 1, slot).catch(() => {});
        await this._sleep(150);
      }

      window.close();
      await this._sleep(500);

      // Ждём варку (~20 секунд)
      this._log(`Варю ${ingredientName}... (до 20 сек)`);
      let waited = 0;
      while (waited < 22000 && this._running) {
        await this._sleep(500);
        waited += 500;
        // Проверяем наличие готового зелья
        const potions = this.bot.inventory.items().filter(i => i.name.includes("potion"));
        if (potions.length >= slots) break;
      }
      this._log("Варка завершена");
      return true;
    } catch (err) {
      this._log("Ошибка варки: " + err.message);
      return false;
    }
  }

  // ── Вспомогательные ─────────────────────────────────────────────────────
  _countItem(name) {
    return this.bot.inventory.items()
      .filter(i => i.name === name)
      .reduce((s, i) => s + i.count, 0);
  }

  async _gotoBlock(pos) {
    const { GoalNear } = require("mineflayer-pathfinder").goals;
    await this.bot.pathfinder.goto(
      new GoalNear(pos.x, pos.y, pos.z, 3)
    ).catch(() => {});
  }

  _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
}

module.exports = { BrewingTask, POTION_RECIPES, getIngredients };
