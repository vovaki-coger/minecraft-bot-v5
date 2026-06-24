import React, { useState, useEffect, useRef } from "react";
import { useAppStore } from "../../store/appStore";

interface LogEntry {
  id: number;
  ts: number;
  type: "pvp" | "farm" | "task" | "system" | "death" | "error" | "survivor" | "anarchy";
  msg: string;
}

const TYPE_CFG: Record<LogEntry["type"], { color: string; label: string }> = {
  pvp:      { color: "#e74c3c", label: "⚔️ PVP" },
  farm:     { color: "#7ecc49", label: "🌾 Ферма" },
  task:     { color: "#3498db", label: "🎯 Задача" },
  system:   { color: "#9b59b6", label: "⚙️ Система" },
  death:    { color: "#e67e22", label: "💀 Смерть" },
  error:    { color: "#c0392b", label: "❌ Ошибка" },
  survivor: { color: "#f39c12", label: "🛡️ Выживальщик" },
  anarchy:  { color: "#8e44ad", label: "🏴 Анархия" },
};

const ALL_TYPES = Object.keys(TYPE_CFG) as LogEntry["type"][];
let _uid = 0;

function fmtTime(ms: number) {
  const d = new Date(ms);
  return d.toTimeString().slice(0, 8);
}

export default function LogsTab() {
  const selectedBotId = useAppStore(s => s.selectedBotId);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [filter, setFilter] = useState<LogEntry["type"] | "all">("all");
  const [autoScroll, setAutoScroll] = useState(true);
  const logsRef = useRef<LogEntry[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);

  function push(type: LogEntry["type"], msg: string) {
    if (!msg?.trim()) return;
    const e: LogEntry = { id: _uid++, ts: Date.now(), type, msg: msg.trim() };
    logsRef.current = [...logsRef.current.slice(-499), e];
    setLogs([...logsRef.current]);
  }

  useEffect(() => {
    // CORRECT API: window.electronAPI.on(channel, (data) => void)
    // Returns unsubscribe function
    const api = (window as any).electronAPI;
    if (typeof api?.on !== "function") return;

    const unsubs: Array<() => void> = [];

    function sub(ch: string, fn: (d: any) => void) {
      // Filter: if we have a selected bot, only show its events
      const u = api.on(ch, (data: any) => {
        if (selectedBotId && data?.botId && data.botId !== selectedBotId) return;
        fn(data ?? {});
      });
      if (typeof u === "function") unsubs.push(u);
    }

    // bot:actionLog — all debug/action logs (pvp steps, tasks, etc.)
    // d.logType = "pvp"|"farm"|"task"|"system"|"death"|"error"|"survivor"|"anarchy"
    sub("bot:actionLog", d => {
      const t = (ALL_TYPES.includes(d.logType) ? d.logType : "system") as LogEntry["type"];
      const m = d.msg || d.message || "";
      if (m) push(t, m);
    });

    // Status events
    sub("bot:pvpStarted",     () => push("pvp",      "▶ PVP режим запущен"));
    sub("bot:pvpStopped",     () => push("pvp",      "⏹ PVP остановлен"));
    sub("bot:pvpToggled",     d  => push("pvp",      d.pvpMode ? "▶ PVP запущен" : "⏹ PVP остановлен"));
    sub("bot:survivorStarted",() => push("survivor", "▶ Выживальщик запущен"));
    sub("bot:survivorStopped",() => push("survivor", "⏹ Выживальщик остановлен"));
    sub("bot:survivorLog",    d  => push("survivor", d.msg || d.message || d.text || ""));
    sub("bot:farmStarted",    d  => push("farm",     "▶ Фарм: " + (d.task || d.mode || "авто")));
    sub("bot:farmStopped",    () => push("farm",     "⏹ Фарм остановлен"));
    sub("bot:farmLog",        d  => push("farm",     d.msg || d.message || ""));
    sub("bot:anarchyStarted", () => push("anarchy",  "▶ Анархия запущена"));
    sub("bot:anarchyStopped", () => push("anarchy",  "⏹ Анархия остановлена"));
    sub("bot:anarchyLog",     d  => push("anarchy",  d.msg || d.message || ""));
    sub("bot:anarchyPhase",   d  => push("anarchy",  "Фаза: " + (d.phase || "?")));
    sub("bot:actionStopped",  () => push("task",     "⏹ Задача остановлена"));
    sub("bot:death",          d  => push("death",    "💀 Умер! Pos: " + (d.pos ? `${Math.round(d.pos.x||0)} ${Math.round(d.pos.y||0)} ${Math.round(d.pos.z||0)}` : "?")));
    sub("bot:error",          d  => push("error",    d.message || d.msg || "Ошибка"));
    sub("bot:statusChanged",  d  => {
      if (d.status === "online")  push("system", "✅ Подключён к серверу");
      if (d.status === "offline") push("system", "🔌 Отключён: " + (d.reason || "нет причины"));
    });

    return () => unsubs.forEach(u => { try { u(); } catch {} });
  }, [selectedBotId]);

  useEffect(() => {
    if (autoScroll) bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs, autoScroll]);

  const shown = filter === "all" ? logs : logs.filter(l => l.type === filter);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 8px",
        borderBottom: "1px solid rgba(55,65,88,0.5)", background: "rgba(10,12,18,0.95)", flexShrink: 0 }}>
        <span style={{ fontFamily: "monospace", fontSize: 11, fontWeight: 700, color: "#9b59b6" }}>
          📋 Лог действий
        </span>
        <span style={{ fontFamily: "monospace", fontSize: 9, color: "#444" }}>{logs.length} записей</span>
        <div style={{ flex: 1 }} />
        <label style={{ display: "flex", alignItems: "center", gap: 3, cursor: "pointer" }}>
          <input type="checkbox" checked={autoScroll} onChange={e => setAutoScroll(e.target.checked)}
            style={{ accentColor: "#9b59b6", width: 10, height: 10 }} />
          <span style={{ fontFamily: "monospace", fontSize: 9, color: "#555" }}>авто</span>
        </label>
        <button onClick={() => { logsRef.current = []; setLogs([]); }}
          style={{ padding: "1px 7px", borderRadius: 3, fontSize: 9, fontFamily: "monospace",
            border: "1px solid rgba(192,57,43,0.5)", background: "rgba(192,57,43,0.1)",
            color: "#c0392b", cursor: "pointer" }}>
          Очистить
        </button>
      </div>

      {/* Filters */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 3, padding: "5px 7px",
        borderBottom: "1px solid rgba(40,55,80,0.4)", background: "rgba(8,10,16,0.9)", flexShrink: 0 }}>
        {(["all", ...ALL_TYPES] as const).map(t => {
          const cfg = t === "all" ? { color: "#9b59b6", label: "Все" } : TYPE_CFG[t];
          const on = filter === t;
          return (
            <button key={t} onClick={() => setFilter(t as any)}
              style={{ padding: "1px 7px", borderRadius: 3, fontSize: 9, fontFamily: "monospace",
                cursor: "pointer", border: `1px solid ${on ? cfg.color : "rgba(55,65,88,0.3)"}`,
                background: on ? cfg.color + "22" : "transparent",
                color: on ? cfg.color : "#444" }}>
              {cfg.label}
            </button>
          );
        })}
      </div>

      {/* Log entries */}
      <div style={{ flex: 1, overflowY: "auto", padding: "4px 6px", display: "flex",
        flexDirection: "column", gap: 1, fontFamily: "monospace", fontSize: 10.5 }}>
        {shown.length === 0 ? (
          <div style={{ color: "#333", textAlign: "center", marginTop: 40, fontSize: 11 }}>
            {selectedBotId ? "Нет событий" : "Выберите бота"}
          </div>
        ) : shown.map(e => {
          const cfg = TYPE_CFG[e.type];
          return (
            <div key={e.id} style={{ display: "flex", gap: 5, padding: "2px 5px", borderRadius: 2,
              background: "rgba(14,18,26,0.5)", borderLeft: `2px solid ${cfg.color}66`,
              alignItems: "flex-start" }}>
              <span style={{ color: "#3a3a3a", flexShrink: 0, fontSize: 9, paddingTop: 1, minWidth: 52 }}>
                {fmtTime(e.ts)}
              </span>
              <span style={{ color: cfg.color, flexShrink: 0, fontSize: 9, paddingTop: 1, minWidth: 65 }}>
                {cfg.label}
              </span>
              <span style={{ color: "#bbb", wordBreak: "break-word", lineHeight: 1.4 }}>{e.msg}</span>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
