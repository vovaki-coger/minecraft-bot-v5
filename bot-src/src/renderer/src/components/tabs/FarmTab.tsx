import React, { useState, useEffect, useRef } from "react";
import { useAppStore } from "../../store/appStore";

const TREE_TYPES = [
  { id: "oak",      label: "🌳 Дуб",         color: "#7ecc49" },
  { id: "birch",    label: "🌿 Берёза",       color: "#d4e8a0" },
  { id: "spruce",   label: "🌲 Ель",          color: "#2e7d32" },
  { id: "jungle",   label: "🌴 Джунгли",      color: "#4caf50" },
  { id: "acacia",   label: "🍂 Акация",       color: "#ff8a65" },
  { id: "dark_oak", label: "🌑 Тёмный дуб",  color: "#5d4037" },
];

const CROP_TYPES = [
  { id: "wheat",       label: "🌾 Пшеница",     color: "#ffd54f" },
  { id: "carrot",      label: "🥕 Морковка",    color: "#ff7043" },
  { id: "potato",      label: "🥔 Картошка",    color: "#bcaaa4" },
  { id: "beetroot",    label: "🫛 Свёкла",      color: "#c62828" },
  { id: "melon",       label: "🍈 Дыня",        color: "#66bb6a" },
  { id: "pumpkin",     label: "🎃 Тыква",       color: "#fb8c00" },
  { id: "nether_wart", label: "🍄 Нетер. бор.", color: "#c2185b" },
];

type FarmMode = "trees" | "crops" | "quick";

interface TaskLog { msg: string; time: number; }

const MODE_CONFIG: Record<FarmMode, { label: string; color: string; colorRgb: string }> = {
  trees: { label: "🌲 Деревья",     color: "#7ecc49", colorRgb: "126,204,73"  },
  crops: { label: "🌾 Культуры",    color: "#ffd54f", colorRgb: "255,213,79"  },
  quick: { label: "⚡ Быстрый фарм", color: "#00c8ff", colorRgb: "0,200,255" },
};

