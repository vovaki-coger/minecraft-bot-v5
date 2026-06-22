import React, { useState, useRef, useEffect, useCallback } from "react";
import { BotState, ChatMessage } from "../../store/appStore";

interface Props {
  bot: BotState | null;
}

type ChatTab = "minecraft" | "ai";

export default function RightPanel({ bot }: Props) {
  const [input, setInput] = useState("");
  const [aiInput, setAiInput] = useState("");
  const [activeTab, setActiveTab] = useState<ChatTab>("minecraft");
  const [autoResponse, setAutoResponse] = useState(false);
  const [lobbyLoading, setLobbyLoading] = useState(false);

  const chatContainerRef = useRef<HTMLDivElement>(null);
  const aiChatContainerRef = useRef<HTMLDivElement>(null);
  const userScrolledRef = useRef(false);
  const aiUserScrolledRef = useRef(false);

  const handleChatScroll = useCallback(() => {
    const el = chatContainerRef.current;
    if (!el) return;
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    userScrolledRef.current = distFromBottom > 60;
  }, []);

  const handleAiChatScroll = useCallback(() => {
    const el = aiChatContainerRef.current;
    if (!el) return;
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    aiUserScrolledRef.current = distFromBottom > 60;
  }, []);

  useEffect(() => {
    const el = chatContainerRef.current;
    if (!el || userScrolledRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [bot?.chatHistory]);

  useEffect(() => {
    const el = aiChatContainerRef.current;
    if (!el || aiUserScrolledRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [bot?.aiChatHistory]);

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

  async function handleSendAI() {
    if (!aiInput.trim() || !bot) return;
    await window.electronAPI.bot.sendAIOnly(bot.id, aiInput.trim());
    setAiInput("");
  }

  async function handleTriggerLobby() {
    if (!bot) return;
    setLobbyLoading(true);
    try { await window.electronAPI.bot.triggerLobby(bot.id); } catch {}
    setLobbyLoading(false);
  }

  function handleKeyDown(e: React.KeyboardEvent, sender: "mc" | "ai") {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (sender === "mc") handleSendMinecraft();
      else handleSendAI();
    }
  }

  function getMsgColor(type: ChatMessage["type"]) {
    switch (type) {
      case "user": return "#7fb3d3";
      case "player": return "#e8e8e8";
      case "bot": return "#7ecc49";
      case "ai": return "#c084fc";
      case "system": return "#888888";
      case "server": return "#bdc3c7";
      case "survivor": return "#e67e22";
      default: return "#e8e8e8";
    }
  }

  function getAIMsgColor(type: ChatMessage["type"]) {
    switch (type) {
      case "user": return "#7fb3d3";
      case "ai": return "#c084fc";
      case "system": return "#888888";
      default: return "#e8e8e8";
    }
  }

  function formatTime(ts: number) {
    const d = new Date(ts);
    return `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
  }

  const mcMessages = bot?.chatHistory || [];
  const aiMessages = bot?.aiChatHistory || [];

  return (
    <div
      className="panel flex-shrink-0 flex flex-col"
      style={{ width: 320, overflow: "hidden", height: "100%", minHeight: 0 }}
    >
      {/* Tabs */}
      <div className="flex border-b flex-shrink-0" style={{ borderColor: "#3a3a3a" }}>
        <button
          onClick={() => setActiveTab("minecraft")}
          className="flex-1 text-xs py-1.5 font-mono transition-colors"
          style={{
            color: activeTab === "minecraft" ? "#7ecc49" : "#666",
            borderBottom: activeTab === "minecraft" ? "2px solid #7ecc49" : "2px solid transparent",
            background: "none",
          }}
        >
          ⛏ Minecraft
        </button>
        <button
          onClick={() => setActiveTab("ai")}
          className="flex-1 text-xs py-1.5 font-mono transition-colors"
          style={{
            color: activeTab === "ai" ? "#c084fc" : "#666",
            borderBottom: activeTab === "ai" ? "2px solid #c084fc" : "2px solid transparent",
            background: "none",
          }}
        >
          🤖 ИИ-чат
        </button>
      </div>

      {/* Minecraft Chat Tab */}
      {activeTab === "minecraft" && (
        <>
          {/* Header */}
          <div
            className="flex items-center justify-between px-3 py-1.5 border-b flex-shrink-0"
            style={{ borderColor: "#3a3a3a" }}
          >
            <span className="text-xs font-mono" style={{ color: "#888" }}>
              {bot?.status === "online" ? "Игровой чат" : "Оффлайн"}
            </span>
            <div className="flex items-center gap-2">
              <label
                className="flex items-center gap-1.5 text-xs cursor-pointer"
                style={{ color: autoResponse ? "#7ecc49" : "#888" }}
              >
                <input
                  type="checkbox"
                  checked={autoResponse}
                  onChange={(e) => handleAutoResponseToggle(e.target.checked)}
                  style={{ accentColor: "#7ecc49" }}
                />
                Автоответ
              </label>
              <button
                className="btn text-xs px-1.5 py-0.5"
                onClick={handleTriggerLobby}
                disabled={!bot || bot.status !== "online" || lobbyLoading}
                title="Выбрать анку/ранг в лобби"
                style={{ fontSize: 10 }}
              >
                {lobbyLoading ? "⏳" : "🏠 Анка"}
              </button>
            </div>
          </div>

          {/* Chat messages — fixed area with scroll */}
          <div
            ref={chatContainerRef}
            onScroll={handleChatScroll}
            style={{
              flex: "1 1 0",
              overflowY: "scroll",
              padding: "6px 8px",
              minHeight: 0,
              fontFamily: "'Courier New', monospace",
              fontSize: 11.5,
              lineHeight: 1.55,
              scrollbarWidth: "thin",
              scrollbarColor: "rgba(126,204,73,0.25) transparent",
              wordBreak: "break-word",
            }}
          >
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

          {/* Input */}
          <div className="p-2 border-t flex-shrink-0" style={{ borderColor: "#3a3a3a" }}>
            <div className="flex gap-1">
              <input
                className="input flex-1 text-xs"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => handleKeyDown(e, "mc")}
                placeholder={bot?.status === "online" ? "Написать в Minecraft чат..." : "Бот оффлайн"}
                disabled={!bot || bot.status !== "online"}
                style={{ fontSize: 11 }}
              />
              <button
                className="btn btn-primary text-xs px-3"
                onClick={handleSendMinecraft}
                disabled={!bot || bot.status !== "online" || !input.trim()}
              >
                ➤
              </button>
            </div>
          </div>
        </>
      )}

      {/* AI-only Chat Tab */}
      {activeTab === "ai" && (
        <>
          <div className="px-3 py-1.5 border-b flex-shrink-0" style={{ borderColor: "#3a3a3a" }}>
            <p className="text-xs" style={{ color: "#888" }}>
              Приватный разговор с ИИ — не пишет в Minecraft чат
            </p>
          </div>

          <div
            ref={aiChatContainerRef}
            onScroll={handleAiChatScroll}
            style={{
              flex: "1 1 0",
              overflowY: "scroll",
              padding: "6px 8px",
              minHeight: 0,
              fontFamily: "'Courier New', monospace",
              fontSize: 11.5,
              lineHeight: 1.55,
              scrollbarWidth: "thin",
              scrollbarColor: "rgba(192,132,252,0.25) transparent",
              wordBreak: "break-word",
            }}
          >
            {aiMessages.length === 0 ? (
              <div style={{ textAlign: "center", marginTop: 32, color: "#555", fontSize: 11 }}>
                {bot ? (
                  <>
                    <p>ИИ-чат пуст</p>
                    <p style={{ marginTop: 4, fontSize: 10, color: "#444" }}>Сообщения здесь не видны в игре</p>
                  </>
                ) : "Выберите бота"}
              </div>
            ) : (
              aiMessages.map((msg, i) => (
                <div key={i} style={{ marginBottom: 4 }}>
                  <span style={{ color: "#444", marginRight: 4, fontSize: 10 }}>[{formatTime(msg.timestamp)}]</span>
                  <span style={{ color: "#555", marginRight: 4, fontSize: 10 }}>
                    {msg.type === "user" ? "[Вы]" : msg.type === "ai" ? "[ИИ]" : "[Сис]"}
                  </span>
                  <span style={{ color: getAIMsgColor(msg.type) }}>{msg.text}</span>
                </div>
              ))
            )}
          </div>

          <div className="p-2 border-t flex-shrink-0" style={{ borderColor: "#3a3a3a" }}>
            <div className="flex gap-1">
              <input
                className="input flex-1 text-xs"
                value={aiInput}
                onChange={(e) => setAiInput(e.target.value)}
                onKeyDown={(e) => handleKeyDown(e, "ai")}
                placeholder="Спросить у ИИ (не попадёт в игру)..."
                disabled={!bot}
                style={{ fontSize: 11 }}
              />
              <button
                className="btn text-xs px-3"
                onClick={handleSendAI}
                disabled={!bot || !aiInput.trim()}
                style={{ borderColor: "#7c3aed", color: "#c084fc" }}
              >
                ➤
              </button>
            </div>
            <p className="text-xs mt-1" style={{ color: "#444" }}>
              🔒 Только между вами и ИИ
            </p>
          </div>
        </>
      )}
    </div>
  );
}
