import React, { useState, useEffect, useRef } from "react";
import { useAppStore } from "../../store/appStore";

interface LogEntry {
  id: number;
  ts: number;
  type: "pvp" | "farm" | "task" | "system" | "death" | "chat" | "error" | "proxy";
  msg: string;
}

const TYPE_CONFIG: Record<LogEntry["type"], { color: string; label: string }> = {
  pvp:    { color: "#e74c3c", label: "⚔️ PVP" },
  farm:   { color: "#7ecc49", label: "🌾 Ферма" },
  task:   { color: "#3498db", label: "🎯 Задача" },
  system: { color: "#9b59b6", label: "⚙️ Система" },
  death:  { color: "#e67e22", label: "💀 Смерть" },
  chat:   { color: "#95a5a6", label: "💬 Чат" },
  error:  { color: "#c0392b", label: "❌ Ошибка" },
  proxy:  { color: "#1abc9c", label: "🔌 Прокси" },
};

const ALL_TYPES = Object.keys(TYPE_CONFIG) as LogEntry["type"][];
let _logId = 0;

function ts(ms: number) {
  const d = new Date(ms);
  return d.toTimeString().slice(0, 8);
}

export default function LogsTab() {
  const bots = useAppStore(s => s.bots);
  const selectedBotId = useAppStore(s => s.selectedBotId);
  const bot = bots.find(b => b.id === selectedBotId) || null;

  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [filter, setFilter] = useState<LogEntry["type"] | "all">("all");
  const [autoScroll, setAutoScroll] = useState(true);
  const bottomRef = useRef<HTMLDivElement>(null);
  const logsRef = useRef<LogEntry[]>([]);

  function addLog(type: LogEntry["type"], msg: string) {
    const entry: LogEntry = { id: _logId++, ts: Date.now(), type, msg };
    logsRef.current = [...logsRef.current.slice(-299), entry];
    setLogs([...logsRef.current]);
  }

  useEffect(() => {
    const api = (window as any).electronAPI;
    if (!api?.onBotEvent) return;

    const unsub = api.onBotEvent((ch: string, data: any) => {
      if (!data || (data.botId && data.botId !== selectedBotId)) return;

      switch (ch) {
        case "bot:actionLog":
          addLog(data.logType || "system", data.msg || data.message || "");
          break;
        case "bot:pvpToggled":
          addLog("pvp", data.pvpMode ? "▶ PVP режим запущен" : "⏹ PVP режим остановлен");
          break;
        case "bot:death":
          addLog("death", `💀 Бот умер | pos: ${data.pos?.x ?? "?"} ${data.pos?.y ?? "?"} ${data.pos?.z ?? "?"}`);
          break;
        case "bot:statusChanged":
          if (data.status === "online") addLog("system", `✅ Подключён к серверу`);
          else if (data.status === "offline") addLog("system", `🔌 Отключён (${data.reason ?? ""})`);
          break;
        case "bot:error":
          addLog("error", `❌ ${data.message ?? data.msg ?? "Ошибка"}`);
          break;
        case "bot:pvpDetected":
          addLog("pvp", `🎯 Обнаружен враг: ${data.enemy ?? "?"} | HP=${data.health ?? "?"}`);
          break;
        case "bot:chat":
          if (data.type !== "player") break;
          addLog("chat", `[${data.username}]: ${data.message}`);
          break;
        case "bot:actionStopped":
          addLog("task", "⏹ Задача остановлена");
          break;
        default:
          break;
      }
    });

    return () => { try { unsub?.(); } catch {} };
  }, [selectedBotId]);

  useEffect(() => {
    if (autoScroll && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [logs, autoScroll]);

  const filtered = filter === "all" ? logs : logs.filter(l => l.type === filter);

  return (
    <div className="flex flex-col h-full overflow-hidden" style={{ background: "transparent" }}>
      {/* Header */}
      <div className="px-3 py-2 border-b flex items-center gap-2 flex-wrap"
        style={{ borderColor: "rgba(55,65,88,0.5)", background: "rgba(10,12,18,0.9)" }}>
        <span className="font-mono text-xs font-bold" style={{ color: "#9b59b6", textShadow: "0 0 10px rgba(155,89,182,0.5)" }}>
          📋 Логи действий
        </span>
        <span className="text-xs font-mono" style={{ color: "#333" }}>
          {logs.length} записей
        </span>
        <div className="flex-1" />
        {/* Auto-scroll toggle */}
        <label style={{ display: "flex", alignItems: "center", gap: 4, cursor: "pointer" }}>
          <input type="checkbox" checked={autoScroll} onChange={e => setAutoScroll(e.target.checked)}
            style={{ accentColor: "#9b59b6" }} />
          <span style={{ color: "#666", fontSize: 10, fontFamily: "monospace" }}>авто-скролл</span>
        </label>
        {/* Clear */}
        <button
          onClick={() => { logsRef.current = []; setLogs([]); }}
          style={{
            padding: "2px 8px", borderRadius: 4, fontSize: 10, fontFamily: "monospace",
            border: "1px solid rgba(231,76,60,0.4)", background: "rgba(231,76,60,0.08)",
            color: "#c0392b", cursor: "pointer",
          }}>
          Очистить
        </button>
      </div>

      {/* Filter bar */}
      <div className="px-2 py-1.5 border-b flex gap-1 flex-wrap"
        style={{ borderColor: "rgba(40,55,80,0.4)", background: "rgba(8,10,16,0.85)" }}>
        <button
          onClick={() => setFilter("all")}
          style={{
            padding: "2px 8px", borderRadius: 3, fontSize: 10, fontFamily: "monospace", cursor: "pointer",
            border: `1px solid ${filter === "all" ? "#9b59b6" : "rgba(55,65,88,0.4)"}`,
            background: filter === "all" ? "rgba(155,89,182,0.12)" : "transparent",
            color: filter === "all" ? "#9b59b6" : "#444",
          }}>
          Все
        </button>
        {ALL_TYPES.map(t => {
          const cfg = TYPE_CONFIG[t];
          const active = filter === t;
          return (
            <button key={t}
              onClick={() => setFilter(t)}
              style={{
                padding: "2px 7px", borderRadius: 3, fontSize: 10, fontFamily: "monospace", cursor: "pointer",
                border: `1px solid ${active ? cfg.color : "rgba(55,65,88,0.3)"}`,
                background: active ? `${cfg.color}18` : "transparent",
                color: active ? cfg.color : "#444",
              }}>
              {cfg.label}
            </button>
          );
        })}
      </div>

      {/* Log list */}
      <div className="flex-1 overflow-y-auto p-2 flex flex-col gap-0.5 font-mono"
        style={{ fontSize: 11 }}>
        {filtered.length === 0 ? (
          <div style={{ color: "#333", textAlign: "center", marginTop: 40, fontSize: 12 }}>
            {bot ? "Нет записей" : "Выберите бота"}
          </div>
        ) : (
          filtered.map(entry => {
            const cfg = TYPE_CONFIG[entry.type];
            return (
              <div key={entry.id}
                style={{
                  display: "flex", gap: 6, padding: "3px 6px", borderRadius: 3,
                  background: "rgba(14,18,26,0.5)",
                  borderLeft: `2px solid ${cfg.color}60`,
                  alignItems: "flex-start",
                }}>
                <span style={{ color: "#444", flexShrink: 0, fontSize: 10, paddingTop: 1 }}>
                  {ts(entry.ts)}
                </span>
                <span style={{ color: cfg.color, flexShrink: 0, fontSize: 10, paddingTop: 1, minWidth: 50 }}>
                  {cfg.label}
                </span>
                <span style={{ color: "#bbb", wordBreak: "break-word", lineHeight: 1.5 }}>
                  {entry.msg}
                </span>
              </div>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
