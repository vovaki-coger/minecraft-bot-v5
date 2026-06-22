/**
 * BotManager v4 — с LobbyHandler, улучшенным авто-логином и AIBrain.
 */

const mineflayer = require("mineflayer");
const { pathfinder, Movements, goals } = require("mineflayer-pathfinder");

// Дополнительные плагины майнфлаера для комфортной игры
let collectBlockPlugin = null;
let pvpPlugin = null;
let armorManagerPlugin = null;
try { collectBlockPlugin = require("mineflayer-collectblock").plugin; } catch(e) { /* не установлен */ }
try { pvpPlugin = require("mineflayer-pvp").plugin; } catch(e) { /* не установлен */ }
try { armorManagerPlugin = require("mineflayer-armor-manager"); } catch(e) { /* не установлен */ }
const { SocksProxyAgent } = require("socks-proxy-agent");
const { HttpProxyAgent } = require("http-proxy-agent");
const { HttpsProxyAgent } = require("https-proxy-agent");
const { v4: uuidv4 } = require("uuid");
const log = require("electron-log");
const { SurvivorAI } = require("./survivor-ai");
const { CaptchaHandler } = require("./captcha-handler");
const { TaskManager, parseCommand } = require("./bot-tasks");
const { parseAndy4Response, executeAndy4Command, isAndy4Model, stripThinkBlocks } = require("./andy4-parser");
const { AgentLoop } = require("./agent-loop");
const { AIBrain } = require("./ai-brain");
const { AnarchyProtocol } = require("./anarchy-protocol");
const { LobbyHandler } = require("./lobby-handler");
const { AntiDetect } = require("./anti-detect");

const RUSSIAN_OVERRIDE = `ВАЖНО: Ты общаешься НА РУССКОМ ЯЗЫКЕ. Все твои ответы должны быть на русском. `;

// Преобразуют NBT-объекты {type,value} в JS-примитивы (безопасная отправка через IPC)
function nbtToStr(v) {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "object" && v !== null) {
    // NBT формат { type, value }
    if ("value" in v) return nbtToStr(v.value);
    // ChatMessage объект (mineflayer 4.x возвращает готовый объект)
    if (typeof v.toString === "function") {
      const s = v.toString();
      if (s !== "[object Object]") return s;
    }
    // JSON text component: {text:"..."} or {translate:"..."}
    if (v.text != null) return String(v.text);
    if (v.translate != null) return String(v.translate);
    // extra/with arrays (chat components)
    if (Array.isArray(v.extra)) return v.extra.map(nbtToStr).join("");
  }
  return String(v);
}
function nbtToNum(v) {
  if (v == null) return 0;
  if (typeof v === "number") return v;
  if (typeof v === "object" && "value" in v) return Number(v.value) || 0;
  return Number(v) || 0;
}

// ── Паттерны авто-регистрации/логина ────────────────────────────────────────
// Расширенные паттерны для разных серверов
const REGISTER_PATTERNS = [
  /\/register/i, /зарегистрируйтесь/i, /register/i, /\/reg /i,
  /please register/i, /use \/register/i, /введите \/register/i,
  /вы не зарегистрированы/i, /not registered/i, /register to play/i,
  /create.*account/i, /создайте аккаунт/i,
];

const LOGIN_PATTERNS = [
  /\/login/i, /войдите/i, /авторизуйтесь/i, /login/i,
  /please log in/i, /use \/login/i, /введите \/login/i,
  /you must log in/i, /вы не авторизованы/i, /not logged in/i,
  /type \/login/i, /авторизируйся/i, /для входа/i, /чтобы войти/i, /войди/i,
  /please authenticate/i, /enter your password/i, /введите пароль/i,
];

class BotInstance {
  constructor(config, emit) {
    this.id = config.id || uuidv4();
    this.config = { ...config };
    this.bot = null;
    this.emit = emit;
    this.status = "offline";
    this.aiEnabled = config.aiEnabled !== false;
    this.chatHistory = [];
    this.aiChatHistory = []; // Отдельная история AI-чата (не идёт в Minecraft)
    this.survivorAI = null;
    this.captchaHandler = null;
    this.taskManager = null;
    this.agentLoop = null;
    this.aiBrain = null;
    this.anarchyProtocol = null;
    this.lobbyHandler = null;
    this.reconnectTimer = null;
    this._lastAIResponse = 0;
    this._authAttempted = false;
    this.stats = {
      health: 20, food: 20, armor: 0, experience: 0,
      x: 0, y: 0, z: 0, biome: "unknown",
      inventory: [], hotbarSlot: 0,
    };
  }

  getPublicState() {
    return {
      id: this.id,
      config: {
        nick: this.config.nick,
        host: this.config.host,
        port: this.config.port,
        version: this.config.version,
        aiEnabled: this.aiEnabled,
        aiModel: this.config.aiModel,
        aiMode: this.config.aiMode,
        systemPrompt: this.config.systemPrompt,
        proxy: this.config.proxy,
        autoLogin: this.config.autoLogin,
        autoRegister: this.config.autoRegister,
        autoResponse: this.config.autoResponse,
        lobbyConfig: this.config.lobbyConfig,
      },
      status: this.status,
      stats: this.stats,
      chatHistory: this.chatHistory.slice(-100),
      aiChatHistory: this.aiChatHistory.slice(-100),
      survivorMode: this.survivorAI?.isRunning || false,
      anarchyMode: this.anarchyProtocol?.isRunning || false,
    };
  }
}

class BotManager {
  constructor(configManager, ollamaManager, emit) {
    this.configManager = configManager;
    this.ollamaManager = ollamaManager;
    this.emit = emit;
    this.bots = new Map();

    for (const cfg of configManager.getBotConfigs()) {
      const instance = new BotInstance(cfg, emit);
      this.bots.set(instance.id, instance);
    }
  }

  createBot(config) {
    const fullConfig = { ...this.configManager.createDefaultBotConfig(), ...config };
    fullConfig.id = fullConfig.id || uuidv4();
    fullConfig.port = parseInt(fullConfig.port) || 25565;
    const instance = new BotInstance(fullConfig, this.emit);
    this.bots.set(instance.id, instance);
    this.configManager.saveBotConfig(fullConfig);
    this.emit("bot:created", instance.getPublicState());
    return instance.getPublicState();
  }