export default function FarmTab() {
  const { bots, selectedBotId } = useAppStore();
  const bot = bots.find(b => b.id === selectedBotId) || bots[0] || null;

  const [mode, setMode]               = useState<FarmMode>("trees");
  const [treeType, setTreeType]       = useState("oak");
  const [cropType, setCropType]       = useState("wheat");
  const [radius, setRadius]           = useState(20);
  const [isRunning, setIsRunning]     = useState(false);
  const [useBoneMeal, setUseBoneMeal] = useState(true);
  const [delayMs, setDelayMs]         = useState(300);
  const [treeSpacing, setTreeSpacing] = useState(2);
  const [log, setLog]                 = useState<TaskLog[]>([]);
  const logRef                        = useRef<HTMLDivElement>(null);

  const addLog = (msg: string) =>
    setLog(prev => [...prev.slice(-99), { msg, time: Date.now() }]);

  useEffect(() => {
    if (!window.electronAPI) return;
    const unsubs: Array<() => void> = [];
    unsubs.push(window.electronAPI.on("bot:taskLog", (d: any) => {
      if (d?.botId !== bot?.id) return;
      addLog(d.message || String(d.msg || ""));
    }));
    unsubs.push(window.electronAPI.on("bot:survivorLog", (d: any) => {
      if (d?.botId !== bot?.id) return;
      addLog(d.message || String(d.msg || ""));
    }));
    unsubs.push(window.electronAPI.on("bot:taskStarted", (d: any) => {
      if (d?.botId !== bot?.id) return;
      setIsRunning(true);
      addLog("▶️ Задача запущена: " + (d.task || ""));
    }));
    unsubs.push(window.electronAPI.on("bot:taskStopped", (d: any) => {
      if (d?.botId !== bot?.id) return;
      setIsRunning(false);
      addLog("⏹ Ферма остановлена");
    }));
    return () => { for (const fn of unsubs) { try { fn(); } catch {} } };
  }, [bot?.id]);

  useEffect(() => { setIsRunning(false); setLog([]); }, [bot?.id]);
  useEffect(() => { logRef.current?.scrollIntoView({ behavior: "smooth" }); }, [log]);

  async function handleStart() {
    if (!bot || bot.status !== "online") return;
    let taskName: string;
    let args: Record<string, any>;

    if (mode === "quick") {
      taskName = "farm_quick";
      args = { crop: cropType, radius: 3, useBoneMeal };
    } else if (mode === "trees") {
      taskName = "farm_trees";
      args = { radius, crop: treeType, spacing: treeSpacing };
    } else {
      taskName = "farm_crops";
      args = { radius, crop: cropType, useBoneMeal, delay: delayMs };
    }

    setLog([]);
    addLog(`🚀 Запускаю ${MODE_CONFIG[mode].label}...`);

    try {
      await (window.electronAPI?.bot as any).runTask(bot.id, taskName, args);
    } catch {
      const text = mode === "quick"
        ? `быстрый фарм ${cropType}`
        : mode === "trees"
        ? `ферма деревьев ${radius}м ${treeType}`
        : `ферма ${cropType} ${radius}м`;
      addLog(`📨 Отправляю: ${text}`);
      await window.electronAPI.bot.sendChat(bot.id, text);
      setIsRunning(true);
    }
  }

  async function handleStop() {
    if (!bot) return;
    try { await (window.electronAPI?.bot as any).stopTask(bot.id); } catch {
      await window.electronAPI.bot.stopAction(bot.id);
    }
    setIsRunning(false);
    addLog("⏹ Останавливаю...");
  }

  const isOnline = bot?.status === "online";
  const mc = MODE_CONFIG[mode];

  return (
    <div style={{ display:"flex", flexDirection:"column", height:"100%", overflow:"hidden" }}>
      <div style={{ padding:"6px 10px", borderBottom:"1px solid #1a2040", fontSize:11, color:"#2a3a5a", fontFamily:"monospace", background:"#060810" }}>
        🌲 Ферма ресурсов
      </div>

      <div style={{ flex:1, overflowY:"auto", padding:8, display:"flex", flexDirection:"column", gap:7 }}>

        {/* Mode switcher */}
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:4, background:"rgba(0,0,0,.4)", border:"1px solid #1a2040", borderRadius:6, padding:3 }}>
          {(Object.keys(MODE_CONFIG) as FarmMode[]).map(m => (
            <button key={m} onClick={() => setMode(m)} style={{
              padding:"5px 4px", fontSize:10, fontFamily:"monospace", borderRadius:4, cursor:"pointer",
              background: mode===m ? `rgba(${MODE_CONFIG[m].colorRgb},.12)` : "transparent",
              border: mode===m ? `1px solid rgba(${MODE_CONFIG[m].colorRgb},.4)` : "1px solid transparent",
              color: mode===m ? MODE_CONFIG[m].color : "#3a4a6a",
              transition:"all .15s", textAlign:"center",
            }}>
              {MODE_CONFIG[m].label}
            </button>
          ))}
        </div>

        {/* ── Быстрый фарм ────────────────────────────────────── */}
        {mode === "quick" && (
          <div style={{ background:"rgba(0,200,255,.03)", border:"1px solid rgba(0,200,255,.15)", borderRadius:5, padding:10, display:"flex", flexDirection:"column", gap:8 }}>
            <p style={{ fontSize:10, color:"#00c8ff", fontFamily:"monospace", fontWeight:"bold" }}>⚡ БЫСТРЫЙ ФАРМ (Delta-style)</p>
            <p style={{ fontSize:9, color:"#2a4a6a", fontFamily:"monospace", lineHeight:1.5 }}>
              Бот смотрит вниз → сажает семена → применяет костную муку → мгновенно собирает урожай.
              Не нужно никуда идти — работает на месте.
            </p>

            {/* Crop selector */}
            <div>
              <p style={{ fontSize:9, color:"#3a5a7a", fontFamily:"monospace", marginBottom:5 }}>КУЛЬТУРА:</p>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:3 }}>
                {CROP_TYPES.map(c => (
                  <button key={c.id} onClick={() => setCropType(c.id)} disabled={isRunning} style={{
                    padding:"5px 7px", fontSize:10, fontFamily:"monospace", borderRadius:4, cursor: isRunning ? "not-allowed" : "pointer",
                    background: cropType===c.id ? `rgba(0,200,255,.08)` : "rgba(0,0,0,.3)",
                    border: cropType===c.id ? "1px solid rgba(0,200,255,.4)" : "1px solid #1a2040",
                    color: cropType===c.id ? "#00c8ff" : "#3a4a6a", textAlign:"left", transition:"all .15s",
                  }}>{c.label}</button>
                ))}
              </div>
            </div>

            {/* Bone meal toggle */}
            <div style={{ display:"flex", alignItems:"center", gap:8, padding:"6px 8px", background:"rgba(0,0,0,.3)", borderRadius:4, border:"1px solid #1a2040" }}>
              <input type="checkbox" id="qBoneMeal" checked={useBoneMeal} onChange={e => setUseBoneMeal(e.target.checked)}
                disabled={isRunning} style={{ accentColor:"#00c8ff", cursor: isRunning ? "not-allowed" : "pointer", width:13, height:13 }} />
              <label htmlFor="qBoneMeal" style={{ fontSize:10, color: useBoneMeal ? "#00c8ff" : "#3a4a6a", fontFamily:"monospace", cursor: isRunning ? "default" : "pointer" }}>
                🦴 Костная мука (мгновенный рост)
              </label>
            </div>

            <div style={{ fontSize:9, color:"#1e3050", fontFamily:"monospace", padding:"4px 6px", borderLeft:"2px solid rgba(0,200,255,.2)" }}>
              💡 Поставь бота на ферму (грядки под ногами) → нажми Старт
            </div>
          </div>
        )}

        {/* ── Деревья ─────────────────────────────────────────── */}
        {mode === "trees" && (
          <div style={{ background:"rgba(0,0,0,.3)", border:"1px solid #1a2040", borderRadius:5, padding:8 }}>
            <p style={{ fontSize:10, color:"#3a5a7a", fontFamily:"monospace", marginBottom:6 }}>ВИД ДЕРЕВА:</p>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:4 }}>
              {TREE_TYPES.map(t => (
                <button key={t.id} onClick={() => setTreeType(t.id)} style={{
                  padding:"6px 8px", fontSize:11, fontFamily:"monospace", borderRadius:4, cursor:"pointer",
                  background: treeType===t.id ? "rgba(126,204,73,.1)" : "rgba(0,0,0,.3)",
                  border: treeType===t.id ? `1px solid ${t.color}55` : "1px solid #1a2040",
                  color: treeType===t.id ? t.color : "#3a4a6a", textAlign:"left", transition:"all .15s",
                }}>{t.label}</button>
              ))}
            </div>

            {/* Tree spacing */}
            <div style={{ marginTop:8 }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:5 }}>
                <p style={{ fontSize:9, color:"#3a5a7a", fontFamily:"monospace" }}>ИНТЕРВАЛ МЕЖДУ ДЕРЕВЬЯМИ:</p>
                <span style={{ fontSize:12, color:"#7ecc49", fontFamily:"monospace", fontWeight:"bold" }}>{treeSpacing} бл.</span>
              </div>
              <input type="range" min={1} max={6} step={1} value={treeSpacing} onChange={e => setTreeSpacing(Number(e.target.value))}
                disabled={isRunning} style={{ width:"100%", accentColor:"#7ecc49", cursor: isRunning ? "not-allowed" : "pointer" }} />
              <div style={{ display:"flex", justifyContent:"space-between", fontSize:9, color:"#2a3a5a", fontFamily:"monospace", marginTop:2 }}>
                <span>1 (плотно)</span><span>3 (норма)</span><span>6 (просторно)</span>
              </div>
            </div>
          </div>
        )}

        {/* ── Культуры ────────────────────────────────────────── */}
        {mode === "crops" && (
          <div style={{ background:"rgba(0,0,0,.3)", border:"1px solid #1a2040", borderRadius:5, padding:8 }}>
            <p style={{ fontSize:10, color:"#3a5a7a", fontFamily:"monospace", marginBottom:6 }}>ВИД КУЛЬТУРЫ:</p>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:4 }}>
              {CROP_TYPES.map(c => (
                <button key={c.id} onClick={() => setCropType(c.id)} style={{
                  padding:"6px 8px", fontSize:11, fontFamily:"monospace", borderRadius:4, cursor:"pointer",
                  background: cropType===c.id ? `rgba(255,213,79,.08)` : "rgba(0,0,0,.3)",
                  border: cropType===c.id ? `1px solid ${c.color}55` : "1px solid #1a2040",
                  color: cropType===c.id ? c.color : "#3a4a6a", textAlign:"left", transition:"all .15s",
                }}>{c.label}</button>
              ))}
            </div>
            <div style={{ display:"flex", alignItems:"center", gap:8, marginTop:8, padding:"6px 8px", background:"rgba(0,0,0,.3)", borderRadius:4, border:"1px solid #1a2040" }}>
              <input type="checkbox" id="boneMeal" checked={useBoneMeal} onChange={e => setUseBoneMeal(e.target.checked)}
                disabled={isRunning} style={{ accentColor:"#ffd54f", cursor: isRunning ? "not-allowed" : "pointer", width:13, height:13 }} />
              <label htmlFor="boneMeal" style={{ fontSize:10, color: useBoneMeal ? "#ffd54f" : "#3a4a6a", fontFamily:"monospace", cursor: isRunning ? "default" : "pointer" }}>
                🦴 Костная мука (bone meal)
              </label>
            </div>
          </div>
        )}

        {/* Radius (not for quick mode) */}
        {mode !== "quick" && (
          <div style={{ background:"rgba(0,0,0,.3)", border:"1px solid #1a2040", borderRadius:5, padding:8 }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:6 }}>
              <p style={{ fontSize:10, color:"#3a5a7a", fontFamily:"monospace" }}>РАДИУС ЗОНЫ:</p>
              <span style={{ fontSize:13, color:mc.color, fontFamily:"monospace", fontWeight:"bold" }}>{radius}м</span>
            </div>
            <input type="range" min={5} max={60} step={5} value={radius} onChange={e => setRadius(Number(e.target.value))}
              disabled={isRunning} style={{ width:"100%", accentColor:mc.color, cursor: isRunning ? "not-allowed" : "pointer" }} />
            <div style={{ display:"flex", justifyContent:"space-between", fontSize:9, color:"#2a3a5a", fontFamily:"monospace", marginTop:2 }}>
              <span>5м</span><span>30м</span><span>60м</span>
            </div>
          </div>
        )}

        {/* Delay (crops only) */}
        {mode === "crops" && (
          <div style={{ background:"rgba(0,0,0,.3)", border:"1px solid #1a2040", borderRadius:5, padding:8 }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:6 }}>
              <p style={{ fontSize:10, color:"#3a5a7a", fontFamily:"monospace" }}>ЗАДЕРЖКА ДЕЙСТВИЙ:</p>
              <span style={{ fontSize:13, color:"#7aa0c4", fontFamily:"monospace", fontWeight:"bold" }}>{delayMs}мс</span>
            </div>
            <input type="range" min={50} max={1000} step={50} value={delayMs} onChange={e => setDelayMs(Number(e.target.value))}
              disabled={isRunning} style={{ width:"100%", accentColor:"#7aa0c4", cursor: isRunning ? "not-allowed" : "pointer" }} />
            <div style={{ display:"flex", justifyContent:"space-between", fontSize:9, color:"#2a3a5a", fontFamily:"monospace", marginTop:2 }}>
              <span>50мс (быстро)</span><span>500мс</span><span>1000мс (медленно)</span>
            </div>
          </div>
        )}

        {/* Summary */}
        <div style={{ background:`rgba(${mc.colorRgb},.04)`, border:`1px solid rgba(${mc.colorRgb},.15)`, borderRadius:5, padding:"7px 10px" }}>
          <p style={{ fontSize:10, fontFamily:"monospace", color:"#3a5070" }}>
            Задача:&nbsp;
            <span style={{ color: mc.color }}>
              {mode === "quick"
                ? `Быстрый фарм ${CROP_TYPES.find(c=>c.id===cropType)?.label} (на месте)`
                : mode === "trees"
                ? `${TREE_TYPES.find(t=>t.id===treeType)?.label} в зоне ${radius}м, интервал ${treeSpacing}бл`
                : `${CROP_TYPES.find(c=>c.id===cropType)?.label} в зоне ${radius}м`}
            </span>
          </p>
          <p style={{ fontSize:9, color:"#2a3a5a", marginTop:3 }}>
            {mode === "quick" ? "⚡ Мгновенный рост с костной мукой" :
             mode === "trees" ? "Рубит → сажает саженцы → бонемил → повторяет" :
             (useBoneMeal ? "🦴 Костная мука включена" : "Без костной муки") + " · задержка " + delayMs + "мс"}
          </p>
        </div>

        {/* Start/Stop */}
        <button onClick={isRunning ? handleStop : handleStart} disabled={!isOnline} style={{
          padding:"10px 0", fontSize:12, fontFamily:"monospace", borderRadius:5, cursor: isOnline ? "pointer" : "not-allowed",
          background: isRunning ? "rgba(255,34,85,.08)" : isOnline ? `rgba(${mc.colorRgb},.08)` : "rgba(0,0,0,.3)",
          border: isRunning ? "1px solid rgba(255,34,85,.4)" : isOnline ? `1px solid rgba(${mc.colorRgb},.4)` : "1px solid #1a2040",
          color: isRunning ? "#ff2255" : isOnline ? mc.color : "#2a3a5a",
          boxShadow: isRunning ? "0 0 12px rgba(255,34,85,.15)" : isOnline ? `0 0 12px rgba(${mc.colorRgb},.1)` : "none",
          transition:"all .2s", opacity: isOnline ? 1 : 0.4,
        }}>
          {!isOnline ? "⚠️ Бот не в сети" : isRunning ? "⏹ Остановить" : "▶ Запустить"}
        </button>

        {/* Log */}
        {log.length > 0 && (
          <div style={{ background:"rgba(0,0,0,.4)", border:"1px solid #1a2040", borderRadius:5, overflow:"hidden" }}>
            <div style={{ padding:"4px 8px", borderBottom:"1px solid #1a2040", fontSize:9, color:"#2a3a5a", fontFamily:"monospace" }}>
              ЛОГИ ФЕРМЫ
            </div>
            <div style={{ maxHeight:160, overflowY:"auto", padding:6 }}>
              {log.map((entry, i) => {
                const d = new Date(entry.time);
                const t = `${d.getHours().toString().padStart(2,"0")}:${d.getMinutes().toString().padStart(2,"0")}:${d.getSeconds().toString().padStart(2,"0")}`;
                const col = entry.msg.startsWith("⏹") ? "#ff5555"
                          : entry.msg.startsWith("▶") || entry.msg.startsWith("🚀") || entry.msg.startsWith("✅") ? mc.color
                          : entry.msg.includes("⚠️") ? "#ff9900"
                          : "#4a6080";
                return (
                  <div key={i} style={{ fontSize:10, fontFamily:"monospace", color:"#4a6080", marginBottom:2, lineHeight:1.4 }}>
                    <span style={{ color:"#2a3a5a" }}>[{t}]</span>{" "}
                    <span style={{ color: col }}>{entry.msg}</span>
                  </div>
                );
              })}
              <div ref={logRef} />
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
