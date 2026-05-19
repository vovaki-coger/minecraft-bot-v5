/**
 * LobbyHandler v4.1 — автовыбор анки/ранга в лобби.
 * Ключевые исправления:
 *  - bot.clickWindow(slot, 0, 0) вместо window.click(slot) (правильный Mineflayer API)
 *  - Парсинг JSON-заголовков окон (mineflayer передаёт JSON-строки)
 *  - Надёжное определение окна выбора ранга
 */

const log = require("electron-log");

const LOBBY_KEYWORDS = [
  "lobby", "лобби", "hub", "хаб", "waiting", "ожидание",
  "select", "выбор", "choose", "rank", "ранг", "анка", "class",
];

const RANK_SELECT_KEYWORDS = [
  "выбери", "выберите", "select your", "choose your", "pick your",
  "class", "rank", "kit", "кит", "роль", "role", "анку", "анк",
  "profession", "профессия", "класс",
];

const RANK_NPC_NAMES = [
  "ранг", "rank", "class", "kit", "кит", "класс", "выбор", "select",
  "анка", "анк", "role", "роль", "профессия", "profession",
];

/** Парсит заголовок окна из JSON-строки mineflayer → plain text */
function parseWindowTitle(raw) {
  if (!raw) return "";
  try {
    const obj = JSON.parse(raw);
    if (typeof obj === "string") return obj;
    // Рекурсивно собираем текст из chat component
    function extract(o) {
      if (!o) return "";
      if (typeof o === "string") return o;
      let t = o.text || o.translate || "";
      if (Array.isArray(o.extra)) t += o.extra.map(extract).join("");
      if (Array.isArray(o.with)) t += o.with.map(extract).join("");
      return t;
    }
    return extract(obj);
  } catch {
    // Не JSON — возвращаем как есть
    return String(raw);
  }
}

class LobbyHandler {
  constructor(instance, emit) {
    this.instance = instance;
    this.emit = emit;
    this.inLobby = false;
    this.rankSelected = false;
    this.lobbyCheckTimer = null;
    this._windowOpenHandler = null;
    this.config = instance.config.lobbyConfig || {};
  }

  start() {
    const { bot } = this.instance;
    if (!bot) return;
    if (!this.config.enabled) {
      log.info("[LobbyHandler] Disabled by config");
      return;
    }
    log.info("[LobbyHandler] Starting for bot", this.instance.id);

    this._windowOpenHandler = (window) => this._onWindowOpen(window);
    bot.on("windowOpen", this._windowOpenHandler);
    bot.on("title", (text) => this._onTitle(text));

    // Первая проверка через 3 секунды после спавна
    this.lobbyCheckTimer = setTimeout(() => this._checkAndHandleLobby(), 3000);
  }

  stop() {
    if (this.lobbyCheckTimer) { clearTimeout(this.lobbyCheckTimer); this.lobbyCheckTimer = null; }
    if (this._windowOpenHandler && this.instance.bot) {
      this.instance.bot.removeListener("windowOpen", this._windowOpenHandler);
    }
    log.info("[LobbyHandler] Stopped");
  }

  onChatMessage(message) {
    const lower = message.toLowerCase();
    if (LOBBY_KEYWORDS.some(k => lower.includes(k)) && !this.inLobby) {
      log.info("[LobbyHandler] Lobby detected via chat:", message);
      this.inLobby = true;
    }
    if (RANK_SELECT_KEYWORDS.some(k => lower.includes(k)) && !this.rankSelected) {
      log.info("[LobbyHandler] Rank prompt detected:", message);
      setTimeout(() => this._trySelectRank(), 1500);
    }
  }

  _onTitle(text) {
    if (!text) return;
    const plain = parseWindowTitle(text);
    const lower = plain.toLowerCase();
    if (LOBBY_KEYWORDS.some(k => lower.includes(k))) {
      log.info("[LobbyHandler] Lobby detected via title:", plain);
      this.inLobby = true;
      if (!this.rankSelected) setTimeout(() => this._trySelectRank(), 2000);
    }
  }

  async _checkAndHandleLobby() {
    const { bot } = this.instance;
    if (!bot?.entity) return;

    // Наличие компаса = признак лобби
    const LOBBY_ITEMS = ["compass", "clock", "watch", "nether_star", "paper", "book"];
    const allItems = [...(bot.inventory?.items() || [])];
    for (let s = 36; s <= 44; s++) { const i = bot.inventory?.slots[s]; if (i) allItems.push(i); }
    const lobbyItem = allItems.find(i => LOBBY_ITEMS.includes(i.name));

    if (lobbyItem && !this.rankSelected) {
      log.info("[LobbyHandler] Found lobby item:", lobbyItem.name);
      this.inLobby = true;
      await this._trySelectRank();
      return;
    }

    if ((this.config.mode === "npc" || this.config.mode === "auto") && this.config.npcMode) {
      await this._tryFindAndClickNPC();
    }
  }

  async _trySelectRank() {
    if (this.rankSelected) return;
    const { bot } = this.instance;
    if (!bot?.entity) return;

    const mode = this.config.mode || "auto";

    if (mode === "compass" || mode === "auto") {
      const ok = await this._useCompass();
      if (ok) return;
    }
    if (mode === "npc" || mode === "auto") {
      await this._tryFindAndClickNPC();
    }
  }

