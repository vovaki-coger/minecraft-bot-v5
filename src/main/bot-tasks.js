/**
 * Scripted task system — бот выполняет команды без AI на каждый шаг.
 * AI используется только для понимания команды, дальше скрипт сам рулит.
 */
const { goals } = require("mineflayer-pathfinder");
const log = require("electron-log");

class TaskManager {
  constructor(botInstance, emit) {
    this.instance = botInstance;
    this.emit = emit || (() => {});
    this.currentTask = null;
    this._running = false;
    this._followInterval = null;
  }

  get bot() { return this.instance.bot; }

  _log(msg) {
    this.instance.chatHistory.push({ type: "survivor", text: `[ЗАДАЧА] ${msg}`, timestamp: Date.now() });
    this.emit("bot:survivorLog", { botId: this.instance.id, message: msg });
  }

  _chat(msg) {
    if (this.bot && msg) {
      const text = String(msg).slice(0, 100);
      this.bot.chat(text);
      this.instance.chatHistory.push({ type: "bot", text, timestamp: Date.now() });
      this.emit("bot:chat", { botId: this.instance.id, username: this.instance.config.nick, message: text, type: "bot" });
    }
  }

  async stopAll() {
    this._running = false;
    if (this._followInterval) { clearInterval(this._followInterval); this._followInterval = null; }
    this.currentTask = null;
    try { if (this.bot?.pathfinder) this.bot.pathfinder.stop(); } catch {}
    try { if (this.bot) this.bot.clearControlStates(); } catch {}
    this._log("Все задачи остановлены");
  }

