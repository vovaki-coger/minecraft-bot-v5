import React, { useMemo, useState } from "react";

interface Props {
  onClose: (lang: "ru" | "en") => void;
}

const TEXT = {
  ru: {
    title: "Призмарин Бот",
    subtitle: "Умный Minecraft-бот с поддержкой ИИ",
    desc: "Что умеет бот:",
    features: [
      "🤖 Отвечает в чат с помощью локального ИИ (Ollama)",
      "⚔️ PvP режим с крит-ударами и зельями",
      "🌾 Авто-фарм культур и деревьев",
      "⚡ Быстрый фарм в Delta-стиле",
      "🛡️ Режим Выживальщика — добывает ресурсы сам",
      "🔗 Координатор — управляй несколькими ботами",
      "🏴‍☠️ Анархия-протокол для хаотичных серверов",
    ],
    langLabel: "Выбери язык:",
    start: "Начать",
    note: "⚡ Powered by Ollama · mineflayer · Electron",
  },
  en: {
    title: "Prismarine Bot",
    subtitle: "Smart Minecraft bot with AI support",
    desc: "What the bot can do:",
    features: [
      "🤖 Chat responses via local AI (Ollama)",
      "⚔️ PvP mode with crits and potions",
      "🌾 Auto-farm crops and trees",
      "⚡ Delta-style quick farm",
      "🛡️ Survivor mode — gathers resources autonomously",
      "🔗 Coordinator — control multiple bots",
      "🏴‍☠️ Anarchy protocol for chaotic servers",
    ],
    langLabel: "Choose language:",
    start: "Start",
    note: "⚡ Powered by Ollama · mineflayer · Electron",
  },
};

export default function WelcomeModal({ onClose }: Props) {
  const [lang, setLang] = useState<"ru" | "en">("ru");
  const t = TEXT[lang];

  const stars = useMemo(() => Array.from({ length: 160 }, (_, i) => ({
    id: i,
    left: Math.random() * 100,
    top: Math.random() * 100,
    size: Math.random() < 0.08 ? 2.5 : Math.random() < 0.3 ? 1.5 : 1,
    dur: 1.5 + Math.random() * 3.5,
    delay: Math.random() * 5,
    opacity: 0.4 + Math.random() * 0.5,
  })), []);

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 9999,
        background: "radial-gradient(ellipse at 50% 0%, #0a1a2a 0%, #050a10 60%, #000 100%)",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}
    >
      {/* Stars */}
      {stars.map((s) => (
        <div key={s.id} style={{
          position: "absolute",
          left: s.left + "%", top: s.top + "%",
          width: s.size, height: s.size,
          borderRadius: "50%", background: "#fff",
          animation: `twinkle ${s.dur}s ${s.delay}s ease-in-out infinite alternate`,
          opacity: s.opacity,
          pointerEvents: "none",
        }} />
      ))}

      {/* Card */}
      <div style={{
        position: "relative", zIndex: 1,
        background: "rgba(20,30,20,0.95)",
        border: "1px solid #3a5a3a",
        borderRadius: 8,
        padding: "32px 36px",
        width: 420,
        boxShadow: "0 0 60px rgba(94,204,73,0.15), 0 0 120px rgba(0,0,0,0.8)",
      }}>
        {/* Logo */}
        <div className="text-center mb-4">
          <div style={{ fontSize: 48, marginBottom: 8 }}>⛏️</div>
          <h1 style={{ color: "#7ecc49", fontSize: 22, fontFamily: "monospace", fontWeight: "bold" }}>
            {t.title}
          </h1>
          <p style={{ color: "#888", fontSize: 11, marginTop: 4 }}>{t.subtitle}</p>
        </div>

        {/* Language selector */}
        <div style={{ marginBottom: 20, textAlign: "center" }}>
          <div style={{ color: "#888", fontSize: 11, marginBottom: 8 }}>{t.langLabel}</div>
          <div style={{ display: "inline-flex", gap: 8 }}>
            {(["ru", "en"] as const).map((l) => (
              <button key={l} onClick={() => setLang(l)}
                style={{
                  padding: "6px 20px", borderRadius: 4, cursor: "pointer",
                  fontFamily: "monospace", fontSize: 13,
                  background: lang === l ? "#2a4a1a" : "#1a1a1a",
                  border: `1px solid ${lang === l ? "#7ecc49" : "#333"}`,
                  color: lang === l ? "#7ecc49" : "#666",
                  transition: "all 0.15s",
                }}>
                {l === "ru" ? "🇷🇺 Русский" : "🇬🇧 English"}
              </button>
            ))}
          </div>
        </div>

        {/* Features */}
        <div style={{
          background: "#111", border: "1px solid #2a2a2a", borderRadius: 4,
          padding: "12px 14px", marginBottom: 20,
        }}>
          <div style={{ color: "#7ecc49", fontSize: 11, marginBottom: 8, fontFamily: "monospace" }}>
            {t.desc}
          </div>
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {t.features.map((f, i) => (
              <li key={i} style={{ color: "#bbb", fontSize: 11, lineHeight: "1.7", fontFamily: "monospace" }}>
                {f}
              </li>
            ))}
          </ul>
        </div>

        {/* Start button */}
        <button
          onClick={() => onClose(lang)}
          style={{
            width: "100%", padding: "10px 0",
            background: "linear-gradient(135deg, #5b8c3e, #7ecc49)",
            border: "none", borderRadius: 4,
            color: "#fff", fontFamily: "monospace", fontSize: 14, fontWeight: "bold",
            cursor: "pointer", letterSpacing: 1,
            boxShadow: "0 0 20px rgba(126,204,73,0.3)",
          }}
        >
          {t.start} →
        </button>

        <div style={{ textAlign: "center", color: "#333", fontSize: 10, marginTop: 12, fontFamily: "monospace" }}>
          {t.note}
        </div>
      </div>
    </div>
  );
}