  async _useCompass() {
    const { bot } = this.instance;
    if (!bot?.entity) return false;

    const COMPASS_NAMES = ["compass", "clock", "watch", "nether_star", "paper", "book"];
    let item = null;
    for (const name of COMPASS_NAMES) {
      item = bot.inventory?.items().find(i => i.name === name);
      if (item) break;
    }
    if (!item) {
      for (let s = 36; s <= 44; s++) {
        const si = bot.inventory?.slots[s];
        if (si && COMPASS_NAMES.includes(si.name)) { item = si; break; }
      }
    }
    if (!item) { log.info("[LobbyHandler] No compass/clock found"); return false; }

    try {
      log.info("[LobbyHandler] Equipping and using:", item.name);
      await bot.equip(item, "hand");
      await new Promise(r => setTimeout(r, 600));
      await bot.activateItem();
      await new Promise(r => setTimeout(r, 400));
      log.info("[LobbyHandler] Compass activated — waiting for window");
      return true;
    } catch (err) {
      log.warn("[LobbyHandler] Error using compass:", err.message);
      return false;
    }
  }

  async _tryFindAndClickNPC() {
    const { bot } = this.instance;
    if (!bot?.entity) return;

    const entities = Object.values(bot.entities || {});
    let npc = entities.find(e => {
      if (e === bot.entity) return false;
      const name = (e.displayName || e.name || e.username || "").toLowerCase();
      return RANK_NPC_NAMES.some(n => name.includes(n));
    });

    // Фоллбэк на ближайшего виллейджера
    if (!npc) {
      npc = entities.find(e =>
        e !== bot.entity &&
        (e.name === "villager" || e.name === "npc") &&
        e.position?.distanceTo(bot.entity.position) < 20
      );
    }

    if (!npc) { log.info("[LobbyHandler] No NPC found"); return; }
    log.info("[LobbyHandler] Found NPC:", npc.displayName || npc.name);
    await this._interactWithEntity(npc);
  }

  async _interactWithEntity(entity) {
    const { bot } = this.instance;
    if (!bot?.entity || !entity?.position) return;
    try {
      const { goals } = require("mineflayer-pathfinder");
      const dist = entity.position.distanceTo(bot.entity.position);
      if (dist > 4) {
        log.info("[LobbyHandler] Moving to NPC, dist:", dist);
        await bot.pathfinder.goto(
          new goals.GoalNear(entity.position.x, entity.position.y, entity.position.z, 2)
        ).catch(() => {});
        await new Promise(r => setTimeout(r, 500));
      }
      await bot.lookAt(entity.position.offset(0, 1, 0)).catch(() => {});
      await new Promise(r => setTimeout(r, 300));
      await bot.useOn(entity).catch(() => {});
      log.info("[LobbyHandler] Interacted with NPC");
    } catch (err) {
      log.warn("[LobbyHandler] NPC interact error:", err.message);
    }
  }

  async _onWindowOpen(window) {
    const { bot } = this.instance;
    if (!bot) return;

    const rawTitle = window?.title || "";
    const title = parseWindowTitle(rawTitle);
    const lower = title.toLowerCase();

    log.info("[LobbyHandler] windowOpen:", title, "| slots:", window?.slots?.length);

    // Проверяем заголовок — совпадает с кастомным?
    const customTitle = (this.config.rankWindowTitle || "").toLowerCase();
    if (customTitle && !lower.includes(customTitle)) return;

    // Без кастомного — проверяем по ключевым словам (или всё равно пробуем если мы в лобби)
    const isRankWindow = customTitle ||
      RANK_SELECT_KEYWORDS.some(k => lower.includes(k)) ||
      LOBBY_KEYWORDS.some(k => lower.includes(k)) ||
      this.inLobby;

    if (!isRankWindow) return;

    this.rankSelected = true;
    log.info("[LobbyHandler] Rank window detected:", title);

    // Ждём загрузки предметов в окне
    await new Promise(r => setTimeout(r, 800));

    // Убеждаемся что окно ещё открыто
    if (!bot.currentWindow) {
      log.warn("[LobbyHandler] Window closed before we could click");
      return;
    }

    const slotIndex = this.config.rankSlot ?? 0;
    const targetName = (this.config.rankName || "").toLowerCase();

    // Ищем по имени если задано
    if (targetName && bot.currentWindow.slots) {
      const foundSlot = bot.currentWindow.slots.find((s, i) => {
        if (!s) return false;
        const name = (s.customName || s.displayName || s.name || "").toLowerCase();
        return name.includes(targetName);
      });
      if (foundSlot) {
        const clickSlot = foundSlot.slot ?? foundSlot.index ?? 0;
        log.info("[LobbyHandler] Clicking by name:", foundSlot.displayName, "slot:", clickSlot);
        try {
          // ✅ Правильный Mineflayer API: bot.clickWindow(slot, mouseButton, mode)
          await bot.clickWindow(clickSlot, 0, 0);
          this._emitRankSelected(foundSlot.displayName || foundSlot.name);
        } catch (err) {
          log.warn("[LobbyHandler] clickWindow error:", err.message);
        }
        return;
      }
    }

    // Кликаем по индексу слота
    try {
      log.info("[LobbyHandler] Clicking slot by index:", slotIndex);
      // ✅ bot.clickWindow(slot, 0, 0) — единственный правильный способ в Mineflayer
      await bot.clickWindow(slotIndex, 0, 0);
      this._emitRankSelected("слот " + slotIndex);
    } catch (err) {
      log.warn("[LobbyHandler] clickWindow error:", err.message);
      this.rankSelected = false; // сбрасываем чтобы попробовать снова
    }
  }

  _emitRankSelected(rankName) {
    log.info("[LobbyHandler] Rank selected:", rankName);
    this.emit("bot:chat", {
      botId: this.instance.id,
      username: "system",
      message: `✅ Анка/ранг выбран: ${rankName}`,
      type: "system",
    });
  }
}

module.exports = { LobbyHandler };
