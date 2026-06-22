import React, { useEffect, useState, Component } from "react";
import { useAppStore } from "./store/appStore";
import MainLayout from "./components/MainLayout";
import OllamaSetup from "./components/OllamaSetup";
import LoadingScreen from "./components/LoadingScreen";

type Lang = "ru" | "en";
const T: Record<Lang, Record<string, string>> = {
  ru: {
    greeting: "Привет! Я Prismarine Bot.",
    desc1: "Умный Minecraft-бот с ИИ, фермой, PvP и защитой от античита.",
    req1: "🟢 Нужен Ollama (локальный ИИ) или API-ключ",
    req2: "🟢 Java Minecraft 1.8–1.21",
    req3: "🟢 Добавь бота через кнопку «+ Добавить бота»",
    lang: "Выбери язык интерфейса:",
    start: "Начать",
  },
  en: {
    greeting: "Hello! I'm Prismarine Bot.",
    desc1: "Smart Minecraft bot with AI, farming, PvP and anti-cheat bypass.",
    req1: "🟢 Needs Ollama (local AI) or API key",
    req2: "🟢 Java Minecraft 1.8–1.21",
    req3: "🟢 Add a bot via '+ Add bot' button",
    lang: "Choose interface language:",
    start: "Start",
  },
};

function WelcomeModal({ onDone }: { onDone: (lang: Lang) => void }) {
  const [lang, setLang] = useState<Lang>("ru");
  const t = T[lang];
  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center",
      background: "radial-gradient(ellipse at 50% 30%, rgba(0,80,200,.18) 0%, #05070f 70%)",
    }}>
      {/* Stars */}
      {Array.from({ length: 80 }, (_, i) => (
        <div key={i} className="star" style={{
          left: `${(i * 137.5) % 100}%`,
          top: `${(i * 97.3) % 100}%`,
          width: i % 5 === 0 ? 2.5 : 1.5,
          height: i % 5 === 0 ? 2.5 : 1.5,
          ["--s-op" as any]: ((i % 7) * 0.1 + 0.2).toFixed(2),
          ["--s-dur" as any]: `${2 + (i % 5)}s`,
          ["--s-delay" as any]: `-${(i % 4)}s`,
        }} />
      ))}

      <div className="welcome-in" style={{
        position: "relative", zIndex: 2,
        background: "rgba(9,12,24,.97)", border: "1px solid rgba(0,200,255,.2)",
        borderRadius: 14, padding: "36px 40px", maxWidth: 440, width: "90%",
        boxShadow: "0 0 80px rgba(0,200,255,.08), 0 20px 60px rgba(0,0,0,.7)",
        display: "flex", flexDirection: "column", gap: 16, textAlign: "center",
      }}>
        <div style={{ fontSize: 44 }}>⛏️</div>
        <div style={{ fontSize: 20, color: "#00c8ff", fontFamily: "monospace", fontWeight: "bold", letterSpacing: 1 }}>
          {t.greeting}
        </div>
        <div style={{ fontSize: 12, color: "#4a6080", fontFamily: "monospace", lineHeight: 1.6 }}>
          {t.desc1}
        </div>

        <div style={{ background: "rgba(0,0,0,.4)", border: "1px solid #1a2040", borderRadius: 8, padding: "12px 16px", textAlign: "left", display: "flex", flexDirection: "column", gap: 6 }}>
          {[t.req1, t.req2, t.req3].map((r, i) => (
            <div key={i} style={{ fontSize: 11, color: "#3a5a7a", fontFamily: "monospace" }}>{r}</div>
          ))}
        </div>

        <div>
          <div style={{ fontSize: 11, color: "#3a4a6a", fontFamily: "monospace", marginBottom: 10 }}>{t.lang}</div>
          <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
            {(["ru", "en"] as Lang[]).map(l => (
              <button key={l} onClick={() => setLang(l)} style={{
                flex: 1, padding: "9px 0", fontSize: 12, fontFamily: "monospace", borderRadius: 6, cursor: "pointer",
                background: lang === l ? "rgba(0,200,255,.1)" : "rgba(0,0,0,.4)",
                border: `1px solid ${lang === l ? "rgba(0,200,255,.5)" : "#1a2040"}`,
                color: lang === l ? "#00c8ff" : "#2a3a5a",
                transition: "all .15s",
              }}>
                {l === "ru" ? "🇷🇺 Русский" : "🇬🇧 English"}
              </button>
            ))}
          </div>
        </div>

        <button onClick={() => onDone(lang)} style={{
          padding: "11px 0", fontSize: 13, fontFamily: "monospace", borderRadius: 7, cursor: "pointer",
          background: "rgba(0,255,157,.08)", border: "1px solid rgba(0,255,157,.4)",
          color: "#00ff9d", boxShadow: "0 0 20px rgba(0,255,157,.12)", transition: "all .2s",
        }}>
          {t.start} →
        </button>
        <div style={{ fontSize: 9, color: "#1a2a3a", fontFamily: "monospace" }}>Prismarine Bot v5.1.4</div>
      </div>
    </div>
  );
}