  async connectBot(botId) {
    const instance = this.bots.get(botId);
    if (!instance) throw new Error("Bot not found: " + botId);
    if (instance.bot) await this.disconnectBot(botId);

    instance.status = "connecting";
    instance._authAttempted = false;
    this.emit("bot:statusChanged", { botId, status: "connecting" });

    try {
      const opts = this._buildOptions(instance.config);
      instance.bot = mineflayer.createBot(opts);
      this._attachEvents(instance);
      return { success: true };
    } catch (err) {
      instance.status = "offline";
      this.emit("bot:statusChanged", { botId, status: "offline", error: err.message });
      throw err;
    }
  }

  _buildOptions(config) {
    const opts = {
      host: config.host,
      port: parseInt(config.port) || 25565,
      username: config.nick,
      version: config.version || "1.20.1",
      auth: config.authType === "microsoft" ? "microsoft" : "offline",
      hideErrors: false,
      checkTimeoutInterval: 60000,
    };
    const proxy = config.proxy || this.configManager.get("globalProxy", "");
    if (proxy) opts.agent = this._proxyAgent(proxy);
    return opts;
  }

  _proxyAgent(proxyStr) {
    try {
      let url = proxyStr;
      if (!url.includes("://")) url = "socks5://" + url;
      if (url.startsWith("socks4://") || url.startsWith("socks5://")) return new SocksProxyAgent(url);
      if (url.startsWith("https://")) return new HttpsProxyAgent(url);
      return new HttpProxyAgent(url);
    } catch (err) {
      log.error("Proxy agent error:", err.message);
      return null;
    }
  }

