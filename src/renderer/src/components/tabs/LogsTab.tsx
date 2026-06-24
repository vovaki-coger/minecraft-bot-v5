import React, { useState, useEffect, useRef } from "react";
import { useAppStore } from "../../store/appStore";

interface LogEntry {
  id: number;
  ts: number;
  type: "pvp" | "farm" | "task" | "system" | "death" | "error" | "survivor" | "anarchy";
  msg: string;
}

const TYPE_CONFIG: Record<LogEntry["type"], { color: string; label: string }> = {
  pvp:      { color: "#e74c3c", label: "⚔️ PVP" },
  farm:     { color: "#7ecc49", label: "🌾 Ферма" },
  task:     { color: "#3498db", label: "🎯 Задача" },
  system:   { color: "#9b59b6", label: "⚙️ Система" },
  death:    { color: "#e67e22", label: "💀 Смерть" },
  error:    { color: "#c0392b", label: "❌ Ошибка" },
  survivor: { color: "#f39c12", label: "🛡️ Выживальщик" },
  anarchy:  { color: "#8e44ad", label: "🏴‍☠️ Анархия" },
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
    if (!msg?.trim()) return;
    const entry: LogEntry = { id: _logId++, ts: Date.now(), type, msg };
    logsRef.current = [...logsRef.current.slice(-399), entry];
    setLogs([...logsRef.current]);
  }

  useEffect(() => {
    const api = (window as any).electronAPI;
    if (!api?.onBotEvent) return;

    const handlers: Array<() => void> = [];

    function sub(ch: string, fn: (d: any) => void) {
      const unsub = api.onBotEvent((channel: string, data: any) => {
        if (channel !== ch) return;
        if (data?.botId && selectedBotId && data.botId !== selectedBotId) return;
        fn(data);
      });
      handlers.push(unsub);
    }

    sub("bot:actionLog",        d => addLog(d.logType || "system", d.msg || d.message || ""));
    sub("bot:pvpStarted",       () => addLog("pvp",     "▶ PVP режим запущен — крит+спринт"));
    sub("bot:pvpStopped",       () => addLog("pvp",     "⏹ PVP режим остановлен"));
    sub("bot:pvpToggled",       d => addLog("pvp",      d.pvpMode ? "▶ PVP запущен" : "⏹ PVP остановлен"));
    sub("bot:pvpDetected",      d => addLog("pvp",      `🎯 Враг обнаружен: ${d.enemy ?? "?"} | HP=${d.health ?? "?"}`));
    sub("bot:death",            d => addLog("death",    `💀 Умер! Pos: ${d.pos?.x ?? "?"} ${d.pos?.y ?? "?"} ${d.pos?.z ?? "?"}`));
    sub("bot:error",            d => addLog("error",    `❌ ${d.message ?? d.msg ?? "Ошибка"}`));
    sub("bot:statusChanged",    d => {
      if (d.status === "online")  addLog("system", `✅ Подключён к серверу`);
      if (d.status === "offline") addLog("system", `🔌 Отключён — ${d.reason ?? "нет причины"}`);
    });
    sub("bot:actionStopped",    () => addLog("task",    "⏹ Задача/действие остановлено"));
    sub("bot:survivorStarted",  () => addLog("survivor","▶ Режим выживальщика запущен"));
    sub("bot:survivorStopped",  () => addLog("survivor","⏹ Режим выживальщика остановлен"));
    sub("bot:survivorLog",      d => addLog("survivor", d.msg || d.message || d.text || ""));
    sub("bot:farmStarted",      d => addLog("farm",     `▶ Фарм запущен: ${d.task ?? d.mode ?? "авто"}`));
    sub("bot:farmStopped",      () => addLog("farm",    "⏹ Фарм остановлен"));
    sub("bot:farmLog",          d => addLog("farm",     d.msg || d.message || d.text || ""));
    sub("bot:anarchyStarted",   () => addLog("anarchy", "▶ Анархия-протокол запущен"));
    sub("bot:anarchyStopped",   () => addLog("anarchy", "⏹ Анархия-протокол остановлен"));
    sub("bot:anarchyLog",       d => addLog("anarchy",  d.msg || d.message || d.text || ""));
    sub("bot:anarchyPhase",     d => addLog("anarchy",  `Фаза: ${d.phase ?? "?"}`));

    return () => handlers.forEach(u => { try { u?.(); } catch {} });
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
      <div className="px-2 py-1.5 border-b flex items-center gap-2"
        style={{ borderColor: "rgba(55,65,88,0.5)", background: "rgba(10,12,18,0.9)", flexWrap: "wrap" }}>
        <span className="font-mono text-xs font-bold" style={{ color: "#9b59b6" }}>
          📋 Лог действий
        </span>
        <span style={{ color: "#333", fontSize: 10, fontFamily: "monospace" }}>{logs.length}</span>
        <div style={{ flex: 1 }} />
        <label style={{ display: "flex", alignItems: "center", gap: 3, cursor: "pointer" }}>
          <input type="checkbox" checked={autoScroll} onChange={e => setAutoScroll(e.target.checked)}
            style={{ accentColor: "#9b59b6", width: 10, height: 10 }} />
          <span style={{ color: "#555", fontSize: 9, fontFamily: "monospace" }}>скролл</span>
        </label>
        <button onClick={() => { logsRef.current = []; setLogs([]); }}
          style={{
            padding: "1px 6px", borderRadius: 3, fontSize: 9, fontFamily: "monospace",
            border: "1px solid rgba(192,57,43,0.4)", background: "rgba(192,57,43,0.08)",
            color: "#c0392b", cursor: "pointer",
          }}>
          Очистить
        </button>
      </div>

      {/* Filter chips */}
      <div className="px-1.5 py-1 border-b"
        style={{ borderColor: "rgba(40,55,80,0.4)", background: "rgba(8,10,16,0.85)",
          display: "flex", gap: 3, flexWrap: "wrap" }}>
        {(["all", ...ALL_TYPES] as const).map(t => {
          const cfg = t === "all" ? { color: "#9b59b6", label: "Все" } : TYPE_CONFIG[t];
          const active = filter === t;
          return (
            <button key={t} onClick={() => setFilter(t as any)}
              style={{
                padding: "1px 6px", borderRadius: 3, fontSize: 9, fontFamily: "monospace", cursor: "pointer",
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
      <div className="flex-1 overflow-y-auto p-1.5 flex flex-col gap-px font-mono"
        style={{ fontSize: 10.5 }}>
        {filtered.length === 0 ? (
          <div style={{ color: "#333", textAlign: "center", marginTop: 40, fontSize: 11 }}>
            {bot ? "Нет записей" : "Выберите бота"}
          </div>
        ) : (
          filtered.map(entry => {
            const cfg = TYPE_CONFIG[entry.type];
            return (
              <div key={entry.id} style={{
                display: "flex", gap: 5, padding: "2px 5px", borderRadius: 2,
                background: "rgba(14,18,26,0.5)",
                borderLeft: `2px solid ${cfg.color}55`,
                alignItems: "flex-start",
              }}>
                <span style={{ color: "#444", flexShrink: 0, fontSize: 9, paddingTop: 1, minWidth: 50 }}>
                  {ts(entry.ts)}
                </span>
                <span style={{ color: cfg.color, flexShrink: 0, fontSize: 9, paddingTop: 1, minWidth: 60 }}>
                  {cfg.label}
                </span>
                <span style={{ color: "#bbb", wordBreak: "break-word", lineHeight: 1.45 }}>
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
