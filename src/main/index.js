const { app, BrowserWindow, ipcMain, dialog, shell } = require("electron");
const path = require("path");
const { OllamaManager } = require("./ollama-manager");
const { BotManager } = require("./bot-manager");
const { CoordinatorServer } = require("./coordinator");
const { ConfigManager } = require("./config-manager");
const AnkaRecorder = require("./anka-recorder");
const log = require("electron-log");

log.initialize({ preload: true });
log.transports.file.level = "debug";

const isDev = process.env.NODE_ENV === "development";

let mainWindow = null;
let ollamaManager = null;
let botManager = null;
let coordinatorServer = null;
let configManager = null;
let ankaRecorder = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: "#0d1117",
    titleBarStyle: "default",
    title: "Призмарин Бот v5.0",
    icon: path.join(__dirname, "../../assets/icon.png"),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, "../preload/index.js"),
      webSecurity: !isDev,
    },
  });

  if (isDev) {
    mainWindow.loadURL("http://localhost:3456");
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, "../../dist/index.html"));
  }

  mainWindow.on("closed", () => { mainWindow = null; });
}

async function initialize() {
  configManager = new ConfigManager();
  ollamaManager = new OllamaManager(configManager);
  botManager = new BotManager(configManager, ollamaManager, (event, data) => {
    if (mainWindow) mainWindow.webContents.send(event, data);
  });
  coordinatorServer = new CoordinatorServer(botManager, (event, data) => {
    if (mainWindow) mainWindow.webContents.send(event, data);
  });

  ankaRecorder = new AnkaRecorder();
  setupIpcHandlers();
  await coordinatorServer.start();
}