  _attachEvents(instance) {
    const { bot } = instance;
    const botId = instance.id;

    bot.loadPlugin(pathfinder);
    if (collectBlockPlugin) { try { bot.loadPlugin(collectBlockPlugin); } catch {} }
    if (pvpPlugin)          { try { bot.loadPlugin(pvpPlugin); } catch {} }
    if (armorManagerPlugin) { try { bot.loadPlugin(armorManagerPlugin); } catch {} }

    bot.once("spawn", () => {
      instance.status = "online";
      instance.captchaHandler = new CaptchaHandler(instance, this.ollamaManager);
      instance.taskManager = new TaskManager(instance, this.emit);
      instance.agentLoop = new AgentLoop(instance, this.emit);

      // === LobbyHandler v4 ===
      if (instance.config.lobbyConfig?.enabled !== false) {
        instance.lobbyHandler = new LobbyHandler(instance, this.emit);
        instance.lobbyHandler.start();
      }

      // === Попытка авто-логина при спавне ===
      // Многие серверы ждут когда бот загрузится и затем отправляют /login
      // Но некоторые сразу ждут — пробуем через 2 секунды
      if (instance.config.autoLogin || instance.config.autoRegister) {
        setTimeout(() => {
          this._tryInitialAuth(instance);
        }, 2000);
      }

      // === ИНИЦИАЛИЗАЦИЯ AI BRAIN (v4) ===
      if (instance.aiEnabled) {
        const configuredModel = instance.config.aiModel || "";
        const needsAutoDetect = !configuredModel || configuredModel === "auto";
        if (needsAutoDetect) {
          this.ollamaManager.getPreferredModel?.().then(preferred => {
            if (preferred) {
              instance.config.aiModel = preferred;
              log.info("[BotManager] Auto-selected model:", preferred);
              this.emit("bot:modelDetected", { botId, model: preferred });
            }
          }).catch(() => {});
        }

        instance.aiBrain = new AIBrain(
          instance,
          this.ollamaManager,
          instance.taskManager,
          this.emit
        );
        instance.aiBrain.startAutonomous(10000);
        log.info("[BotManager] AIBrain started for bot", botId);
      }

      const movements = new Movements(bot);
      // Не спринтим — спринт легко флагается анти-читом у нечеловечного бота
      movements.allowSprinting = false;
      movements.canDig = true;
      movements.allow1by1towers = false;
      // Жидкость дорогая — бот не ходит по воде (анти-NoSlow флаг)
      try { movements.liquidCost = 100; } catch {}
      try { movements.waterCost = 100; } catch {}
      // Не прыгаем с больших высот — предотвращаем flight/elytra флаги
      try { movements.maxDropDown = 3; } catch {}
      bot.pathfinder.setMovements(movements);

      // ── Vanilla physics: velocity clamp (анти-чит) ───────────────────
      {
        const WALK_MAX = 0.215;
        const TERM_VEL = 3.92;
        const _tickHandler = () => {
          if (!bot.entity) return;
          const vel = bot.entity.velocity;
          const hSq = vel.x * vel.x + vel.z * vel.z;
          if (hSq > WALK_MAX * WALK_MAX) {
            const scale = WALK_MAX / Math.sqrt(hSq);
            vel.x *= scale; vel.z *= scale;
          }
          if (vel.y < -TERM_VEL) vel.y = -TERM_VEL;
        };
        bot.on('physicsTick', _tickHandler);
        bot.once('end', () => { try { bot.removeListener('physicsTick', _tickHandler); } catch {} });
      }

      // ── onGround correction: исправляем флаг перед отправкой пакета ──
      {
        const _origWrite = bot._client.write.bind(bot._client);
        bot._client.write = function(name, params) {
          if ((name === 'position' || name === 'position_look') && params && bot.entity) {
            try {
              const below = bot.blockAt(bot.entity.position.offset(0, -0.1, 0));
              const actualOnGround = below && below.boundingBox === 'block'
                ? bot.entity.position.y - Math.floor(bot.entity.position.y) < 0.05
                : false;
              if (params.onGround && !actualOnGround && bot.entity.velocity.y < -0.1) {
                params = { ...params, onGround: false };
              }
            } catch {}
          }
          return _origWrite(name, params);
        };
        bot.once('end', () => { try { bot._client.write = _origWrite; } catch {} });
      }

      // ── Плавный поворот головы: lerp ~25°/тик (анти-KillAura флаг) ──
      {
        const _origLookAt = bot.lookAt.bind(bot);
        bot.lookAt = async function(point, force = false) {
          if (!bot.entity || !point) return _origLookAt(point, force);
          try {
            const dx = point.x - bot.entity.position.x;
            const dy = (point.y != null ? point.y : bot.entity.position.y + 1.62) - (bot.entity.position.y + 1.62);
            const dz = point.z - bot.entity.position.z;
            const tYaw   = Math.atan2(-dx, dz);
            const tPitch = Math.atan2(-dy, Math.sqrt(dx*dx + dz*dz));
            let dYaw = tYaw - bot.entity.yaw;
            while (dYaw >  Math.PI) dYaw -= 2 * Math.PI;
            while (dYaw < -Math.PI) dYaw += 2 * Math.PI;
            const dPitch = tPitch - bot.entity.pitch;
            const MAX_DEG = 0.44;
            const steps = Math.ceil(Math.max(Math.abs(dYaw), Math.abs(dPitch)) / MAX_DEG);
            if (steps <= 1 || force) return _origLookAt(point, force);
            const startYaw = bot.entity.yaw, startPitch = bot.entity.pitch;
            for (let i = 1; i <= steps; i++) {
              if (!bot.entity) break;
              const t = i / steps;
              bot.entity.yaw   = startYaw   + dYaw   * t;
              bot.entity.pitch = startPitch + dPitch * t;
              await new Promise(r => setTimeout(r, 50));
            }
            return _origLookAt(point, true);
          } catch { return _origLookAt(point, force); }
        };
      }

      // ── forcedMove: сервер скорректировал позицию (античит/телепорт) ─
      // НЕ сбрасываем pathfinder — он пересчитает маршрут сам с новой точки.
      // Сброс каждый forcedMove это главная причина почему бот делает 2 шага и стоит.
      bot.on('forcedMove', () => {
        log.info(`[Bot ${botId}] forcedMove — позиция скорректирована сервером`);
      });

      // ── kick_disconnect: логируем причину кика ────────────────────────
      bot._client?.on('kick_disconnect', (packet) => {
        log.warn(`[Bot ${botId}] kick_disconnect:`, packet.reason);
      });

      // ── Самооборона ──────────────────────────────────────────────────
      let prevHealth = bot.health || 20;
      bot.on('health', () => {
        if (!bot.entity) return;
        const newHealth = bot.health || 20;

        // Авто-еда при низком здоровье (< 14/20)
        if (newHealth < 14 && bot.food < 18) {
          const foodItem = bot.inventory.items()
            .filter(i => i.foodPoints && i.foodPoints > 0)
            .sort((a, b) => (b.foodPoints || 0) - (a.foodPoints || 0))[0];
          if (foodItem) {
            bot.equip(foodItem, "hand").then(() => bot.consume().catch(() => {})).catch(() => {});
          }
        }

        if (newHealth < prevHealth && instance.config.selfDefense !== false) {
          // Ищем атакующего среди ВСЕХ сущностей (игроки + мобы)
          let attacker = null, minDist = 7;
          for (const e of Object.values(bot.entities)) {
            if (!e.position || e === bot.entity) continue;
            const isPlayer = e.type === 'player' || (e.username && e.username !== bot.username);
            const isMob = e.type === 'mob' || e.type === 'hostile';
            if (!isPlayer && !isMob) continue;
            const dist = bot.entity.position.distanceTo(e.position);
            if (dist < minDist) { minDist = dist; attacker = e; }
          }
          if (attacker?.isValid) {
            this.emit("bot:alert", { botId, type: "attacked", title: "⚔️ Бот атакован!", message: "Ник: " + instance.config.nick + " | Атакует: " + (attacker.username||attacker.displayName||attacker.name||"моб") });
            // Передаём атакующего AgentLoop — он сам обработает с AntiDetect (плавный поворот, рандом тайминг)
            if (instance.agentLoop) {
              instance.agentLoop._registerAttacker(attacker);
            }
          }
        }
        prevHealth = newHealth;
      });
      this.emit("bot:statusChanged", { botId, status: "online" });
      this._addChat(instance, "system", "✅ Бот подключился к серверу. ИИ-мозг активирован.");

      // ── Inventory events — регистрируем ВНУТРИ spawn, когда bot.inventory готов ──
      const emitInv = () => this._emitInventory(instance, bot, botId);
      bot.inventory.on("updateSlot", emitInv);
      bot.on("playerCollect", emitInv);
      bot.on("entityEquip", (entity) => { if (entity === bot.entity) emitInv(); });
      bot.on("heldItemChanged", emitInv);
      instance._inventoryInterval = setInterval(emitInv, 5000);
      setTimeout(emitInv, 2000);
    });

    bot.on("health", () => {
      instance.stats.health = bot.health;
      instance.stats.food = bot.food;
      this.emit("bot:statsUpdated", { botId, stats: instance.stats });
    });

    // Throttle: обновляем координаты не чаще 1 раза в 2 секунды
    // (physicsTick = 20 раз/сек, прямая отправка IPC перегружает канал)
    let _tickCounter = 0;
    let _eatCooldown = 0;
    let _isEating = false;
    bot.on("physicsTick", () => {
      _tickCounter++;
      if (_tickCounter % 40 === 0 && bot.entity) {
        instance.stats.x = Math.round(bot.entity.position.x);
        instance.stats.y = Math.round(bot.entity.position.y);
        instance.stats.z = Math.round(bot.entity.position.z);
      }
      // ── Авто-еда: кушаем когда голод < 16/20 (раз в ~5 сек) ──────
      _eatCooldown++;
      if (_eatCooldown >= 100 && !_isEating && bot.entity && bot.food != null && bot.food < 16) {
        _eatCooldown = 0;
        const foodItem = bot.inventory.items()
          .filter(i => i.foodPoints && i.foodPoints > 0)
          .sort((a, b) => (b.foodPoints || 0) - (a.foodPoints || 0))[0];
        if (foodItem) {
          _isEating = true;
          bot.equip(foodItem, "hand")
            .then(() => bot.consume())
            .catch(() => {})
            .finally(() => { _isEating = false; });
        }
      }
    });

    bot.on("experience", () => {
      instance.stats.experience = bot.experience.level;
      this.emit("bot:statsUpdated", { botId, stats: instance.stats });
    });
    // ── Chat event: сообщения от игроков ──────────────────────────────────
    bot.on("chat", async (username, message) => {
      if (username === bot.username) return;

      this._addChat(instance, "player", "[" + username + "]: " + message);
      this.emit("bot:chat", { botId, username, message, type: "player" });

      // Сообщаем лобби-хандлеру
      instance.lobbyHandler?.onChatMessage(message);

      // Проверяем авто-логин/регистрацию по chat-событию
      await this._handleAutoLogin(instance, message);
      await instance.captchaHandler?.handleChatCaptcha(message);

      if (instance.config.autoResponse && instance.aiEnabled) {
        await this._handlePlayerMessage(instance, username, message);
      }
    });

    // ── Message event: системные сообщения сервера (JSON-чат) ─────────────
    bot.on("message", (jsonMsg) => {
      const text = jsonMsg.toString();
      this._addChat(instance, "server", text);
      this.emit("bot:serverMessage", { botId, text });

      // ВАЖНО: многие серверы отправляют /login и /register через message, не chat
      // Поэтому проверяем авто-логин и здесь
      this._handleAutoLoginFromMessage(instance, text);

      // Сообщаем лобби-хандлеру
      instance.lobbyHandler?.onChatMessage(text);

      // Если сервер прислал HALTED / Invalid move — немедленно останавливаем движение
      if (text.includes("HALTED") || text.includes("Invalid move") || text.includes("moved too quickly")) {
        try { bot.clearControlStates(); } catch {}
        try { bot.pathfinder.stop(); } catch {}
        log.warn("[BotManager] Anti-cheat triggered, movement stopped for bot", botId);
      }
    });

    bot.on("death", () => {
      this._addChat(instance, "system", "💀 Бот умер! Позиция: " + Math.round(instance.stats?.x||0) + " " + Math.round(instance.stats?.y||0) + " " + Math.round(instance.stats?.z||0));
      this.emit("bot:death", { botId, nick: instance.config.nick, pos: instance.stats, timestamp: Date.now() });
      this.emit("bot:alert", { botId, type: "death", title: "💀 Бот умер!", message: "Ник: " + instance.config.nick + " | Сервер: " + instance.config.host, nick: instance.config.nick });
      instance.survivorAI?.onDeath();
    });

    bot.on("kicked", (reason) => {
      instance.status = "offline";
      instance.agentLoop?.stop();
      instance.agentLoop = null;
      instance.aiBrain?.stopAutonomous();
      instance.anarchyProtocol?.stop();
      instance.lobbyHandler?.stop();
      instance.lobbyHandler = null;
      this._addChat(instance, "system", "⚠️ Кик: " + reason);
      this.emit("bot:statusChanged", { botId, status: "offline", reason });
      this._scheduleReconnect(instance);
    });

    bot.on("end", (reason) => {
      instance.status = "offline";
      instance.agentLoop?.stop();
      instance.agentLoop = null;
      instance.aiBrain?.stopAutonomous();
      instance.anarchyProtocol?.stop();
      instance.lobbyHandler?.stop();
      instance.lobbyHandler = null;
      if (instance._inventoryInterval) {
        clearInterval(instance._inventoryInterval);
        instance._inventoryInterval = null;
      }
      this.emit("bot:statusChanged", { botId, status: "offline", reason });
      this._scheduleReconnect(instance);
    });


    // ── Окна инвентаря (для рекордера анки) ───────────────────────────────
    const parseWindowTitle = (raw) => {
      const extractText = (node) => {
        if (!node) return "";
        if (typeof node === "string") return node;
        let text = String(node.text || node.translate || "");
        if (Array.isArray(node.extra)) text += node.extra.map(extractText).join("");
        if (Array.isArray(node.with)) text += node.with.map(extractText).join(" ");
        return text;
      };
      try {
        // win.title может уже быть объектом (mineflayer распарсил JSON сам)
        if (raw != null && typeof raw === "object") {
          return extractText(raw).trim() || "";
        }
        if (!raw) return "";
        const p = JSON.parse(raw);
        return extractText(p).trim() || String(raw);
      } catch {
        // Если не JSON — вернуть как строку (никогда объект)
        return raw != null ? String(raw) : "";
      }
    };

    const emitWindowSlots = (win) => {
      if (!win) return;
      const title = parseWindowTitle(win.title || "");
      const slots = [];
      const winSlots = win.slots || [];
      // inventoryStart = первый слот инвентаря игрока (только слоты самого окна)
      // Используем inventoryStart если он > 0, иначе берём длину массива (до 54)
      const slotCount = (win.inventoryStart != null && win.inventoryStart > 0)
        ? win.inventoryStart
        : Math.min(winSlots.length, 54);
      // Если вообще нет слотов — не шлём пустое окно, ждём updateSlot
      if (slotCount === 0) return;
      for (let i = 0; i < slotCount; i++) {
        const item = winSlots[i];
        // Убираем префикс "minecraft:" из имён предметов
        const rawName = item ? nbtToStr(item.name) : "";
        const name = rawName.replace(/^minecraft:/, "");
        const rawDisplay = item ? nbtToStr(item.displayName) : "";
        const displayName = rawDisplay.replace(/^minecraft:/, "") || name.replace(/_/g, " ");
        slots.push({
          slot: i,
          name,
          displayName,
          count: item ? nbtToNum(item.count) : 0,
        });
      }
      this.emit("bot:windowOpen", { botId, window: { title, slots } });
    };

    bot.on("windowOpen", (win) => {
      try {
        log.info(`[BotManager] windowOpen: "${win?.title}" slots=${win?.slots?.length} invStart=${win?.inventoryStart}`);
        emitWindowSlots(win);

        // Дебаунс: собираем все updateSlot за 80ms и шлём один раз
        let slotDebounceTimer = null;
        const debouncedEmit = () => {
          if (slotDebounceTimer) clearTimeout(slotDebounceTimer);
          slotDebounceTimer = setTimeout(() => {
            slotDebounceTimer = null;
            try {
              if (bot.currentWindow === win) emitWindowSlots(win);
            } catch (e) {
              log.warn(`[BotManager] debounced emit error: ${e.message}`);
            }
          }, 80);
        };

        // Первая отправка через 150ms — к этому моменту сервер уже прислал предметы
        setTimeout(() => {
          try {
            if (bot.currentWindow === win) emitWindowSlots(win);
          } catch (e) {
            log.warn(`[BotManager] windowOpen initial emit error: ${e.message}`);
          }
        }, 150);

        // Подписываемся на обновление отдельных слотов (с дебаунсом)
        if (win && typeof win.on === "function") {
          win.on("updateSlot", debouncedEmit);
        }
      } catch (err) {
        log.error(`[BotManager] windowOpen handler crashed: ${err.message}`);
      }
    });

    bot.on("windowClose", () => {
      try {
        log.info(`[BotManager] windowClose botId=${botId}`);
        this.emit("bot:windowClose", { botId });
      } catch (err) {
        log.warn(`[BotManager] windowClose handler error: ${err.message}`);
      }
    });
    bot.on("error", (err) => {
      log.error("Bot " + botId + " error:", err.message);
      this.emit("bot:error", { botId, error: err.message });
    });
  }

