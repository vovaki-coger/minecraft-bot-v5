import React, { useState } from "react";
import { BotState } from "../store/appStore";
import AnkaRecorder from "./AnkaRecorder";

interface Props {
  bot: BotState;
}

export default function BotControls({ bot }: Props) {
  const [newNick, setNewNick] = useState("");
  const [showNickInput, setShowNickInput] = useState(false);
  const [loading, setLoading] = useState<string | null>(null);
  const [showAnka, setShowAnka] = useState(false);

  async function handle(action: string, fn: () => Promise<any>) {
    setLoading(action);
    try { await fn(); } catch (err: any) { alert(err.message); }
    finally { setLoading(null); }
  }

  async function handleConnect() {
    if (bot.status === "online" || bot.status === "connecting") {
      await handle("disconnect", () => window.electronAPI.bot.disconnect(bot.id));
    } else {
      await handle("connect", () => window.electronAPI.bot.connect(bot.id));
    }
  }

  async function handleNickChange() {
    if (!newNick.trim()) return;
    await handle("nick", () => window.electronAPI.bot.setNick(bot.id, newNick.trim()));
    setNewNick("");
    setShowNickInput(false);
  }

  async function handleSurvivor() {
    if (bot.survivorMode) {
      await handle("survivor", () => window.electronAPI.bot.stopSurvivor(bot.id));
    } else {
      await handle("survivor", () => window.electronAPI.bot.startSurvivor(bot.id));
    }
  }

  async function handlePvp() {
    const pvpMode = (bot as any).pvpMode;
    if (pvpMode) {
      await handle("pvp", () => (window as any).electronAPI.bot.stopPvp(bot.id));
    } else {
      await handle("pvp", () => (window as any).electronAPI.bot.startPvp(bot.id, { autoTarget: true }));
    }
  }

  async function handleToggleAI() {
    await handle("ai", () => window.electronAPI.bot.toggleAI(bot.id, !bot.config.aiEnabled));
  }

  async function handleDelete() {
    if (!confirm(`Удалить бота ${bot.config.nick}?`)) return;
    await window.electronAPI.bot.delete(bot.id);
  }

  const isConnected = bot.status === "online";
  const isConnecting = bot.status === "connecting";
  const pvpMode = (bot as any).pvpMode ?? false;

  return (
    <div className="flex flex-col gap-2">
      <div className="panel p-3" style={{ background: "rgba(13,17,23,0.80)", backdropFilter: "blur(4px)" }}>
        <div className="text-xs font-mono mb-2" style={{ color: "#7ecc49" }}>🎮 Управление</div>

        <div className="flex flex-col gap-2">
          {/* Connect / Disconnect */}
          <div className="flex gap-1.5 flex-wrap">
            <button
              className={`btn text-xs ${isConnected ? "btn-danger" : "btn-primary"}`}
              onClick={handleConnect}
              disabled={loading === "connect" || loading === "disconnect" || isConnecting}
            >
              {isConnecting ? "⏳ Подключение..." : isConnected ? "⏹ Отключиться" : "▶️ Подключиться"}
            </button>

            <button
              className="btn text-xs"
              onClick={handleToggleAI}
              disabled={loading === "ai"}
              style={{
                borderColor: bot.config.aiEnabled ? "#7ecc49" : "#555",
                color: bot.config.aiEnabled ? "#7ecc49" : "#888",
              }}
            >
              {bot.config.aiEnabled ? "⚡ ИИ: Вкл" : "💤 ИИ: Выкл"}
            </button>
          </div>

          {/* Stop buttons */}
          <div className="flex gap-1.5 flex-wrap">
            <button
              className="btn text-xs btn-warning"
              onClick={() => handle("stopAction", () => window.electronAPI.bot.stopAction(bot.id))}
              disabled={!isConnected || loading === "stopAction"}
            >
              ⛔ Стоп действие
            </button>
            <button
              className="btn text-xs"
              onClick={() => handle("stopMove", () => window.electronAPI.bot.stopMovement(bot.id))}
              disabled={!isConnected || loading === "stopMove"}
            >
              🚫 Стоп движение
            </button>
          </div>

          {/* Survivor + PvP (side by side) */}
          <div className="flex gap-1.5">
            <button
              className="btn text-xs flex-1"
              onClick={handleSurvivor}
              disabled={!isConnected || !bot.config.aiEnabled || loading === "survivor"}
              style={bot.survivorMode
                ? { borderColor: "#e74c3c", color: "#e74c3c", background: "#2a0a0a" }
                : { background: "#1e1400", borderColor: "#e67e22", color: "#e67e22" }}
            >
              {loading === "survivor" ? "⏳..." : bot.survivorMode ? "⏹ Выжив." : "⚔️ Выживальщик"}
            </button>

            <button
              className="btn text-xs flex-1"
              onClick={handlePvp}
              disabled={!isConnected || loading === "pvp"}
              title="Автоматически атакует всех игроков поблизости (кроме тимейтов)"
              style={pvpMode
                ? { borderColor: "#e74c3c", color: "#e74c3c", background: "#2a0a0a", animation: "pulse 1s infinite" }
                : { background: "#1a0a1a", borderColor: "#9b59b6", color: "#9b59b6" }}
            >
              {loading === "pvp" ? "⏳..." : pvpMode ? "⏹ PvP: Вкл" : "💀 PvP-режим"}
            </button>
          </div>

          {/* Nick change */}
          <div className="flex gap-1">
            {showNickInput ? (
              <>
                <input
                  className="input flex-1 text-xs"
                  value={newNick}
                  onChange={(e) => setNewNick(e.target.value)}
                  placeholder="Новый ник..."
                  onKeyDown={(e) => e.key === "Enter" && handleNickChange()}
                  autoFocus
                />
                <button className="btn btn-primary text-xs" onClick={handleNickChange}>✓</button>
                <button className="btn text-xs" onClick={() => setShowNickInput(false)}>✕</button>
              </>
            ) : (
              <button className="btn text-xs flex-1" onClick={() => setShowNickInput(true)}>
                ✏️ Сменить ник
              </button>
            )}
          </div>

          {/* Delete */}
          <button className="btn btn-danger text-xs" onClick={handleDelete}>
            🗑️ Удалить бота
          </button>
        </div>
      </div>

      {/* Anka Recorder */}
      <div className="panel" style={{ overflow: "hidden", background: "rgba(13,17,23,0.80)", backdropFilter: "blur(4px)" }}>
        <button
          className="w-full text-left px-3 py-2 flex items-center justify-between"
          style={{ background: "none", border: "none", cursor: "pointer" }}
          onClick={() => setShowAnka(v => !v)}
        >
          <div className="flex items-center gap-2">
            <span style={{ fontSize: 15 }}>🎯</span>
            <span className="text-xs font-mono" style={{ color: showAnka ? "#7ecc49" : "#888" }}>
              Запись анки
            </span>
          </div>
          <span style={{ color: "#555", fontSize: 10 }}>{showAnka ? "▲" : "▼"}</span>
        </button>
        {showAnka && (
          <div style={{ borderTop: "1px solid #2a2a2a" }}>
            <AnkaRecorder bot={bot} />
          </div>
        )}
      </div>
    </div>
  );
}
