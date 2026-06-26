import React, { useState, useEffect, useRef } from "react";
import { useAppStore } from "../../store/appStore";

export default function MinerTab() {
  const { bots, selectedBotId } = useAppStore();
  const bot = bots.find(b => b.id === selectedBotId) || null;

  const [x1, setX1] = useState(""); const [y1, setY1] = useState(""); const [z1, setZ1] = useState("");
  const [x2, setX2] = useState(""); const [y2, setY2] = useState(""); const [z2, setZ2] = useState("");
  const [running, setRunning] = useState(false);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<{dug:number;total:number;msg:string}|null>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [brainTraining, setBrainTraining] = useState(false);
  const [brainPct, setBrainPct] = useState(0);
  const [brainMsg, setBrainMsg] = useState("Загрузка...");

  const isOnline = bot?.status === "online";

  useEffect(() => {
    if (!window.electronAPI) return;
    const unsubs = [
      window.electronAPI.on("bot:excavateProgress", (d: any) => {
        if (d.botId !== bot?.id) return;
        setProgress({ dug: d.dug, total: d.total, msg: d.msg });
        setLogs(prev => [...prev.slice(-49), d.msg]);
      }),
      window.electronAPI.on("bot:excavateDone", (d: any) => {
        if (d.botId !== bot?.id) return;
        setRunning(false);
        setProgress(null);
        setLogs(prev => [...prev, `✅ Готово! Выкопано: ${d.dug}, пропущено: ${d.skipped}`]);
      }),
      window.electronAPI.on("bot:minerBrainTraining", (d: any) => {
        if (d?.botId !== bot?.id) return;
        setBrainTraining(true);
        setBrainPct(d.pct ?? 0);
        setBrainMsg(d.msg ?? "Обучение...");
      }),
      window.electronAPI.on("bot:minerBrainReady", (d: any) => {
        if (d?.botId !== bot?.id) return;
        setBrainTraining(false);
        setBrainPct(100);
      }),
    ];
    return () => unsubs.forEach(fn => fn?.());
  }, [bot?.id]);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [logs]);

  function useBotPos() {
    const pos = (bot as any)?.position;
    if (!pos) return;
    setX1(Math.floor(pos.x).toString());
    setY1(Math.floor(pos.y).toString());
    setZ1(Math.floor(pos.z).toString());
  }

  function calcVolume() {
    const nx1=parseInt(x1)||0, ny1=parseInt(y1)||0, nz1=parseInt(z1)||0;
    const nx2=parseInt(x2)||0, ny2=parseInt(y2)||0, nz2=parseInt(z2)||0;
    const vol = (Math.abs(nx2-nx1)+1)*(Math.abs(ny2-ny1)+1)*(Math.abs(nz2-nz1)+1);
    return isNaN(vol) ? 0 : vol;
  }

  const vol = calcVolume();

  async function startMiner() {
    if (!bot || !x1||!y1||!z1||!x2||!y2||!z2) return;
    setLoading(true);
    try {
      setLogs([]);
      await (window.electronAPI.bot as any).startExcavate(bot.id, {
        x1: parseInt(x1), y1: parseInt(y1), z1: parseInt(z1),
        x2: parseInt(x2), y2: parseInt(y2), z2: parseInt(z2),
      });
      setRunning(true);
    } catch (e: any) { alert(e.message); }
    setLoading(false);
  }

  async function stopMiner() {
    if (!bot) return;
    await (window.electronAPI.bot as any).stopExcavate(bot.id);
    setRunning(false);
    setProgress(null);
  }

  const pct = progress && progress.total > 0 ? Math.round(progress.dug / progress.total * 100) : 0;

  const inputStyle = {
    width: "100%", background: "rgba(255,255,255,0.04)",
    border: "1px solid #2a3550", borderRadius: 4,
    padding: "5px 8px", color: "#ddd", fontFamily: "monospace",
    fontSize: 12, outline: "none", textAlign: "center" as const,
  };

  return (
    <div className="flex flex-col h-full overflow-hidden p-3 gap-3" style={{ position: "relative" }}>

      {/* ── ОВЕРЛЕЙ ОБУЧЕНИЯ MINER-МОЗГА ──────────────────────────────── */}
      {brainTraining && (
        <div style={{
          position: "absolute", inset: 0, zIndex: 50,
          background: "rgba(8,10,16,0.96)",
          display: "flex", flexDirection: "column",
          alignItems: "center", justifyContent: "center",
          gap: 18, borderRadius: 8,
          backdropFilter: "blur(6px)",
        }}>
          <div style={{
            width: 52, height: 52, borderRadius: "50%",
            border: "3px solid rgba(230,126,34,0.15)",
            borderTopColor: "#e67e22",
            animation: "spin 0.9s linear infinite",
          }} />
          <div style={{ textAlign: "center", display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ fontSize: 13, fontFamily: "monospace", color: "#e67e22", fontWeight: "bold", textShadow: "0 0 12px rgba(230,126,34,0.5)" }}>
              ⛏ Майнер: обучение нейросети
            </div>
            <div style={{ fontSize: 11, fontFamily: "monospace", color: "#6a4a20", maxWidth: 260, lineHeight: 1.5 }}>
              {brainMsg}
            </div>
          </div>
          <div style={{ width: 220 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, fontFamily: "monospace", color: "#5a4a30", marginBottom: 6 }}>
              <span>Прогресс</span>
              <span style={{ color: "#e67e22" }}>{Math.round(brainPct)}%</span>
            </div>
            <div style={{ height: 6, background: "rgba(230,126,34,0.1)", borderRadius: 3, overflow: "hidden", border: "1px solid rgba(230,126,34,0.2)" }}>
              <div style={{
                height: "100%", borderRadius: 3, transition: "width 0.4s ease",
                width: `${brainPct}%`,
                background: "linear-gradient(90deg, #8a4010, #e67e22)",
                boxShadow: "0 0 8px rgba(230,126,34,0.4)",
              }} />
            </div>
          </div>
          <div style={{ fontSize: 10, fontFamily: "monospace", color: "#3a2a10" }}>
            Первый запуск — обучается один раз, затем мгновенно
          </div>
        </div>
      )}
      <div className="text-xs font-mono font-bold" style={{ color: "#e67e22" }}>
        ⛏ Шахтёр — раскопка территории
      </div>

      {!isOnline && (
        <div className="text-xs text-center" style={{ color: "#444" }}>Подключите бота</div>
      )}

      {/* Координаты */}
      <div className="panel p-3 flex flex-col gap-2">
        <div className="text-xs" style={{ color: "#888" }}>Точка 1 (X Y Z):</div>
        <div className="flex gap-2">
          {[["X", x1, setX1], ["Y", y1, setY1], ["Z", z1, setZ1]].map(([lbl, val, set]) => (
            <div key={String(lbl)} className="flex flex-col gap-0.5" style={{ flex: 1 }}>
              <div className="text-xs text-center" style={{ color: "#555" }}>{lbl}</div>
              <input type="number" value={String(val)} onChange={e => (set as Function)(e.target.value)}
                style={inputStyle} placeholder="0" />
            </div>
          ))}
          <button onClick={useBotPos} title="Взять позицию бота"
            style={{
              alignSelf: "flex-end", padding: "5px 10px", fontSize: 10,
              background: "rgba(126,204,73,0.08)", border: "1px solid rgba(126,204,73,0.3)",
              color: "#7ecc49", borderRadius: 4, cursor: "pointer", fontFamily: "monospace", whiteSpace: "nowrap",
            }}>📍 Моя поз.</button>
        </div>

        <div className="text-xs" style={{ color: "#888" }}>Точка 2 (X Y Z):</div>
        <div className="flex gap-2">
          {[["X", x2, setX2], ["Y", y2, setY2], ["Z", z2, setZ2]].map(([lbl, val, set]) => (
            <div key={String(lbl)} className="flex flex-col gap-0.5" style={{ flex: 1 }}>
              <div className="text-xs text-center" style={{ color: "#555" }}>{lbl}</div>
              <input type="number" value={String(val)} onChange={e => (set as Function)(e.target.value)}
                style={inputStyle} placeholder="0" />
            </div>
          ))}
        </div>

        {vol > 0 && (
          <div className="text-xs text-center px-2 py-1 rounded" style={{ background: "rgba(230,126,34,0.08)", color: "#e67e22", border: "1px solid rgba(230,126,34,0.2)" }}>
            📐 Объём: {vol.toLocaleString()} блоков ({Math.abs(parseInt(x2||"0")-parseInt(x1||"0"))+1}×{Math.abs(parseInt(y2||"0")-parseInt(y1||"0"))+1}×{Math.abs(parseInt(z2||"0")-parseInt(z1||"0"))+1})
          </div>
        )}
      </div>

      {/* Прогресс */}
      {running && progress && (
        <div className="panel p-3 flex flex-col gap-2">
          <div className="flex justify-between text-xs">
            <span style={{ color: "#e67e22" }}>⛏ Раскопка...</span>
            <span style={{ color: "#7ecc49" }}>{progress.dug.toLocaleString()} / {progress.total.toLocaleString()} ({pct}%)</span>
          </div>
          <div style={{ height: 6, background: "#1a2540", borderRadius: 3, overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${pct}%`, background: "#e67e22", borderRadius: 3, transition: "width 0.3s" }} />
          </div>
          <div className="text-xs" style={{ color: "#888" }}>{progress.msg}</div>
        </div>
      )}

      {/* Кнопка */}
      <button
        onClick={running ? stopMiner : startMiner}
        disabled={!isOnline || loading || (!running && (!x1||!y1||!z1||!x2||!y2||!z2))}
        style={{
          padding: "8px", fontSize: 12, fontFamily: "monospace", fontWeight: 700,
          background: running ? "rgba(231,76,60,0.12)" : "rgba(230,126,34,0.12)",
          border: `1px solid ${running ? "#e74c3c" : "#e67e22"}`,
          color: running ? "#e74c3c" : "#e67e22",
          borderRadius: 6, cursor: "pointer", width: "100%",
        }}>
        {loading ? "⏳..." : running ? "⏹ Остановить раскопку" : "⛏ Начать раскопку"}
      </button>

      {/* Лог */}
      <div className="panel flex-1 overflow-hidden flex flex-col">
        <div className="px-2 py-1 text-xs" style={{ color: "#444", borderBottom: "1px solid #1a2540" }}>
          Лог раскопки ({logs.length} записей)
        </div>
        <div ref={logRef} className="flex-1 overflow-y-auto p-2 flex flex-col gap-0.5"
          style={{ fontFamily: "monospace", fontSize: 11 }}>
          {logs.length === 0 ? (
            <div style={{ color: "#333", textAlign: "center", marginTop: 16 }}>
              Укажи 2 точки и запусти раскопку
            </div>
          ) : logs.map((l, i) => (
            <div key={i} style={{ color: l.startsWith("✅") ? "#7ecc49" : "#888" }}>{l}</div>
          ))}
        </div>
      </div>
    </div>
  );
}