  // ── Первоначальная авто-аутентификация при спавне ─────────────────────────
  async _tryInitialAuth(instance) {
    const pass = this.configManager.getGlobalPassword();
    if (!pass) return;
    setTimeout(() => {
      if (instance._authAttempted || !instance.bot) return;
      if (!instance.config.autoLogin) return;
      log.info("[BotManager] No auth prompt received, trying /login proactively");
      instance._authAttempted = true;
      instance.bot.chat("/login " + pass);
      this._addChat(instance, "system", "🔑 Авто-логин (без приглашения)");
    }, 5000);
  }

  // ── Обработка авто-логина из chat-события ────────────────────────────────
  async _handleAutoLogin(instance, message) {
    const pass = this.configManager.getGlobalPassword();
    if (!pass) return;
    const m = message.toLowerCase();

    if (instance.config.autoRegister && REGISTER_PATTERNS.some(p => p.test(m))) {
      if (!instance._authAttempted) {
        instance._authAttempted = true;
        log.info("[BotManager] Auto-register triggered by chat:", message);
        setTimeout(() => {
          if (instance.bot) {
            instance.bot.chat("/register " + pass + " " + pass);
            this._addChat(instance, "system", "🔑 Авто-регистрация выполнена");
          }
        }, 1000);
      }
    } else if (instance.config.autoLogin && !instance._authAttempted && LOGIN_PATTERNS.some(p => p.test(m))) {
      instance._authAttempted = true;
      log.info("[BotManager] Auto-login triggered by chat:", message);
      setTimeout(() => {
        if (instance.bot) {
          instance.bot.chat("/login " + pass);
          this._addChat(instance, "system", "🔑 Авто-логин выполнен");
        }
      }, 1000);
    }
  }

