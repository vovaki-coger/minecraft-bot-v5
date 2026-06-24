import React, { useState, useRef, useEffect, useCallback } from "react";
import { BotState, ChatMessage } from "../../store/appStore";
import LogsTab from "../tabs/LogsTab";

interface Props {
  bot: BotState | null;
}

type PanelTab = "minecraft" | "logs";

export default function RightPanel({ bot }: Props) {
  const [input, setInput] = useState("");
  const [activeTab, setActiveTab] = useState<PanelTab>("minecraft");
  const [autoResponse, setAutoResponse] = useState(false);
  const [lobbyLoading, setLobbyLoading] = useState(false);

  const chatContainerRef = useRef<HTMLDivElement>(null);
  const userScrolledRef = useRef(false);

  const handleChatScroll = useCallback(() => {
    const el = chatContainerRef.current;
    if (!el) return;
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    userScrolledRef.current = distFromBottom > 60;
  }, []);

  useEffect(() => {
    const el = chatContainerRef.current;
    if (!el || userScrolledRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [bot?.chatHistory]);

  useEffect(() => {
    if (bot) setAutoResponse(!!(bot.config as any).autoResponse);
  }, [bot?.id]);

  async function handleAutoResponseToggle(checked: boolean) {
    setAutoResponse(checked);
    if (bot) await window.electronAPI.bot.updateConfig(bot.id, { autoResponse: checked });
  }

  async function handleSendMinecraft() {
    if (!input.trim() || !bot) return;
    await window.electronAPI.bot.sendChat(bot.id, input.trim());
    setInput("");
  }

  async function handleTriggerLobby() {
    if (!bot) return;
    setLobbyLoading(true);
    try { await window.electronAPI.bot.triggerLobby(bot.id); } catch {}
    setLobbyLoading(false);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendMinecraft();
    }
  }

  function getMsgColor(type: ChatMessage["type"]) {
    switch (type) {
      case "user":     return "#7fb3d3";
      case "player":   return "#e8e8e8";
      case "bot":      return "#7ecc49";
      case "ai":       return "#c084fc";
      case "system":   return "#888888";
      case "server":   return "#bdc3c7";
      case "survivor": return "#e67e22";
      default:         return "#e8e8e8";
    }
  }

  function formatTime(ts: number) {
    const d = new Date(ts);
    return `${d.getHours().toString().padStart(2,"0")}:${d.getMinutes().toString().padStart(2,"0")}`;
  }

  const mcMessages = bot?.chatHistory || [];

  return (
    <div className="panel flex-shrink-0 flex flex-col"
      style={{ width: 320, overflow: "hidden", height: "100%", minHeight: 0 }}>

      {/* Tabs */}
      <div className="flex border-b flex-shrink-0" style={{ borderColor: "#3a3a3a" }}>
        <button
          onClick={() => setActiveTab("minecraft")}
          className="flex-1 text-xs py-1.5 font-mono transition-colors"
          style={{
            color: activeTab === "minecraft" ? "#7ecc49" : "#666",
            borderBottom: activeTab === "minecraft" ? "2px solid #7ecc49" : "2px solid transparent",
            background: "none",
          }}>
          ⛏ Minecraft
        </button>
        <button
          onClick={() => setActiveTab("logs")}
          className="flex-1 text-xs py-1.5 font-mono transition-colors"
          style={{
            color: activeTab === "logs" ? "#9b59b6" : "#666",
            borderBottom: activeTab === "logs" ? "2px solid #9b59b6" : "2px solid transparent",
            background: "none",
          }}>
          📋 Логи
        </button>
      </div>

      {/* ── Minecraft Chat Tab ── */}
      {activeTab === "minecraft" && (
        <>
          <div className="flex items-center justify-between px-3 py-1.5 border-b flex-shrink-0"
            style={{ borderColor: "#3a3a3a" }}>
            <span className="text-xs font-mono" style={{ color: "#888" }}>
              {bot?.status === "online" ? "Игровой чат" : "Оффлайн"}
            </span>
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-1.5 text-xs cursor-pointer"
                style={{ color: autoResponse ? "#7ecc49" : "#888" }}>
                <input type="checkbox" checked={autoResponse}
                  onChange={(e) => handleAutoResponseToggle(e.target.checked)}
                  style={{ accentColor: "#7ecc49" }} />
                Автоответ
              </label>
              <button className="btn text-xs px-1.5 py-0.5"
                onClick={handleTriggerLobby}
                disabled={!bot || bot.status !== "online" || lobbyLoading}
                title="Выбрать анку/ранг в лобби" style={{ fontSize: 10 }}>
                {lobbyLoading ? "⏳" : "🏠 Анка"}
              </button>
            </div>
          </div>

          <div ref={chatContainerRef} onScroll={handleChatScroll}
            style={{
              flex: "1 1 0", overflowY: "scroll", padding: "6px 8px", minHeight: 0,
              fontFamily: "'Courier New', monospace", fontSize: 11.5, lineHeight: 1.55,
              scrollbarWidth: "thin", scrollbarColor: "rgba(126,204,73,0.25) transparent",
              wordBreak: "break-word",
            }}>
            {mcMessages.length === 0 ? (
              <div style={{ textAlign: "center", marginTop: 32, color: "#555", fontSize: 11 }}>
                {bot ? "Сообщений нет" : "Выберите бота"}
              </div>
            ) : (
              mcMessages.map((msg, i) => (
                <div key={i} style={{ marginBottom: 2 }}>
                  <span style={{ color: "#444", marginRight: 4, fontSize: 10 }}>[{formatTime(msg.timestamp)}]</span>
                  <span style={{ color: getMsgColor(msg.type) }}>{msg.text}</span>
                </div>
              ))
            )}
          </div>

          <div className="p-2 border-t flex-shrink-0" style={{ borderColor: "#3a3a3a" }}>
            <div className="flex gap-1">
              <input className="input flex-1 text-xs"
                value={input} onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={bot?.status === "online" ? "Написать в Minecraft чат..." : "Бот оффлайн"}
                disabled={!bot || bot.status !== "online"}
                style={{ fontSize: 11 }} />
              <button className="btn btn-primary text-xs px-3"
                onClick={handleSendMinecraft}
                disabled={!bot || bot.status !== "online" || !input.trim()}>
                ➤
              </button>
            </div>
          </div>
        </>
      )}

      {/* ── Logs Tab ── */}
      {activeTab === "logs" && (
        <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
          <LogsTab />
        </div>
      )}
    </div>
  );
}