  async runTask(name, args) {
    if (!args) args = {};
    if (this._running) await this.stopAll();
    this._running = true;
    this.currentTask = name;

    try {
      switch (name) {
        case "come_to":       await this._taskComeToPlayer(args.player); break;
        case "follow":        await this._taskFollowPlayer(args.player); break;
        case "stop":          await this.stopAll(); return;
        case "gather_wood":   await this._taskGatherWood(args.count || 20); break;
        case "gather_stone":  await this._taskGatherBlock("cobblestone", args.count || 32, "Добываю камень"); break;
        case "gather_food":   await this._taskGatherFood(); break;
        case "build_farm":    await this._taskBuildFarm(args.size || 4); break;
        case "build_house":   await this._taskBuildHouse(); break;
        case "craft":         await this._taskCraft(args.item, args.count || 1); break;
        case "attack":        await this._taskAttackMob(args.target); break;
        case "walk_to":       await this._taskWalkTo(args.x, args.y, args.z); break;
        case "explore":       await this._taskExplore(); break;
        case "farm_trees":    await this._taskFarmTrees(args.radius || 20, args.crop || "oak"); break;
        case "pvp_attack":    await this._taskPvpAttack(args.target); break;
        // Новые задачи фарминга
        case "farm_crops":      await this._taskFarmCrops(args); break;
        case "farm_quick":      await this._taskFarmQuick(args); break;
        case "farm_trees_full": await this._taskFarmTreesFull(args); break;
        // PvP-игрок с крит-ударами
        case "pvp_player":    await this._taskPvpPlayer(args); break;
        case "excavate":      await this._taskExcavate(args); break;
        case "inventory":     this._reportInventory(); break;
        case "status":        this._reportStatus(); break;
        default:              this._chat("Не знаю как это сделать");
      }
    } catch (err) {
      log.error("Task error:", err.message);
      this._chat("Ой, не получилось: " + err.message.slice(0, 50));
    }

    this._running = false;
    this.currentTask = null;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // СУЩЕСТВУЮЩИЕ ЗАДАЧИ
  // ──────────────────────────────────────────────────────────────────────────

  async _taskComeToPlayer(playerName) {
    const target = this._findPlayer(playerName);
    if (!target) {
      this._chat(playerName ? "Не вижу игрока " + playerName : "Не вижу никого рядом");
      return;
    }
    this._chat("Иду к тебе, " + target.username + "!");
    await this.bot.pathfinder.goto(
      new goals.GoalNear(target.position.x, target.position.y, target.position.z, 2)
    ).catch(() => {});
    this._chat("Я здесь!");
  }

  async _taskFollowPlayer(playerName) {
    const target = this._findPlayer(playerName);
    if (!target) { this._chat("Не вижу " + (playerName || "тебя")); return; }
    this._chat("Слежу за " + target.username + "! Напиши 'стоп' чтобы остановить");
    const deadline = Date.now() + 300_000;
    while (this._running && Date.now() < deadline && target.isValid) {
      await this.bot.pathfinder.goto(new goals.GoalFollow(target, 2)).catch(() => {});
      await this._sleep(500);
    }
  }

  async _taskGatherWood(count) {
    this._chat("Иду рубить дерево, нужно " + count + " бревён!");
    const logIds = ["oak_log","birch_log","spruce_log","jungle_log","acacia_log","dark_oak_log","mangrove_log","cherry_log"]
      .map(n => this.bot.registry.blocksByName[n]?.id).filter(Boolean);
    let collected = 0, searchRadius = 64, exploreAttempts = 0;
    while (this._running && collected < count) {
      const block = this.bot.findBlock({ matching: logIds, maxDistance: searchRadius });
      if (!block) {
        if (exploreAttempts >= 8) { this._chat("Не нашёл деревьев. Собрал: " + collected); break; }
        this._log("Деревьев нет в " + searchRadius + "м, исследую...");
        const pos = this.bot.entity.position;
        const angle = (exploreAttempts / 8) * Math.PI * 2;
        const dist = 40 + exploreAttempts * 20;
        await this.bot.pathfinder.goto(
          new goals.GoalNear(pos.x + Math.cos(angle) * dist, pos.y, pos.z + Math.sin(angle) * dist, 4)
        ).catch(() => {});
        searchRadius = Math.min(searchRadius + 32, 192);
        exploreAttempts++;
        continue;
      }
      exploreAttempts = 0;
      await this.bot.pathfinder.goto(
        new goals.GoalBlock(block.position.x, block.position.y, block.position.z)
      ).catch(() => {});
      if (!this._running) break;
      await this.bot.dig(block).catch(() => {});
      collected++;
      if (collected % 5 === 0) this._log("Собрано " + collected + "/" + count + " бревён");
    }
    this._chat("Готово! Собрал " + collected + " бревён");
  }

  async _taskGatherBlock(blockName, count, label) {
    this._chat((label || "Добываю " + blockName) + "...");
    const blockType = this.bot.registry.blocksByName[blockName];
    if (!blockType) { this._chat("Не знаю блок: " + blockName); return; }
    let collected = 0;
    while (this._running && collected < count) {
      const block = this.bot.findBlock({ matching: blockType.id, maxDistance: 32 });
      if (!block) { this._chat("Не нашёл рядом!"); break; }
      await this.bot.pathfinder.goto(
        new goals.GoalBlock(block.position.x, block.position.y, block.position.z)
      ).catch(() => {});
      if (!this._running) break;
      await this.bot.dig(block).catch(() => {});
      collected++;
    }
    this._chat("Добыл " + collected + " " + blockName);
  }

  async _taskGatherFood() {
    this._chat("Ищу еду...");
    const animalNames = ["cow","pig","sheep","chicken"];
    for (const name of animalNames) {
      const entity = Object.values(this.bot.entities).find(
        e => e.name === name && e.position.distanceTo(this.bot.entity.position) < 32
      );
      if (entity) {
        this._chat("Нашёл " + name + ", атакую!");
        for (let i = 0; i < 8 && this._running && entity.isValid; i++) {
          await this.bot.pathfinder.goto(new goals.GoalFollow(entity, 1)).catch(() => {});
          this.bot.attack(entity);
          await this._sleep(600);
        }
        return;
      }
    }
    this._chat("Нет животных рядом");
  }

  async _taskBuildFarm(size) {
    this._chat("Строю ферму " + size + "x" + size + "!");
    if (!this.bot?.entity) return;
    const seedItem = this.bot.inventory.items().find(i =>
      ["wheat_seeds","seeds","carrot","potato","beetroot_seeds"].includes(i.name)
    );
    if (!seedItem) { this._chat("Нет семян!"); return; }
    const hoe = this.bot.inventory.items().find(i => i.name.includes("hoe"));
    const pos = this.bot.entity.position.clone().floor();
    let planted = 0;
    for (let dx = 0; dx < size && this._running; dx++) {
      for (let dz = 0; dz < size && this._running; dz++) {
        const tp = pos.offset(dx, 0, dz);
        await this.bot.pathfinder.goto(new goals.GoalNear(tp.x, tp.y, tp.z, 2)).catch(() => {});
        if (!this._running) break;
        const block = this.bot.blockAt(tp);
        if (!block) continue;
        if (hoe && (block.name === "dirt" || block.name === "grass_block")) {
          await this.bot.equip(hoe, "hand").catch(() => {});
          await this.bot.activateBlock(block).catch(() => {});
          await this._sleep(200);
        }
        await this.bot.equip(seedItem, "hand").catch(() => {});
        const tilled = this.bot.blockAt(tp);
        if (tilled) { await this.bot.activateBlock(tilled).catch(() => {}); planted++; }
        await this._sleep(100);
      }
    }
    this._chat("Ферма готова! Посадил " + planted + " семян");
  }

  async _taskBuildHouse() {
    this._chat("Строю домик!");
    const buildBlock = this.bot.inventory.items().find(i =>
      i.name.includes("planks") || i.name.includes("cobblestone") || i.name.includes("log")
    );
    if (!buildBlock || buildBlock.count < 24) {
      this._chat("Нужно минимум 24 блока. Есть: " + (buildBlock?.count || 0)); return;
    }
    await this.bot.equip(buildBlock, "hand").catch(() => {});
    const pos = this.bot.entity.position.clone().floor();
    let placed = 0;
    const size = 5;
    for (let y = 0; y < 3 && this._running; y++) {
      for (let dx = 0; dx < size && this._running; dx++) {
        for (let dz = 0; dz < size && this._running; dz++) {
          if (dx === 0 || dx === size-1 || dz === 0 || dz === size-1) {
            const tp = pos.offset(dx, y, dz);
            await this.bot.pathfinder.goto(new goals.GoalNear(tp.x, tp.y, tp.z, 3)).catch(() => {});
            const below = this.bot.blockAt(tp.offset(0, -1, 0));
            if (below) {
              await this.bot.placeBlock(below, new (require("vec3"))(0,1,0)).catch(() => {});
              placed++;
            }
            await this._sleep(100);
          }
        }
      }
    }
    this._chat("Домик готов! Поставил " + placed + " блоков");
  }

  async _taskCraft(itemName, count) {
    if (!itemName) { this._chat("Что скрафтить?"); return; }
    this._chat("Крафчу " + itemName + "...");
    const item = this.bot.registry.itemsByName[itemName];
    if (!item) { this._chat("Не знаю предмет: " + itemName); return; }
    const table = this.bot.findBlock({
      matching: this.bot.registry.blocksByName["crafting_table"]?.id, maxDistance: 16,
    });
    try {
      const recipe = this.bot.recipesFor(item.id, null, 1, table)[0];
      if (!recipe) { this._chat("Нет рецепта для " + itemName); return; }
      await this.bot.craft(recipe, count, table);
      this._chat("Скрафтил " + count + " " + itemName);
    } catch (err) { this._chat("Не получилось: " + err.message.slice(0, 50)); }
  }

  async _taskAttackMob(targetName) {
    const entity = Object.values(this.bot.entities).find(e => {
      if (e.username === this.bot.username) return false;
      const nm = (e.name || "").toLowerCase();
      const dn = (e.displayName || "").toLowerCase();
      const tn = (targetName || "").toLowerCase();
      return (!tn || nm === tn || dn.includes(tn)) && e.position.distanceTo(this.bot.entity.position) < 32;
    });
    if (!entity) { this._chat("Не вижу " + (targetName || "врага") + " рядом"); return; }
    this._chat("Атакую " + (entity.displayName || entity.name) + "!");
    if (this.bot.pvp) {
      this.bot.pvp.attack(entity);
      while (this._running && entity.isValid && entity.health > 0) await this._sleep(500);
      try { this.bot.pvp.stop(); } catch {}
    } else {
      while (this._running && entity.isValid && entity.health > 0) {
        const gotoP = this.bot.pathfinder.goto(new goals.GoalFollow(entity, 2));
        await Promise.race([gotoP, new Promise(r => setTimeout(r, 3000))]).catch(() => {});
        if (entity.isValid) {
          const headPos = entity.position.offset(0, (entity.height || 1.8) * 0.85, 0);
          await this.bot.lookAt(headPos, true).catch(() => {});
          this.bot.attack(entity);
        }
        await this._sleep(420 + Math.floor(Math.random() * 260));
      }
    }
    this._chat((entity.displayName || entity.name) + " побеждён!");
  }

  async _taskWalkTo(x, y, z) {
    if (x === undefined || x === null) return;
    const fy = y !== undefined && y !== null ? Math.round(y) : Math.round(this.bot.entity.position.y);
    this._chat("Иду к " + Math.round(x) + " " + fy + " " + Math.round(z));
    await this.bot.pathfinder.goto(new goals.GoalBlock(Math.round(x), fy, Math.round(z))).catch(() => {});
    this._chat("Пришёл!");
  }

  async _taskExplore() {
    this._chat("Исследую окрестности!");
    for (let i = 0; i < 5 && this._running; i++) {
      const dx = Math.floor(Math.random() * 60 - 30);
      const dz = Math.floor(Math.random() * 60 - 30);
      const p = this.bot.entity.position;
      await this.bot.pathfinder.goto(new goals.GoalNear(p.x + dx, p.y, p.z + dz, 2)).catch(() => {});
      await this._sleep(1200);
    }
    this._chat("Исследование завершено!");
  }

  async _taskFarmTrees(radius, cropType) {
    // Совместимость со старой сигнатурой
    await this._taskFarmTreesFull({ radius, sapling: cropType + "_sapling", spacing: 3, bonemeal: true });
  }

  async _taskPvpAttack(target) {
    await this._taskPvpPlayer({ target });
  }

  // ──────────────────────────────────────────────────────────────────────────
  // НОВЫЕ ЗАДАЧИ ФАРМИНГА
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * farm_crops — полноценный фарм культур по радиусу.
   * 1. Ищет блоки farmland/dirt/grass в радиусе
   * 2. Вспахивает мотыгой, поливает (ищет воду рядом)
   * 3. Сажает выбранную культуру
   * 4. Применяет костную муку × N (bonemeal)
   * 5. Когда посев вырос — собирает (dig)
   */
  async _taskFarmCrops(opts = {}) {
    const { crop = "wheat_seeds", radius = 10, bonemeal = true, depositChest = true } = opts;
    this._log("Начинаю фарм " + crop + " в радиусе " + radius);

    // Максимальный возраст для культуры
    const maxAgeMap = {
      wheat_seeds: 7, carrot: 7, potato: 7, beetroot_seeds: 3,
      melon_seeds: 7, pumpkin_seeds: 7, nether_wart: 3,
      sweet_berries: 3,
    };
    const maxAge = maxAgeMap[crop] ?? 7;

    // Типы культур
    const FRUIT_CROPS    = new Set(["melon_seeds","pumpkin_seeds"]);
    const VERTICAL_CROPS = new Set(["sugar_cane","bamboo","cactus"]);
    const MUSHROOM_CROPS = new Set(["red_mushroom","brown_mushroom"]);
    const CHORUS_CROPS   = new Set(["chorus_flower"]);

    const isFruit    = FRUIT_CROPS.has(crop);
    const isVertical = VERTICAL_CROPS.has(crop);
    const isMushroom = MUSHROOM_CROPS.has(crop);

    // Реальное имя посева в мире (растение)
    const growthNameMap = {
      wheat_seeds: "wheat", carrot: "carrots", potato: "potatoes",
      beetroot_seeds: "beetroots", melon_seeds: "melon_stem",
      pumpkin_seeds: "pumpkin_stem", nether_wart: "nether_wart",
      sugar_cane: "sugar_cane", bamboo: "bamboo", cactus: "cactus",
      sweet_berries: "sweet_berry_bush", red_mushroom: "red_mushroom",
      brown_mushroom: "brown_mushroom", chorus_flower: "chorus_flower",
    };
    const growthName = growthNameMap[crop] || crop;

    const hoe       = this.bot.inventory.items().find(i => i.name.includes("hoe"));
    const seedItem  = this.bot.inventory.items().find(i => i.name === crop);
    const boneItem  = bonemeal ? this.bot.inventory.items().find(i => i.name === "bone_meal") : null;

    if (!seedItem) { this._log("Нет " + crop + " в инвентаре!"); return; }

    const pos = this.bot.entity.position.clone().floor();
    let planted = 0, harvested = 0;

    for (let dx = -radius; dx <= radius && this._running; dx++) {
      for (let dz = -radius; dz <= radius && this._running; dz++) {
        if (Math.abs(dx) + Math.abs(dz) > radius * 1.4) continue; // круг

        const tp = pos.offset(dx, 0, dz);

        // ── Вертикальные культуры (тростник, бамбук, кактус) ──────────────
        if (isVertical) {
          const above = this.bot.blockAt(tp.offset(0, 1, 0));
          if (above && above.name === growthName) {
            // Ищем верхний блок колонны (высота >= 2 → срубаем верхние оставляя нижний)
            let height = 0;
            while (this.bot.blockAt(tp.offset(0, height + 1, 0))?.name === growthName) height++;
            if (height >= 1) {
              // Ломаем блок на высоте 2 снизу — верхние упадут
              await this._gotoNearest(tp, 3);
              for (let h = height; h >= 2 && this._running; h--) {
                const b = this.bot.blockAt(tp.offset(0, h, 0));
                if (b && b.name === growthName) { await this.bot.dig(b).catch(() => {}); await this._sleep(50); }
              }
              harvested++;
            }
          } else {
            // Нет ростка — сажаем
            const ground = this.bot.blockAt(tp);
            if (ground && ["dirt","grass_block","sand","gravel","mud","mycelium","podzol"].includes(ground.name)) {
              const seedItem = this.bot.inventory.items().find(i => i.name === crop);
              if (seedItem) {
                await this._gotoNearest(tp, 3);
                await this.bot.equip(seedItem, "hand").catch(() => {});
                await this.bot.activateBlock(ground).catch(() => {});
                await this._sleep(80);
                planted++;
              }
            }
          }
          continue;
        }

        // ── Плодовые культуры (дыня, тыква) — собираем ПЛОД, не стебель ──
        if (isFruit) {
          const stemBlock = this.bot.blockAt(tp.offset(0, 1, 0));
          if (stemBlock && stemBlock.name === growthName) {
            // Ищем плод рядом с стеблем (4 стороны)
            const DIRS = [[1,0],[-1,0],[0,1],[0,-1]];
            for (const [dx2, dz2] of DIRS) {
              const fruitPos = tp.offset(dx2, 1, dz2);
              const fruitBlock = this.bot.blockAt(fruitPos);
              const isMelon = fruitBlock?.name === "melon" || fruitBlock?.name === "pumpkin";
              if (isMelon) {
                await this._gotoNearest(fruitPos, 3);
                await this.bot.dig(fruitBlock).catch(() => {});
                await this._sleep(60);
                harvested++;
                break;
              }
            }
            // Костная мука на стебель
            const stemAge = stemBlock.getProperties?.()?.age ?? stemBlock.metadata ?? 0;
            if (stemAge < maxAge && bonemeal) {
              const freshBone = this.bot.inventory.items().find(i => i.name === "bone_meal");
              if (freshBone) {
                await this._gotoNearest(tp, 3);
                await this.bot.equip(freshBone, "hand").catch(() => {});
                for (let b = 0; b < 4 && this._running; b++) {
                  await this.bot.activateBlock(stemBlock).catch(() => {});
                  await this._sleep(40);
                }
              }
            }
            continue;
          }
        }

        // ── Стандартные культуры ──────────────────────────────────────────
        const cropBlock = this.bot.blockAt(tp.offset(0, 1, 0));
        if (cropBlock && cropBlock.name === growthName) {
          const age = cropBlock.getProperties?.()?.age ?? cropBlock.metadata ?? 0;
          if (age >= maxAge) {
            await this._gotoNearest(tp, 3);
            if (!this._running) break;
            await this.bot.dig(cropBlock).catch(() => {});
            await this._sleep(60);
            const freshSeed = this.bot.inventory.items().find(i => i.name === crop);
            if (freshSeed) {
              const farmBlock = this.bot.blockAt(tp);
              if (farmBlock) {
                await this.bot.equip(freshSeed, "hand").catch(() => {});
                await this.bot.activateBlock(farmBlock).catch(() => {});
                planted++;
              }
            }
            harvested++;
            continue;
          }
          if (bonemeal && boneItem) {
            const freshBone = this.bot.inventory.items().find(i => i.name === "bone_meal");
            if (freshBone) {
              await this._gotoNearest(tp, 3);
              await this.bot.equip(freshBone, "hand").catch(() => {});
              for (let b = 0; b < 4 && this._running; b++) {
                await this.bot.activateBlock(cropBlock).catch(() => {});
                await this._sleep(40);
              }
            }
          }
          continue;
        }

        // Вспахиваем и сажаем
        const groundBlock = this.bot.blockAt(tp);
        if (!groundBlock) continue;
        if (!["dirt","grass_block","farmland"].includes(groundBlock.name)) continue;

        await this._gotoNearest(tp, 3);
        if (!this._running) break;

        if (hoe && groundBlock.name !== "farmland") {
          const freshHoe = this.bot.inventory.items().find(i => i.name.includes("hoe"));
          if (freshHoe) {
            await this.bot.equip(freshHoe, "hand").catch(() => {});
            await this.bot.activateBlock(groundBlock).catch(() => {});
            await this._sleep(150);
          }
        }

        const freshSeed = this.bot.inventory.items().find(i => i.name === crop);
        if (!freshSeed) { this._log("Семена закончились"); return; }

        const tilledBlock = this.bot.blockAt(tp);
        if (tilledBlock?.name === "farmland") {
          await this.bot.equip(freshSeed, "hand").catch(() => {});
          await this.bot.activateBlock(tilledBlock).catch(() => {});
          planted++;
          await this._sleep(80);

          // Костная мука сразу после посадки
          if (bonemeal) {
            const freshBone = this.bot.inventory.items().find(i => i.name === "bone_meal");
            if (freshBone) {
              await this.bot.equip(freshBone, "hand").catch(() => {});
              const newCrop = this.bot.blockAt(tp.offset(0, 1, 0));
              if (newCrop && newCrop.name === growthName) {
                for (let b = 0; b < 6 && this._running; b++) {
                  await this.bot.activateBlock(newCrop).catch(() => {});
                  await this._sleep(40);
                }
              }
            }
          }
        }
      }
    }

    if (depositChest) await this._depositToChest();
    this._log(`Фарм завершён: посадил ${planted}, собрал ${harvested}`);
  }

  /**
   * farm_quick — Delta-style быстрый фарм.
   * Бот стоит на одном месте, смотрит вниз, запускает цикл:
   * 1. Проверяет блок под ногами и вокруг (3×3)
   * 2. Если farmland без посева → сажает семя
   * 3. Применяет костную муку × 6 (35–45мс задержка)
   * 4. Когда выросло → ломает
   * 5. Повтор
   */
  async _taskFarmQuick(opts = {}) {
    const { crop = "wheat_seeds", bonemeal = true } = opts;
    this._log("Быстрый фарм запущен (Delta-style). Ctrl+Stop чтобы остановить");

    const growthNameMap = {
      wheat_seeds: "wheat", carrot: "carrots", potato: "potatoes",
      beetroot_seeds: "beetroots", melon_seeds: "melon_stem",
      pumpkin_seeds: "pumpkin_stem", nether_wart: "nether_wart",
    };
    const maxAgeMap = {
      wheat_seeds: 7, carrot: 7, potato: 7, beetroot_seeds: 3,
      melon_seeds: 7, pumpkin_seeds: 7, nether_wart: 3,
    };
    const growthName = growthNameMap[crop] || "wheat";
    const maxAge = maxAgeMap[crop] ?? 7;

    // Смотрим вниз
    await this.bot.look(this.bot.entity.yaw, Math.PI / 2, true).catch(() => {});

    let cycles = 0;
    while (this._running) {
      const pos = this.bot.entity.position.clone().floor();

      // Проверяем 3×3 вокруг
      for (let dx = -1; dx <= 1 && this._running; dx++) {
        for (let dz = -1; dz <= 1 && this._running; dz++) {
          const tp = pos.offset(dx, 0, dz);
          const ground = this.bot.blockAt(tp);
          const above  = this.bot.blockAt(tp.offset(0, 1, 0));

          if (!ground || ground.name !== "farmland") continue;

          if (above && above.name === growthName) {
            const age = above.getProperties?.()?.age ?? above.metadata ?? 0;
            if (age >= maxAge) {
              // Ломаем
              await this.bot.dig(above).catch(() => {});
              await this._sleep(35 + Math.random() * 10);
              // Сразу сажаем снова
              const seed = this.bot.inventory.items().find(i => i.name === crop);
              if (seed) {
                await this.bot.equip(seed, "hand").catch(() => {});
                const newGround = this.bot.blockAt(tp);
                if (newGround?.name === "farmland") {
                  await this.bot.activateBlock(newGround).catch(() => {});
                  await this._sleep(35 + Math.random() * 10);
                }
              }
              continue;
            }
            // Костная мука на незрелое
            if (bonemeal) {
              const bone = this.bot.inventory.items().find(i => i.name === "bone_meal");
              if (bone) {
                await this.bot.equip(bone, "hand").catch(() => {});
                for (let b = 0; b < 6 && this._running; b++) {
                  await this.bot.activateBlock(above).catch(() => {});
                  await this._sleep(35 + Math.random() * 10);
                  // Проверяем выросло ли
                  const freshAbove = this.bot.blockAt(tp.offset(0, 1, 0));
                  if (!freshAbove || freshAbove.name !== growthName) break;
                  const freshAge = freshAbove.getProperties?.()?.age ?? freshAbove.metadata ?? 0;
                  if (freshAge >= maxAge) break;
                }
              }
            }
          } else if (!above || above.type === 0) {
            // Пустое место — сажаем
            const seed = this.bot.inventory.items().find(i => i.name === crop);
            if (seed) {
              await this.bot.equip(seed, "hand").catch(() => {});
              await this.bot.activateBlock(ground).catch(() => {});
              await this._sleep(35 + Math.random() * 10);
            }
          }
        }
      }

      cycles++;
      if (cycles % 50 === 0) this._log("Быстрый фарм: " + cycles + " циклов");
      await this._sleep(40 + Math.random() * 10); // ~22–25 итераций/сек
    }
  }

  /**
   * farm_trees_full — полноценный фарм деревьев с правильным интервалом.
   * 1. Вычисляет сетку позиций по spacing
   * 2. Проходит каждую позицию, сажает саженец
   * 3. Применяет костную муку до роста
   * 4. Рубит выросшее дерево
   * 5. Повтор
   */
  async _taskFarmTreesFull(opts = {}) {
    const { sapling = "oak_sapling", spacing = 3, radius = 20, bonemeal = true, depositChest = true } = opts;
    this._log(`Фарм деревьев: ${sapling}, интервал ${spacing}, радиус ${radius}`);

    const pos = this.bot.entity.position.clone().floor();
    const logNames = ["oak_log","birch_log","spruce_log","jungle_log","acacia_log","dark_oak_log","mangrove_log"]
      .map(n => this.bot.registry.blocksByName[n]?.id).filter(Boolean);

    let chopped = 0, planted = 0;

    // Генерируем позиции сетки
    const positions = [];
    for (let dx = -radius; dx <= radius; dx += spacing + 1) {
      for (let dz = -radius; dz <= radius; dz += spacing + 1) {
        positions.push(pos.offset(dx, 0, dz));
      }
    }
    this._log(`Позиций для деревьев: ${positions.length}`);

    for (const tp of positions) {
      if (!this._running) break;

      // Рубим дерево если выросло
      let treesFound = true;
      while (treesFound && this._running) {
        const logBlock = this.bot.findBlock({
          matching: logNames, maxDistance: 5,
          point: tp,
        });
        if (!logBlock) { treesFound = false; break; }
        await this._gotoNearest(logBlock.position, 3);
        if (!this._running) break;
        await this.bot.dig(logBlock).catch(() => {});
        await this._sleep(80);
        chopped++;
      }
      if (!this._running) break;

      // Идём к позиции
      await this._gotoNearest(tp, 2);
      if (!this._running) break;

      const ground = this.bot.blockAt(tp);
      if (!ground) continue;

      // Нужна грасс/дёрт под саженец
      if (!["grass_block","dirt","mycelium","podzol","mud"].includes(ground.name)) continue;

      const seedItem = this.bot.inventory.items().find(i => i.name === sapling);
      if (!seedItem) { this._log("Нет " + sapling + " в инвентаре"); return; }

      const above = this.bot.blockAt(tp.offset(0, 1, 0));
      if (above && above.type !== 0) continue; // не пусто

      await this.bot.equip(seedItem, "hand").catch(() => {});
      await this.bot.activateBlock(ground).catch(() => {});
      await this._sleep(120);
      planted++;

      // Костная мука до роста
      if (bonemeal) {
        const maxBone = 12;
        for (let b = 0; b < maxBone && this._running; b++) {
          const sapBlock = this.bot.blockAt(tp.offset(0, 1, 0));
          if (!sapBlock || !sapBlock.name.includes("sapling")) break; // выросло
          const bone = this.bot.inventory.items().find(i => i.name === "bone_meal");
          if (!bone) break;
          await this.bot.equip(bone, "hand").catch(() => {});
          await this.bot.activateBlock(sapBlock).catch(() => {});
          await this._sleep(80);
        }
      }

      if (planted % 5 === 0) this._log(`Деревья: посажено ${planted}, срублено ${chopped}`);
    }

    if (depositChest) await this._depositToChest();
    this._log(`Фарм деревьев завершён: посажено ${planted}, срублено ${chopped}`);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // PVP С КРИТ-УДАРАМИ, ЗЕЛЬЯМИ, ОТСТУПЛЕНИЕМ
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * pvp_player — атакует ближайшего игрока (или по имени).
   * Тактика «про-игрок»:
   *   • Пьёт зелья силы/скорости в начале
   *   • Jump-crit: перед 60% ударов прыгает
   *   • Следит за HP: < 8 → ест еду/зелье лечения
   *   • Отступление при HP < 5 → эндер-жемчуг или спринт в сторону
   *   • Случайная задержка 400–650мс (обход анти-чита)
   *   • Проверяет FOV (не атакует за спиной)
   */
  async _taskPvpPlayer(opts = {}) {
    const { target: targetName } = opts;

    // Находим цель
    let target = targetName
      ? this._findPlayer(targetName)
      : this._findNearestPlayer();

    if (!target) {
      this._log("Не вижу игроков рядом");
      return;
    }
    this._log(`PvP → атакую ${target.username}`);

    // ── Зелья в начале ──────────────────────────────────────────────────────
    await this._drinkPotion("strength");
    await this._sleep(300);
    await this._drinkPotion("speed");
    await this._sleep(300);

    // ── Экипируем лучшее оружие ─────────────────────────────────────────────
    const weaponPriority = [
      "netherite_sword","diamond_sword","iron_sword","golden_sword","stone_sword","wooden_sword",
      "netherite_axe","diamond_axe","iron_axe",
    ];
    for (const wName of weaponPriority) {
      const w = this.bot.inventory.items().find(i => i.name === wName);
      if (w) { await this.bot.equip(w, "hand").catch(() => {}); break; }
    }

    let hitCount = 0;
    let retreating = false;

    while (this._running) {
      // Обновляем цель если потеряли
      if (!target.isValid) {
        target = targetName ? this._findPlayer(targetName) : this._findNearestPlayer();
        if (!target) { this._log("Цель потеряна"); break; }
        this._log(`Новая цель: ${target.username}`);
      }

      const myHp = this.bot.health ?? 20;
      const dist = target.position.distanceTo(this.bot.entity.position);

      // ── Критически мало HP → отступаем ──────────────────────────────────
      if (myHp <= 5 && !retreating) {
        retreating = true;
        this._log("HP критическое (" + myHp.toFixed(1) + "), отступаю!");
        await this._retreat(target);
        await this._drinkPotion("healing");
        await this._sleep(1500);
        retreating = false;
        continue;
      }

      // ── Мало HP → едим/лечимся ──────────────────────────────────────────
      if (myHp < 8) {
        await this._healSelf();
      }

      // ── Подходим к цели ──────────────────────────────────────────────────
      if (dist > 2.5) {
        const goto = this.bot.pathfinder.goto(new goals.GoalFollow(target, 2));
        await Promise.race([goto, new Promise(r => setTimeout(r, 2000))]).catch(() => {});
        continue;
      }

      // ── Проверка FOV (античит — не бьём за спину) ───────────────────────
      if (!this._inFov(target, 100)) {
        const headPos = target.position.offset(0, (target.height ?? 1.8) * 0.85, 0);
        await this.bot.lookAt(headPos, true).catch(() => {});
        await this._sleep(80);
        continue;
      }

      // ── Смотрим на цель ──────────────────────────────────────────────────
      const headPos = target.position.offset(0, (target.height ?? 1.8) * 0.85, 0);
      await this.bot.lookAt(headPos, true).catch(() => {});

      // ── Jump-crit ~60% ───────────────────────────────────────────────────
      const doJump = Math.random() < 0.6;
      if (doJump && !this.bot.entity.isInWater) {
        this.bot.setControlState("jump", true);
        await this._sleep(50);
        this.bot.setControlState("jump", false);
        await this._sleep(150); // ждём пика прыжка
      }

      // ── Удар ─────────────────────────────────────────────────────────────
      if (target.isValid && target.position.distanceTo(this.bot.entity.position) < 3.5) {
        this.bot.attack(target);
        hitCount++;
        if (hitCount % 5 === 0) this._log(`PvP: ${hitCount} ударов, HP=${myHp.toFixed(1)}`);
      }

      // ── Рандомная задержка (анти-чит) ────────────────────────────────────
      const delay = 400 + Math.floor(Math.random() * 250);
      await this._sleep(delay);
    }

    this._log(`PvP завершён: нанесено ${hitCount} ударов`);
  }

  // ── Хелперы PvP ─────────────────────────────────────────────────────────

  _findNearestPlayer() {
    return Object.values(this.bot.entities)
      .filter(e => e.type === "player" && e.username !== this.bot.username && e.isValid)
      .sort((a, b) =>
        a.position.distanceTo(this.bot.entity.position) -
        b.position.distanceTo(this.bot.entity.position)
      )[0] || null;
  }

  async _drinkPotion(type) {
    const potionMap = {
      strength: ["potion_of_strength","splash_potion"],
      speed:    ["potion_of_swiftness","potion_of_speed"],
      healing:  ["potion_of_healing","potion_of_regeneration","golden_apple","enchanted_golden_apple"],
    };
    const names = potionMap[type] || [];
    for (const n of names) {
      const item = this.bot.inventory.items().find(i => i.name.includes(n));
      if (item) {
        try {
          await this.bot.equip(item, "hand").catch(() => {});
          this.bot.activateItem();
          await this._sleep(1500);
          this.bot.deactivateItem();
        } catch {}
        return;
      }
    }
  }

  async _healSelf() {
    // Пробуем зелье лечения
    const healPotion = this.bot.inventory.items().find(i =>
      i.name.includes("healing") || i.name.includes("regeneration")
    );
    if (healPotion) { await this._drinkPotion("healing"); return; }

    // Золотое яблоко
    const apple = this.bot.inventory.items().find(i =>
      i.name === "golden_apple" || i.name === "enchanted_golden_apple"
    );
    if (apple) {
      await this.bot.equip(apple, "hand").catch(() => {});
      this.bot.activateItem();
      await this._sleep(1600);
      this.bot.deactivateItem();
      return;
    }

    // Обычная еда
    const food = this.bot.inventory.items().find(i =>
      /apple|bread|beef|pork|chicken|mutton|salmon|carrot|potato|cookie|berry/.test(i.name) && i.count > 0
    );
    if (food) {
      await this.bot.equip(food, "hand").catch(() => {});
      this.bot.activateItem();
      await this._sleep(1600);
      this.bot.deactivateItem();
    }
  }

  async _retreat(fromEntity) {
    // Пробуем эндер-жемчуг (случайный бросок в сторону)
    const pearl = this.bot.inventory.items().find(i => i.name === "ender_pearl");
    if (pearl) {
      await this.bot.equip(pearl, "hand").catch(() => {});
      // Кидаем перл в противоположную сторону
      const dx = this.bot.entity.position.x - fromEntity.position.x;
      const dz = this.bot.entity.position.z - fromEntity.position.z;
      const len = Math.sqrt(dx*dx + dz*dz) || 1;
      const yaw = Math.atan2(-dx/len, -dz/len);
      await this.bot.look(yaw, -0.5, true).catch(() => {});
      this.bot.activateItem();
      await this._sleep(500);
      return;
    }

    // Спринт в сторону
    this.bot.setControlState("sprint", true);
    const dx = this.bot.entity.position.x - fromEntity.position.x;
    const dz = this.bot.entity.position.z - fromEntity.position.z;
    const len = Math.sqrt(dx*dx + dz*dz) || 1;
    const tx = this.bot.entity.position.x + (dx/len) * 15;
    const tz = this.bot.entity.position.z + (dz/len) * 15;
    await this.bot.pathfinder.goto(
      new goals.GoalNear(tx, this.bot.entity.position.y, tz, 2)
    ).catch(() => {});
    this.bot.setControlState("sprint", false);
  }

  _inFov(entity, fovDegrees = 100) {
    if (!this.bot?.entity) return false;
    const dx = entity.position.x - this.bot.entity.position.x;
    const dz = entity.position.z - this.bot.entity.position.z;
    const angle = Math.atan2(-dx, -dz); // мировой yaw к цели
    let diff = Math.abs(this.bot.entity.yaw - angle);
    if (diff > Math.PI) diff = 2 * Math.PI - diff;
    return diff < (fovDegrees / 2) * (Math.PI / 180);
  }

  // ── Сдача в сундук ───────────────────────────────────────────────────────
  async _depositToChest() {
    try {
      const Vec3 = require('vec3');
      const KEEP = new Set(["wooden_sword","stone_sword","iron_sword","golden_sword","diamond_sword","netherite_sword",
        "wooden_axe","stone_axe","iron_axe","golden_axe","diamond_axe","netherite_axe",
        "wooden_pickaxe","stone_pickaxe","iron_pickaxe","golden_pickaxe","diamond_pickaxe","netherite_pickaxe",
        "wooden_shovel","stone_shovel","iron_shovel","golden_shovel","diamond_shovel","netherite_shovel",
        "wooden_hoe","stone_hoe","iron_hoe","golden_hoe","diamond_hoe","netherite_hoe",
        "golden_apple","enchanted_golden_apple","totem_of_undying","bone_meal",
        "oak_sapling","birch_sapling","spruce_sapling","jungle_sapling","acacia_sapling","dark_oak_sapling",
        "wheat_seeds","carrot","potato","beetroot_seeds","melon_seeds","pumpkin_seeds","nether_wart",
        "sugar_cane","bamboo","cactus","sweet_berries","red_mushroom","brown_mushroom","chorus_flower",
        "bucket","water_bucket","flint_and_steel","ender_pearl","fire_charge","shield",
      ]);
      this._log("📦 Ищу ближайший сундук...");
      const chest = this.bot.findBlock({
        matching: b => b.name === "chest" || b.name === "trapped_chest" || b.name === "barrel",
        maxDistance: 40,
      });
      if (!chest) { this._log("📦 Сундук не найден"); return; }
      await this._gotoNearest(chest.position, 3);
      const chestContainer = await this.bot.openContainer(chest).catch(() => null);
      if (!chestContainer) { this._log("📦 Не удалось открыть сундук"); return; }
      await this._sleep(300);
      const items = this.bot.inventory.items();
      let deposited = 0;
      for (const item of items) {
        if (KEEP.has(item.name)) continue;
        try {
          await chestContainer.deposit(item.type, null, item.count);
          deposited += item.count;
          await this._sleep(60);
        } catch {}
      }
      chestContainer.close();
      this._log(`📦 Сдал в сундук: ${deposited} предметов`);
    } catch (err) {
      this._log("📦 Ошибка сдачи: " + err.message);
    }
  }

  // ── Вспомогательные ─────────────────────────────────────────────────────

  // ──────────────────────────────────────────────────────────────────────────
  // РАСКОПКА ТЕРРИТОРИИ: копаем все блоки между двумя координатами
  // ──────────────────────────────────────────────────────────────────────────
  async _taskExcavate(args) {
    const { x1, y1, z1, x2, y2, z2 } = args || {};
    if (x1 == null || y1 == null || z1 == null || x2 == null || y2 == null || z2 == null) {
      this._chat('Укажи две точки: x1 y1 z1 x2 y2 z2');
      return;
    }
    const Vec3 = require('vec3');
    const minX = Math.min(x1, x2), maxX = Math.max(x1, x2);
    const minY = Math.min(y1, y2), maxY = Math.max(y1, y2);
    const minZ = Math.min(z1, z2), maxZ = Math.max(z1, z2);
    const total = (maxX-minX+1) * (maxY-minY+1) * (maxZ-minZ+1);
    this._chat(`⛏ Начинаю раскопку: ${maxX-minX+1}x${maxY-minY+1}x${maxZ-minZ+1} = ${total} блоков`);
    let dug = 0, skipped = 0;
    const SKIP = new Set(['air','water','lava','void_air','cave_air']);

    // Копаем сверху вниз, слой за слоем
    for (let y = maxY; y >= minY && this._running; y--) {
      for (let x = minX; x <= maxX && this._running; x++) {
        for (let z = minZ; z <= maxZ && this._running; z++) {
          const block = this.bot.blockAt(new Vec3(x, y, z));
          if (!block || SKIP.has(block.name) || !block.diggable) { skipped++; continue; }

          // Подходим к блоку
          try {
            await this.bot.pathfinder.goto(
              new goals.GoalNear(x, y, z, 3)
            ).catch(() => {});
          } catch { continue; }

          if (!this._running) break;

          // Перечитываем блок (мог упасть пока шли)
          const b2 = this.bot.blockAt(new Vec3(x, y, z));
          if (!b2 || SKIP.has(b2.name) || !b2.diggable) { skipped++; continue; }

          try {
            await this.bot.dig(b2);
            dug++;
            if (dug % 16 === 0) {
              const msg = `⛏ Раскопка: ${dug}/${total} блоков (слой Y=${y})`;
              this._log(msg);
              this.emit("bot:excavateProgress", { botId: this.instance.id, dug, total, msg });
            }
          } catch { skipped++; }
        }
      }
    }
    this._chat(`✅ Раскопка завершена! Выкопано: ${dug}, пропущено: ${skipped}`);
    this.emit("bot:excavateDone", { botId: this.instance.id, dug, skipped });
  }

  async _gotoNearest(pos, range = 3) {
    await this.bot.pathfinder.goto(
      new goals.GoalNear(pos.x, pos.y, pos.z, range)
    ).catch(() => {});
  }

  _reportInventory() {
    const items = this.bot.inventory.items();
    if (!items.length) { this._chat("Инвентарь пустой"); return; }
    const top = items.sort((a,b) => b.count - a.count).slice(0,5)
      .map(i => (i.displayName || i.name) + " x" + i.count).join(", ");
    this._chat("Инвентарь: " + top);
  }

  _reportStatus() {
    const s = this.instance.stats;
    this._chat("HP:" + Math.round(s.health) + "/20 Еда:" + Math.round(s.food) + "/20 XP:" + s.experience +
      " Pos:" + s.x + " " + s.y + " " + s.z);
  }

  _findPlayer(name) {
    return Object.values(this.bot.entities).find(e =>
      e.type === "player" &&
      e.username !== this.bot.username &&
      (!name || e.username?.toLowerCase().includes(name.toLowerCase()))
    ) || null;
  }

  _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
}

// ===================================================================
// ПАРСЕР КОМАНД ИЗ ЧАТА (русский язык → задача)
// ===================================================================
function parseCommand(message, botName) {
  const raw = message.trim();
  const msg = raw.toLowerCase();
  const nick = (botName || "").toLowerCase();

  const addressed = !nick ||
    msg.includes(nick) ||
    /^бот[ ,!]|^bot[ ,!]/.test(msg) ||
    msg.startsWith("!") ||
    msg.length < 20;

  if (!addressed) return null;

  const clean = msg
    .replace(new RegExp(nick, "g"), "")
    .replace(/^бот[ ,!]+|^bot[ ,!]+|^!/, "")
    .replace(/[,!?.]+/g, " ")
    .trim();

  if (/^(стоп|stop|останов|хватит|отмен|замри)/.test(clean)) return { task: "stop" };
  if (/инвентар|что (у тебя|есть)|покажи (что|вещи)|items|inventory/.test(clean)) return { task: "inventory" };
  if (/статус|жизн|сколько хп|где ты|позиц|координат|status/.test(clean)) return { task: "status" };
  if (/иди (сюда|ко мне)|come( here| to me)?|подойди|ко мне/.test(clean)) return { task: "come_to" };
  if (/следуй|следи за мной|иди за мной|follow/.test(clean)) return { task: "follow" };

  if (/руби|сруб|добудь дерев|принеси дерев|gather wood/.test(clean)) {
    const m = clean.match(/(\d+)/);
    return { task: "gather_wood", count: m ? parseInt(m[1]) : 20 };
  }
  if (/добудь камень|накопай камн|cobblestone/.test(clean)) {
    const m = clean.match(/(\d+)/);
    return { task: "gather_stone", count: m ? parseInt(m[1]) : 32 };
  }
  if (/найди еду|добудь еду|поохоться|убей (корову|свинью|курицу|овцу)|food|hunt/.test(clean)) return { task: "gather_food" };
  if (/построй ферм|сделай ферм|посади (семена|пшениц|огород)/.test(clean)) {
    const m = clean.match(/(\d+)/);
    return { task: "build_farm", size: m ? Math.min(parseInt(m[1]), 8) : 4 };
  }
  if (/ферм.{0,8}дерев|дерево.{0,8}ферм|сажай дерев|вырашив|farm.{0,8}tree/.test(clean)) {
    const radiusM = clean.match(/(\d+)/);
    const cropM = clean.match(/(дуб|берёза|берез|ель|акация|dark_oak|oak|birch|spruce|jungle|acacia)/);
    const cropMap = { 'дуб':'oak','oak':'oak','берёза':'birch','берез':'birch','birch':'birch',
      'ель':'spruce','spruce':'spruce','jungle':'jungle','акация':'acacia','acacia':'acacia','dark_oak':'dark_oak' };
    return { task: "farm_trees", radius: radiusM ? Math.min(parseInt(radiusM[1]), 60) : 20,
      crop: cropM ? (cropMap[cropM[1].toLowerCase()] || 'oak') : 'oak' };
  }
  if (/построй (дом|домик|укрытие|базу)|build (house|home|shelter)/.test(clean)) return { task: "build_house" };

  // PvP
  if (/атакуй игрока|pvp|бей игрока|убей игрока/.test(clean)) {
    const playerM = clean.match(/(?:игрока|player)\s+(\S+)/);
    return { task: "pvp_player", target: playerM?.[1] || null };
  }

  const mobMap = { "зомби":"zombie","скелет":"skeleton","паук":"spider","крипер":"creeper",
    "корова":"cow","свинья":"pig","курица":"chicken","овца":"sheep","эндермен":"enderman","zombie":"zombie","skeleton":"skeleton" };
  if (/убей|атакуй|kill|attack|напади/.test(clean)) {
    for (const [ru, en] of Object.entries(mobMap)) {
      if (clean.includes(ru)) return { task: "attack", target: en };
    }
    return { task: "attack", target: null };
  }

  const craftMap = { "верстак":"crafting_table","меч":"wooden_sword","кирку":"wooden_pickaxe",
    "топор":"wooden_axe","доски":"oak_planks","факел":"torch" };
  if (/скрафти|сделай|изготов|craft/.test(clean)) {
    for (const [ru, en] of Object.entries(craftMap)) {
      if (clean.includes(ru)) return { task: "craft", item: en };
    }
    return { task: "craft", item: "crafting_table" };
  }

  if (/исследуй|погуляй|explore|прогуляйс/.test(clean)) return { task: "explore" };

  const coordM = clean.match(/(-?\d+)\s+(-?\d+)\s+(-?\d+)/);
  if (coordM) return { task: "walk_to", x: parseInt(coordM[1]), y: parseInt(coordM[2]), z: parseInt(coordM[3]) };

  return null;
}

module.exports = { TaskManager, parseCommand };