  // ── Обработка авто-логина из message-события (JSON-чат сервера) ──────────
  _handleAutoLoginFromMessage(instance, text) {
    const pass = this.configManager.getGlobalPassword();
    if (!pass) return;
    const lower = text.toLowerCase();

    const needsRegister = instance.config.autoRegister &&
      !instance._authAttempted &&
      REGISTER_PATTERNS.some(p => p.test(lower));

    const needsLogin = instance.config.autoLogin &&
      !instance._authAttempted &&
      LOGIN_PATTERNS.some(p => p.test(lower));

    if (needsRegister) {
      instance._authAttempted = true;
      log.info("[BotManager] Auto-register triggered by message event");
      setTimeout(() => {
        if (instance.bot) {
          instance.bot.chat("/register " + pass + " " + pass);
          this._addChat(instance, "system", "🔑 Авто-регистрация выполнена");
        }
      }, 1200);
    } else if (needsLogin) {
      log.info("[BotManager] Auto-login triggered by message event");
      setTimeout(() => {
        if (instance.bot) {
          instance.bot.chat("/login " + pass);
          this._addChat(instance, "system", "🔑 Авто-логин выполнен");
          instance._authAttempted = true;
        }
      }, 1200);
    }
  }

  // ══════════════════════════════════════════════════════════════════════
  // ОБРАБОТКА СООБЩЕНИЙ — через AIBrain (v4)
  // ══════════════════════════════════════════════════════════════════════

  async _handlePlayerMessage(instance, username, message) {
    if (!instance.bot?.entity) return;

    const scriptCmd = parseCommand(message, instance.config.nick);
    if (scriptCmd) {
      log.info("[Script] Task:", scriptCmd.task);
      if (scriptCmd.task === "come_to" || scriptCmd.task === "follow") scriptCmd.player = username;
      instance.taskManager?.runTask(scriptCmd.task, scriptCmd).catch((e) =>
        log.error("Task error:", e.message)
      );
      return;
    }

    const now = Date.now();
    if (now - instance._lastAIResponse < 3000) return;
    instance._lastAIResponse = now;

    if (instance.aiBrain && instance.aiEnabled) {
      log.info("[BotManager] Routing to AIBrain:", username, message);
      await instance.aiBrain.respondToPlayer(username, message);
      return;
    }

    await this._legacyAIRespond(instance, username, message);
  }

  async _legacyAIRespond(instance, username, message) {
    if (!instance.aiEnabled || !instance.bot) return;

    const useAndy4 = isAndy4Model(instance.config.aiModel);
    const ctx = this._buildLegacyContext(instance);
    let sysPrompt = instance.config.systemPrompt || "";

    if (useAndy4) {
      sysPrompt = RUSSIAN_OVERRIDE + "Ты Minecraft-бот. Отвечай на русском.\n" + ctx;
    } else {
      sysPrompt = (sysPrompt || "") + "\n\nСостояние: " + ctx +
        "\nОтвечай по-русски. Для действий: {\"action\":\"chat\",\"message\":\"текст\"}";
    }

    try {
      const response = await this.ollamaManager.chat({
        model: instance.config.aiModel || "llama3",
        mode: instance.config.aiMode || "local",
        apiKey: instance.config.apiKey,
        apiProvider: instance.config.apiProvider,
        systemPrompt: sysPrompt,
        messages: [{ role: "user", content: username + ": " + message }],
      });

      if (!response?.content) return;
      const rawText = stripThinkBlocks(response.content.trim());

      if (useAndy4) {
        await this._handleAndy4Response(instance, rawText, username);
      } else {
        await this._handleJsonResponse(instance, rawText, username);
      }
    } catch (err) {
      log.error("Legacy AI respond error:", err.message);
    }
  }

