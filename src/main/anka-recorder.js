const { app } = require("electron");
const path = require("path");
const fs = require("fs");
const { v4: uuidv4 } = require("uuid");

const PROFILES_FILE = path.join(app.getPath("userData"), "anka-profiles.json");

function loadProfiles() {
  try {
    if (fs.existsSync(PROFILES_FILE)) {
      return JSON.parse(fs.readFileSync(PROFILES_FILE, "utf8"));
    }
  } catch {}
  return [];
}

function saveProfiles(profiles) {
  fs.writeFileSync(PROFILES_FILE, JSON.stringify(profiles, null, 2));
}

class AnkaRecorder {
  constructor() {
    this.profiles = loadProfiles();
    this.recordingSessions = new Map(); // botId -> { steps, startTime }
  }

  // ── Запись ─────────────────────────────────────────────────────────────────
  startRecording(botId) {
    this.recordingSessions.set(botId, {
      steps: [],
      startTime: Date.now(),
      lastStepTime: Date.now(),
    });
    return { success: true };
  }

  addStep(botId, { windowTitle, slot, button = 0 }) {
    const session = this.recordingSessions.get(botId);
    if (!session) return { error: "Запись не активна" };
    const now = Date.now();
    session.steps.push({
      windowTitle,
      slot,
      button,
      delay: now - session.lastStepTime,
    });
    session.lastStepTime = now;
    return { success: true, stepIndex: session.steps.length - 1 };
  }

  stopRecording(botId, { serverName, ankaName, serverHost }) {
    const session = this.recordingSessions.get(botId);
    if (!session) return { error: "Запись не была начата" };
    this.recordingSessions.delete(botId);

    if (session.steps.length === 0) {
      return { error: "Не было записано ни одного клика" };
    }

    const profile = {
      id: uuidv4(),
      serverName: serverName || "Без названия",
      ankaName: ankaName || "Анка",
      serverHost: serverHost || "",
      createdAt: Date.now(),
      steps: session.steps,
    };

    this.profiles.push(profile);
    saveProfiles(this.profiles);
    return { success: true, profile };
  }

  cancelRecording(botId) {
    this.recordingSessions.delete(botId);
    return { success: true };
  }

  isRecording(botId) {
    return this.recordingSessions.has(botId);
  }

  getStepCount(botId) {
    return this.recordingSessions.get(botId)?.steps?.length || 0;
  }

  // ── Профили ────────────────────────────────────────────────────────────────
  listProfiles() {
    return this.profiles;
  }

  getProfile(id) {
    return this.profiles.find(p => p.id === id);
  }

  deleteProfile(id) {
    this.profiles = this.profiles.filter(p => p.id !== id);
    saveProfiles(this.profiles);
    return { success: true };
  }

  getProfilesForServer(serverHost) {
    return this.profiles.filter(p =>
      !p.serverHost || p.serverHost === serverHost ||
      serverHost?.includes(p.serverHost) || p.serverHost?.includes(serverHost)
    );
  }
}

module.exports = AnkaRecorder;