function setupIpcHandlers() {
  // ── Config ───────────────────────────────────────────────────────────────
  ipcMain.handle("config:get", () => configManager.getAll());
  ipcMain.handle("config:set", (_e, key, value) => configManager.set(key, value));
  ipcMain.handle("config:setGlobalPassword", (_e, pw) => configManager.setGlobalPassword(pw));
  ipcMain.handle("config:getGlobalPassword", () => configManager.getGlobalPassword());

  // ── Ollama ───────────────────────────────────────────────────────────────
  ipcMain.handle("ollama:check", () => ollamaManager.checkOllama());
  ipcMain.handle("ollama:install", () => ollamaManager.installOllama());
  ipcMain.handle("ollama:listModels", () => ollamaManager.listModels());
  ipcMain.handle("ollama:listInstalledModels", () => ollamaManager.listInstalledModels());
  ipcMain.handle("ollama:pullModel", (_e, modelName) =>
    ollamaManager.pullModel(modelName, (progress) => {
      if (mainWindow) mainWindow.webContents.send("ollama:pullProgress", { modelName, progress });
    })
  );
  ipcMain.handle("ollama:deleteModel", (_e, name) => ollamaManager.deleteModel(name));
  ipcMain.handle("ollama:chat", (_e, params) => ollamaManager.chat(params));
  ipcMain.handle("ollama:getRunningModels", () => ollamaManager.getRunningModels());
  ipcMain.handle("ollama:loadCustomModel", (_e, filePath) => ollamaManager.loadCustomModel(filePath));

  // ── Bot ──────────────────────────────────────────────────────────────────
  ipcMain.handle("bot:create", (_e, config) => botManager.createBot(config));
  ipcMain.handle("bot:connect", (_e, botId) => botManager.connectBot(botId));
  ipcMain.handle("bot:disconnect", (_e, botId) => botManager.disconnectBot(botId));
  ipcMain.handle("bot:delete", (_e, botId) => botManager.deleteBot(botId));
  ipcMain.handle("bot:sendChat", (_e, botId, message) => botManager.sendChat(botId, message));
  ipcMain.handle("bot:sendAIOnly", (_e, botId, message) => botManager.sendAIOnly(botId, message));
  ipcMain.handle("bot:stopAction", (_e, botId) => botManager.stopAction(botId));
  ipcMain.handle("bot:stopMovement", (_e, botId) => botManager.stopMovement(botId));
  ipcMain.handle("bot:startSurvivor", (_e, botId) => botManager.startSurvivorMode(botId));
  ipcMain.handle("bot:stopSurvivor", (_e, botId) => botManager.stopSurvivorMode(botId));
  ipcMain.handle("bot:setNick", (_e, botId, nick) => botManager.setNick(botId, nick));
  ipcMain.handle("bot:toggleAI", (_e, botId, enabled) => botManager.toggleAI(botId, enabled));
  ipcMain.handle("bot:getAll", () => botManager.getAllBots());
  ipcMain.handle("bot:updateConfig", (_e, botId, config) => botManager.updateBotConfig(botId, config));
  ipcMain.handle("bot:testProxy", (_e, proxy) => botManager.testProxy(proxy));
  ipcMain.handle("bot:triggerLobby", (_e, botId) => botManager.triggerLobbyRank(botId));

  ipcMain.handle("bot:startAnarchy", (_e, botId, opts) => botManager.startAnarchyProtocol(botId, opts));
  ipcMain.handle("bot:stopAnarchy", (_e, botId) => botManager.stopAnarchyProtocol(botId));
  ipcMain.handle("bot:getAnarchyState", (_e, botId) => botManager.getAnarchyState(botId));

  // ── Farm ─────────────────────────────────────────────────────────────────
  ipcMain.handle("bot:startFarm", (_e, botId, opts) => botManager.startFarmTask(botId, opts));
  ipcMain.handle("bot:stopFarm", (_e, botId) => botManager.stopAction(botId));

  // ── PvP ──────────────────────────────────────────────────────────────────
  ipcMain.handle("bot:startPvp", (_e, botId, opts) => botManager.startPvpTask(botId, opts));
  ipcMain.handle("bot:stopPvp", (_e, botId) => botManager.stopPvpMode(botId));
  ipcMain.handle("bot:togglePvpMode", (_e, botId) => botManager.togglePvpMode(botId));

  // ── Inventory click ───────────────────────────────────────────────────────
  ipcMain.handle("bot:clickItem", (_e, botId, slot, button) => botManager.clickInventorySlot(botId, slot, button));
  ipcMain.handle("bot:closeWindow", (_e, botId) => botManager.closeBotWindow(botId));

  // ── Proxy ────────────────────────────────────────────────────────────────
  ipcMain.handle("proxy:check", (_e, proxy) => botManager.testProxy(proxy));

  // ── Dialog ───────────────────────────────────────────────────────────────
  ipcMain.handle("dialog:openFile", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ["openFile"],
      filters: [{ name: "GGUF Model", extensions: ["gguf"] }],
    });
    return result.filePaths[0] || null;
  });

  // ── Anka Recorder ────────────────────────────────────────────────────────
  ipcMain.handle("anka:list", () => ankaRecorder.listProfiles());
  ipcMain.handle("anka:startRecording", (_e, botId) => ankaRecorder.startRecording(botId));
  ipcMain.handle("anka:addStep", (_e, botId, step) => ankaRecorder.addStep(botId, step));
  ipcMain.handle("anka:stopRecording", (_e, botId, info) => ankaRecorder.stopRecording(botId, info));
  ipcMain.handle("anka:cancelRecording", (_e, botId) => ankaRecorder.cancelRecording(botId));
  ipcMain.handle("anka:getStepCount", (_e, botId) => ankaRecorder.getStepCount(botId));
  ipcMain.handle("anka:delete", (_e, id) => ankaRecorder.deleteProfile(id));
  ipcMain.handle("anka:play", async (_e, botId, profileId) => {
    const profile = ankaRecorder.getProfile(profileId);
    if (!profile) throw new Error("Профиль не найден");
    return botManager.playAnkaProfile(botId, profile.steps);
  });
  ipcMain.handle("anka:clickSlot", async (_e, botId, slot, button) =>
    botManager.clickBotSlot(botId, slot, button)
  );

  ipcMain.handle("shell:openExternal", (_e, url) => shell.openExternal(url));
}

app.whenReady().then(async () => {
  await initialize();
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", async () => {
  await botManager?.disconnectAll();
  await coordinatorServer?.stop();
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", async () => {
  await botManager?.disconnectAll();
});