class ErrorBoundary extends Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("[ErrorBoundary] React crash caught:", error, info);
  }

  render() {
    const { error } = this.state;
    return (
      <div style={{ position: "relative", display: "flex", flex: 1, overflow: "hidden" }}>
        {this.props.children}
        {error && (
          <div style={{
            position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 9999,
            background: "rgba(20,6,8,.97)", borderTop: "1px solid #ff3344",
            padding: "6px 14px", display: "flex", alignItems: "center", gap: 10,
            fontFamily: "monospace", fontSize: 11,
          }}>
            <span style={{ color: "#ff4466" }}>⚠</span>
            <span style={{ color: "#ff6677", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {error.message}
            </span>
            <button
              style={{
                padding: "2px 10px", background: "none", border: "1px solid #ff3344",
                borderRadius: 3, color: "#ff4466", cursor: "pointer",
                fontFamily: "monospace", fontSize: 11, flexShrink: 0,
              }}
              onClick={() => this.setState({ error: null })}
            >
              ✕
            </button>
          </div>
        )}
      </div>
    );
  }
}

export default function App() {
  const { ollamaStatus, setOllamaStatus, loadBots, loadConfig } = useAppStore();
  const [loading, setLoading] = useState(true);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [showWelcome, setShowWelcome] = useState(() => !localStorage.getItem("pbot_setup_done"));

  useEffect(() => {
    async function init() {
      await loadConfig();
      await loadBots();
      const status = await window.electronAPI.ollama.check();
      setOllamaStatus(status);
      if (!status.installed || !status.running) setNeedsSetup(true);
      setLoading(false);
    }
    init();

    const unsubs = [
      window.electronAPI.on("bot:created", (d) => useAppStore.getState().onBotCreated(d)),
      window.electronAPI.on("bot:deleted", (d) => useAppStore.getState().onBotDeleted(d)),
      window.electronAPI.on("bot:statusChanged", (d) => useAppStore.getState().onBotStatusChanged(d)),
      window.electronAPI.on("bot:statsUpdated", (d) => useAppStore.getState().onBotStatsUpdated(d)),
      window.electronAPI.on("bot:chat", (d) => useAppStore.getState().onBotChat(d)),
      window.electronAPI.on("bot:serverMessage", (d) => useAppStore.getState().onBotServerMessage(d)),
      window.electronAPI.on("bot:aiMessage", (d) => useAppStore.getState().onBotAiMessage(d)),
      window.electronAPI.on("bot:aiChatMessage", (d) => useAppStore.getState().onBotAiChatMessage(d)),
      window.electronAPI.on("bot:death", (d) => useAppStore.getState().onBotDeath(d)),
      window.electronAPI.on("bot:error", (d) => useAppStore.getState().onBotError(d)),
      window.electronAPI.on("bot:inventoryUpdated", (d) => useAppStore.getState().onInventoryUpdated(d)),
      window.electronAPI.on("bot:survivorLog", (d) => useAppStore.getState().onSurvivorLog(d)),
      window.electronAPI.on("bot:survivorStarted", (d) => useAppStore.getState().onSurvivorStarted(d)),
      window.electronAPI.on("bot:survivorStopped", (d) => useAppStore.getState().onSurvivorStopped(d)),
      window.electronAPI.on("bot:aiToggled", (d) => useAppStore.getState().onAiToggled(d)),
      window.electronAPI.on("ollama:pullProgress", (d) => useAppStore.getState().onPullProgress(d)),
      window.electronAPI.on("coordinator:groupChat", (d) => useAppStore.getState().onGroupChat(d)),
    ];

    return () => unsubs.forEach((u) => u?.());
  }, []);

  if (loading) return <LoadingScreen />;
  if (showWelcome) return <WelcomeModal onDone={(lang) => {
    localStorage.setItem("pbot_setup_done", "1");
    localStorage.setItem("pbot_lang", lang);
    setShowWelcome(false);
  }} />;
  if (needsSetup && !ollamaStatus?.running) return <OllamaSetup onComplete={() => setNeedsSetup(false)} />;
  return (
    <ErrorBoundary>
      <MainLayout />
    </ErrorBoundary>
  );
}