  async _handleAndy4Response(instance, rawText, username) {
    const { chatText, commands } = parseAndy4Response(rawText);
    for (const cmd of commands) {
      const executed = await executeAndy4Command(cmd, instance, instance.taskManager);
      if (executed) log.info("[Andy4 exec]", cmd.name, cmd.args);
    }
    if (chatText && chatText.length > 0) {
      this._sendBotChat(instance, chatText.slice(0, 100));
    }
  }

  async _handleJsonResponse(instance, rawText, username) {
    const jsonMatch = rawText.match(/\{[\s\S]*?\}/);
    if (jsonMatch) {
      try {
        const cmd = JSON.parse(jsonMatch[0]);
        if (cmd.action === "walk_to" && cmd.x !== undefined) {
          instance.taskManager?.runTask("walk_to", { x: cmd.x, y: cmd.y, z: cmd.z });
        } else if (cmd.action === "follow") {
          instance.taskManager?.runTask("follow", { player: cmd.target || username });
        } else if (cmd.action === "chat" && cmd.message) {
          this._sendBotChat(instance, String(cmd.message).slice(0, 100));
        } else if (cmd.action === "attack") {
          instance.taskManager?.runTask("attack", { target: cmd.target });
        }
        return;
      } catch {}
    }
    const reply = rawText.replace(/\{[\s\S]*?\}/g, "").trim().slice(0, 100);
    if (reply) this._sendBotChat(instance, reply);
  }


  _emitInventory(instance, bot, botId) {
    try {
      const items = bot.inventory.items();
      const equipped = [
        bot.inventory.slots[5],  // helmet
        bot.inventory.slots[6],  // chestplate
        bot.inventory.slots[7],  // leggings
        bot.inventory.slots[8],  // boots
        bot.entity?.heldItem,    // held
      ].filter(Boolean);

      const allItems = [...items];
      for (const eq of equipped) {
        if (eq && !allItems.find(i => i.slot === eq.slot)) allItems.push(eq);
      }

      const inventory = allItems.map(item => {
        const name = nbtToStr(item.name);
        const displayName = nbtToStr(item.displayName) || name.replace(/_/g, " ");
        return {
          slot: typeof item.slot === "number" ? item.slot : nbtToNum(item.slot),
          name,
          displayName,
          count: nbtToNum(item.count),
        };
      }).filter(i => i.slot >= 0 && i.slot <= 200);

      const hotbarSlot = bot.quickBarSlot ?? 0;
      instance.stats.inventory = inventory;
      instance.stats.hotbarSlot = hotbarSlot;
      this.emit("bot:inventoryUpdated", { botId, inventory, hotbarSlot });
    } catch (err) {
      log.warn("[BotManager] _emitInventory error:", err.message);
    }
  }

  _sendBotChat(instance, text) {
    if (!instance.bot || !text) return;
    instance.bot.chat(text);
    this._addChat(instance, "bot", text);
    this.emit("bot:chat", {
      botId: instance.id, username: instance.config.nick, message: text, type: "bot",
    });
  }

  _buildLegacyContext(instance) {
    const s = instance.stats;
    const inv = instance.bot?.inventory.items().slice(0, 8)
      .map((i) => i.name + "x" + i.count).join(", ") || "пусто";
    return "HP=" + s.health + "/20 Еда=" + s.food + "/20 X=" + s.x + " Y=" + s.y + " Z=" + s.z + " Инв:[" + inv + "]";
  }

  _addChat(instance, type, text) {
    instance.chatHistory.push({ type, text, timestamp: Date.now() });
    if (instance.chatHistory.length > 500) instance.chatHistory.shift();
  }

  _addAIChat(instance, type, text) {
    instance.aiChatHistory.push({ type, text, timestamp: Date.now() });
    if (instance.aiChatHistory.length > 200) instance.aiChatHistory.shift();
    this.emit("bot:aiChatMessage", { botId: instance.id, message: { type, text, timestamp: Date.now() } });
  }

  _scheduleReconnect(instance) {
    if (!instance.config.autoReconnect) return;
    if (instance.reconnectTimer) clearTimeout(instance.reconnectTimer);
    instance.reconnectTimer = setTimeout(() => {
      log.info("Auto-reconnecting", instance.id);
      this.connectBot(instance.id).catch((e) => log.error("Reconnect failed:", e.message));
    }, instance.config.reconnectDelay || 5000);
  }

  async disconnectBot(botId) {
    const instance = this.bots.get(botId);
    if (!instance) return;
    if (instance.reconnectTimer) { clearTimeout(instance.reconnectTimer); instance.reconnectTimer = null; }
    instance.config.autoReconnect = false;
    instance.aiBrain?.stopAutonomous();
    instance.anarchyProtocol?.stop();
    instance.lobbyHandler?.stop();
    instance.lobbyHandler = null;
    instance.agentLoop?.stop();
    instance.agentLoop = null;
    instance.antiDetect?.stop();
    instance.antiDetect = null;
    if (instance.survivorAI?.isRunning) await instance.survivorAI.stop().catch(() => {});
    if (instance.taskManager) await instance.taskManager.stopAll().catch(() => {});
    if (instance.bot) { try { instance.bot.quit(); } catch {} instance.bot = null; }
    instance.status = "offline";
    this.emit("bot:statusChanged", { botId, status: "offline" });
  }

  deleteBot(botId) {
    this.disconnectBot(botId);
    this.bots.delete(botId);
    this.configManager.deleteBotConfig(botId);
    this.emit("bot:deleted", { botId });
    return { success: true };
  }

  sendChat(botId, message) {
    const instance = this.bots.get(botId);
    if (!instance) return;
    if (instance.bot && instance.status === "online") {
      instance.bot.chat(message);
      this._addChat(instance, "bot", message);
      this.emit("bot:chat", { botId, username: instance.config.nick, message, type: "bot" });
    } else {
      this._offlineAIChat(instance, message);
    }
  }

  // ── Отправка только в AI, без записи в Minecraft-чат ─────────────────────
  async sendAIOnly(botId, message) {
    const instance = this.bots.get(botId);
    if (!instance) return;

    this._addAIChat(instance, "user", message);

    if (!instance.aiEnabled) {
      this._addAIChat(instance, "system", "ИИ отключён");
      return;
    }

    try {
      const sysPrompt = RUSSIAN_OVERRIDE + (instance.config.systemPrompt ||
        "Ты умный помощник по Minecraft. Отвечай по-русски. Ты общаешься с оператором, не пишешь в игровой чат.");

      // Используем AIBrain если доступен
      if (instance.aiBrain && instance.status === "online") {
        const response = await instance.aiBrain.askPrivate(message);
        if (response) {
          this._addAIChat(instance, "ai", response);
        }
        return;
      }

      const response = await this.ollamaManager.chat({
        model: instance.config.aiModel || "llama3",
        mode: instance.config.aiMode || "local",
        apiKey: instance.config.apiKey,
        apiProvider: instance.config.apiProvider,
        systemPrompt: sysPrompt,
        messages: [{ role: "user", content: message }],
      });
      if (response?.content) {
        const cleaned = stripThinkBlocks(response.content);
        this._addAIChat(instance, "ai", cleaned);
      }
    } catch (err) {
      this._addAIChat(instance, "system", "Ошибка ИИ: " + err.message);
    }
  }

  async _offlineAIChat(instance, message) {
    this._addChat(instance, "user", message);
    this.emit("bot:chat", { botId: instance.id, username: "Вы", message, type: "user" });
    if (!instance.aiEnabled) return;
    try {
      const response = await this.ollamaManager.chat({
        model: instance.config.aiModel || "llama3",
        mode: instance.config.aiMode || "local",
        apiKey: instance.config.apiKey,
        apiProvider: instance.config.apiProvider,
        systemPrompt: RUSSIAN_OVERRIDE + (instance.config.systemPrompt || "Ты умный помощник по Minecraft. Отвечай по-русски."),
        messages: [{ role: "user", content: message }],
      });
      if (response?.content) {
        const cleaned = stripThinkBlocks(response.content);
        this._addChat(instance, "ai", cleaned);
        this.emit("bot:aiMessage", { botId: instance.id, message: cleaned });
      }
    } catch (err) {
      this._addChat(instance, "system", "Ошибка ИИ: " + err.message);
    }
  }

  stopAction(botId) {
    const instance = this.bots.get(botId);
    if (!instance) return;
    instance.aiBrain?.stopAutonomous();
    instance.taskManager?.stopAll();
    instance.survivorAI?.stop();
    this._addChat(instance, "system", "⛔ Действие остановлено");
    this.emit("bot:actionStopped", { botId });
  }

  stopMovement(botId) {
    const instance = this.bots.get(botId);
    if (!instance?.bot) return;
    try { instance.bot.pathfinder?.stop(); } catch {}
    try { instance.bot.clearControlStates(); } catch {}
    this._addChat(instance, "system", "🚫 Движение остановлено");
  }

  async startSurvivorMode(botId) {
    const instance = this.bots.get(botId);
    if (!instance?.bot) throw new Error("Бот не подключён");
    if (!instance.aiEnabled) throw new Error("ИИ отключён у этого бота");
    instance.aiBrain?.stopAutonomous();
    instance.survivorAI = new SurvivorAI(instance, this.ollamaManager, this.emit);
    await instance.survivorAI.start();
    this.emit("bot:survivorStarted", { botId });
    return { success: true };
  }

  async stopSurvivorMode(botId) {
    const instance = this.bots.get(botId);
    if (instance?.survivorAI) {
      await instance.survivorAI.stop().catch(() => {});
      instance.survivorAI = null;
    }
    if (instance?.aiBrain && instance?.aiEnabled) {
      instance.aiBrain.startAutonomous(10000);
    }
    this.emit("bot:survivorStopped", { botId });
    return { success: true };
  }

  setNick(botId, nick) {
    const instance = this.bots.get(botId);
    if (!instance) throw new Error("Bot not found");
    instance.config.nick = nick;
    this.configManager.saveBotConfig(instance.config);
    this._addChat(instance, "system", "✏️ Ник изменён на " + nick);
    return { success: true };
  }

  toggleAI(botId, enabled) {
    const instance = this.bots.get(botId);
    if (!instance) throw new Error("Bot not found");
    instance.aiEnabled = enabled;
    instance.config.aiEnabled = enabled;
    this.configManager.saveBotConfig(instance.config);
    if (enabled && instance.bot && instance.status === "online" && !instance.aiBrain) {
      instance.aiBrain = new AIBrain(instance, this.ollamaManager, instance.taskManager, this.emit);
      instance.aiBrain.startAutonomous(10000);
    } else if (!enabled && instance.aiBrain) {
      instance.aiBrain.stopAutonomous();
    }
    this.emit("bot:aiToggled", { botId, aiEnabled: enabled });
    return { success: true };
  }

  updateBotConfig(botId, config) {
    const instance = this.bots.get(botId);
    if (!instance) throw new Error("Bot not found");
    Object.assign(instance.config, config);
    this.configManager.saveBotConfig(instance.config);
    return instance.getPublicState();
  }

  async testProxy(proxyStr) {
    try {
      const agent = this._proxyAgent(proxyStr);
      const { default: fetch } = await import("node-fetch");
      const resp = await fetch("https://api.ipify.org?format=json", { agent, timeout: 10000 });
      const data = await resp.json();
      return { success: true, ip: data.ip };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }


  // ── Запуск/остановка скриптовой задачи ───────────────────────────────────
  async runBotTask(botId, taskName, args) {
    const instance = this.bots.get(botId);
    if (!instance?.bot || instance.status !== "online") throw new Error("Бот не в сети");
    if (!instance.taskManager) {
      const { TaskManager } = require("./bot-tasks");
      instance.taskManager = new TaskManager(instance, this.emit);
    }
    this.emit("bot:taskStarted", { botId, task: taskName });
    instance.taskManager.runTask(taskName, args || {}).then(() => {
      this.emit("bot:taskStopped", { botId, task: taskName });
    }).catch(err => {
      this.emit("bot:taskStopped", { botId, task: taskName, error: err.message });
    });
    return { success: true, task: taskName };
  }

  stopBotTask(botId) {
    const instance = this.bots.get(botId);
    if (!instance?.taskManager) return { success: false };
    instance.taskManager.stopAll().catch(() => {});
    this.emit("bot:taskStopped", { botId });
    return { success: true };
  }

  async startAnarchyProtocol(botId, opts) {
    const instance = this.bots.get(botId);
    if (!instance?.bot) throw new Error("Бот не подключён");
    instance.survivorAI?.stop();
    instance.aiBrain?.stopAutonomous();
    if (!instance.anarchyProtocol) {
      instance.anarchyProtocol = new AnarchyProtocol(instance, this.ollamaManager, this.emit);
    }
    await instance.anarchyProtocol.start(opts);
    return { success: true };
  }

  stopAnarchyProtocol(botId) {
    const instance = this.bots.get(botId);
    if (!instance) return { success: false };
    instance.anarchyProtocol?.stop();
    if (instance.aiBrain && instance.aiEnabled) {
      instance.aiBrain.startAutonomous(10000);
    }
    return { success: true };
  }

  getAnarchyState(botId) {
    const instance = this.bots.get(botId);
    if (!instance?.anarchyProtocol) {
      return { isRunning: false, task: "", homeCommand: "/home", phase: "idle", cycleCount: 0, log: [] };
    }
    return instance.anarchyProtocol.getState();
  }

  // Ручное управление лобби
  triggerLobbyRank(botId) {
    const instance = this.bots.get(botId);
    if (!instance?.lobbyHandler) {
      // Создаём на лету если не было
      if (instance?.bot && instance.status === "online") {
        instance.lobbyHandler = new LobbyHandler(instance, this.emit);
        instance.lobbyHandler._trySelectRank();
      }
      return { success: false, error: "Лобби-хандлер не активен" };
    }
    instance.lobbyHandler.rankSelected = false; // сброс флага
    instance.lobbyHandler._trySelectRank();
    return { success: true };
  }

  getAllBots() {
    return Array.from(this.bots.values()).map((b) => b.getPublicState());
  }

  async disconnectAll() {
    for (const [botId] of this.bots) await this.disconnectBot(botId).catch(() => {});
  }

  // ── Живой клик по слоту (ЛКМ/ПКМ) из UI ─────────────────────────────────
  async clickBotSlot(botId, slot, button = 0) {
    const instance = this.bots.get(botId);
    if (!instance?.bot) throw new Error("Бот не подключён");
    const bot = instance.bot;

    // ── Случай 1: у бота открыто окно (сундук / меню лобби) ──────────────
    if (bot.currentWindow) {
      await bot.clickWindow(slot, button, 0);
      log.info(`[AnkaLive] clickWindow slot=${slot} button=${button} window="${bot.currentWindow.title}"`);
      return { success: true, mode: "window" };
    }

    // ── Случай 2: хотбар (mineflayer слоты 36–44, или 0–8 в UI) ──────────
    // mineflayer: bot.inventory.items() возвращает слоты 36–44 для хотбара
    const isHotbar = (slot >= 36 && slot <= 44) || (slot >= 0 && slot <= 8);
    const hotbarIndex = slot >= 36 ? slot - 36 : slot;   // 0–8

    if (isHotbar) {
      // Сначала выбираем слот
      bot.setQuickBarSlot(hotbarIndex);
      log.info(`[AnkaLive] setQuickBarSlot(${hotbarIndex}) button=${button}`);

      if (button === 1) {
        // ПКМ — использовать предмет (открыть сундук/меню, съесть, и т.д.)
        await new Promise(r => setTimeout(r, 150));
        bot.activateItem();
        log.info(`[AnkaLive] activateItem() — ожидаем windowOpen от сервера`);
      }
      return { success: true, mode: "hotbar", hotbarIndex };
    }

    // ── Случай 3: основной инвентарь (слоты 9–35) ────────────────────────
    // clickWindow работает для инвентаря без явного открытия окна
    try {
      await bot.clickWindow(slot, button, 0);
      log.info(`[AnkaLive] inventory clickWindow slot=${slot} button=${button}`);
    } catch (err) {
      log.warn(`[AnkaLive] inventory clickWindow failed: ${err.message}`);
    }
    return { success: true, mode: "inventory" };
  }

  // ── Воспроизведение анки ──────────────────────────────────────────────────
  async playAnkaProfile(botId, steps) {
    const instance = this.bots.get(botId);
    if (!instance?.bot) throw new Error("Бот не подключён");

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      // Ждём нужное окно
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("Окно не открылось (таймаут)")), 8000);
        const checkNow = () => {
          const w = instance.bot.currentWindow;
          if (!w) return false;
          let rawTitle = w.title || "";
          let title = rawTitle;
          try { const p = JSON.parse(rawTitle); title = p.text || p.translate || rawTitle; } catch {}
          if (!step.windowTitle || title.includes(step.windowTitle) || step.windowTitle.includes(title) || title === "") {
            clearTimeout(timeout);
            resolve();
            return true;
          }
          return false;
        };
        if (!checkNow()) {
          const handler = () => { if (checkNow()) instance.bot.removeListener("windowOpen", handler); };
          instance.bot.on("windowOpen", handler);
        }
      });

      // Кликаем слот
      if (instance.bot.currentWindow) {
        await instance.bot.clickWindow(step.slot, step.button || 0, 0);
        log.info("[AnkaPlay] Clicked slot", step.slot, "in window", step.windowTitle);
      }

      // Ждём паузу между кликами
      const delay = Math.max(200, Math.min(step.delay || 500, 3000));
      await new Promise(r => setTimeout(r, delay));
    }
    return { success: true };
  }
}

module.exports = { BotManager };
