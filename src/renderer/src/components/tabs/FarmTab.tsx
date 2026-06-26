import React, { useState, useEffect } from "react";
import { BotState } from "../../store/appStore";

interface PotionOption { id: string; label: string; emoji: string; ingredients: string[]; }

const POTION_OPTIONS: PotionOption[] = [
  { id: "strength_1",     label: "Сила I (3 мин)",             emoji: "⚔️", ingredients: ["Стержень визера (топливо)", "Адский гриб × 3 (основа)", "Пыль визера × 3"] },
  { id: "strength_2",     label: "Сила II (1.5 мин)",          emoji: "⚔️", ingredients: ["Стержень визера (топливо)", "Адский гриб × 3 (основа)", "Пыль визера × 3", "Светокаменная пыль × 3"] },
  { id: "speed_1",        label: "Скорость I (3 мин)",         emoji: "🏃", ingredients: ["Стержень визера (топливо)", "Адский гриб × 3 (основа)", "Сахар × 3"] },
  { id: "speed_2",        label: "Скорость II (1.5 мин)",      emoji: "🏃", ingredients: ["Стержень визера (топливо)", "Адский гриб × 3 (основа)", "Сахар × 3", "Светокаменная пыль × 3"] },
  { id: "fire_resistance",label: "Огнестойкость (4 мин)",      emoji: "🔥", ingredients: ["Стержень визера (топливо)", "Адский гриб × 3 (основа)", "Магматический крем × 3"] },
  { id: "invisibility",   label: "Невидимость (3 мин)",        emoji: "👁️", ingredients: ["Стержень визера (топливо)", "Адский гриб × 3 (основа)", "Золотая морковь × 3", "Паучий глаз (фермент.) × 3"] },
  { id: "leaping_1",      label: "Прыжок I (3 мин)",           emoji: "🐇", ingredients: ["Стержень визера (топливо)", "Адский гриб × 3 (основа)", "Кроличья лапка × 3"] },
  { id: "leaping_2",      label: "Прыжок II (1.5 мин)",        emoji: "🐇", ingredients: ["Стержень визера (топливо)", "Адский гриб × 3 (основа)", "Кроличья лапка × 3", "Светокаменная пыль × 3"] },
  { id: "water_breathing",label: "Водное дыхание (4 мин)",     emoji: "🐟", ingredients: ["Стержень визера (топливо)", "Адский гриб × 3 (основа)", "Рыба-шар × 3"] },
  { id: "night_vision",   label: "Ночное зрение (4 мин)",      emoji: "🌙", ingredients: ["Стержень визера (топливо)", "Адский гриб × 3 (основа)", "Золотая морковь × 3"] },
  { id: "regeneration_1", label: "Регенерация I (45 сек)",     emoji: "💚", ingredients: ["Стержень визера (топливо)", "Адский гриб × 3 (основа)", "Слеза гаста × 3"] },
  { id: "regeneration_2", label: "Регенерация II (22 сек)",    emoji: "💚", ingredients: ["Стержень визера (топливо)", "Адский гриб × 3 (основа)", "Слеза гаста × 3", "Светокаменная пыль × 3"] },
  { id: "healing_1",      label: "Лечение I (мгновенное)",     emoji: "❤️", ingredients: ["Стержень визера (топливо)", "Адский гриб × 3 (основа)", "Блестящая дыня × 3"] },
  { id: "healing_2",      label: "Лечение II (мгновенное)",    emoji: "❤️", ingredients: ["Стержень визера (топливо)", "Адский гриб × 3 (основа)", "Блестящая дыня × 3", "Светокаменная пыль × 3"] },
  { id: "poison_1",       label: "Отравление I (45 сек)",      emoji: "☠️", ingredients: ["Стержень визера (топливо)", "Адский гриб × 3 (основа)", "Паучий глаз × 3"] },
  { id: "slowness",       label: "Замедление (1.5 мин)",       emoji: "🐢", ingredients: ["Стержень визера (топливо)", "Адский гриб × 3 (основа)", "Сахар × 3", "Паучий глаз (фермент.) × 3"] },
];

const CROPS = [
  // Стандартные
  { id: "wheat_seeds",    name: "🌾 Пшеница",      type: "standard" },
  { id: "carrot",         name: "🥕 Морковь",       type: "standard" },
  { id: "potato",         name: "🥔 Картофель",     type: "standard" },
  { id: "beetroot_seeds", name: "🟤 Свёкла",        type: "standard" },
  // Плодовые (нужно место под плод)
  { id: "melon_seeds",    name: "🍈 Дыня",          type: "fruit" },
  { id: "pumpkin_seeds",  name: "🎃 Тыква",         type: "fruit" },
  // Нижний мир
  { id: "nether_wart",    name: "🔴 Адск. бородавка", type: "nether" },
  // Вертикальные
  { id: "sugar_cane",     name: "🎍 Тростник",      type: "vertical" },
  { id: "bamboo",         name: "🎋 Бамбук",         type: "vertical" },
  { id: "cactus",         name: "🌵 Кактус",         type: "vertical" },
  // Ягоды / грибы
  { id: "sweet_berries",  name: "🍓 Ягоды",          type: "berry" },
  { id: "red_mushroom",   name: "🍄 Гриб (красный)", type: "mushroom" },
  { id: "brown_mushroom", name: "🍄 Гриб (коричн.)", type: "mushroom" },
  // Конец
  { id: "chorus_flower",  name: "💜 Хорус-цветок",  type: "chorus" },
];

const SAPLINGS = [
  { id: "oak_sapling",      name: "🌳 Дуб" },
  { id: "birch_sapling",    name: "🌲 Берёза" },
  { id: "spruce_sapling",   name: "🌲 Ель" },
  { id: "jungle_sapling",   name: "🌴 Джунгли" },
  { id: "acacia_sapling",   name: "🌳 Акация" },
  { id: "dark_oak_sapling", name: "🌑 Тёмный дуб" },
  { id: "mangrove_propagule", name: "🌿 Мангровое" },
];

const TYPE_LABEL: Record<string, string> = {
  standard: "обычные",
  fruit:    "плодовые",
  nether:   "нижний мир",
  vertical: "вертикальные",
  berry:    "ягоды",
  mushroom: "грибы",
  chorus:   "конец",
};

interface Props { bot: BotState | null; }

export default function FarmTab({ bot }: Props) {
  const [activeMode, setActiveMode] = useState<"crops"|"quick"|"trees"|"brewing">("crops");

  // Crops mode
  const [selectedCrop, setSelectedCrop] = useState("wheat_seeds");
  const [cropRadius, setCropRadius]     = useState(10);
  const [useBonemeal, setUseBonemeal]   = useState(true);
  const [depositChest, setDepositChest] = useState(true);
  const [farmRunning, setFarmRunning]   = useState(false);

  // Quick mode
  const [quickCrop, setQuickCrop]     = useState("wheat_seeds");
  const [quickRunning, setQuickRunning] = useState(false);

  // Trees mode
  const [selectedSapling, setSelectedSapling] = useState("oak_sapling");
  const [treeSpacing, setTreeSpacing]         = useState(3);
  const [treeRadius, setTreeRadius]           = useState(20);
  const [treeRunning, setTreeRunning]         = useState(false);

  // Brewing mode
  const [selectedPotion, setSelectedPotion] = useState("strength_1");
  const [wantSplash, setWantSplash]         = useState(false);
  const [wantLong, setWantLong]             = useState(false);
  const [brewRunning, setBrewRunning]       = useState(false);
  const currentPotion = POTION_OPTIONS.find(p => p.id === selectedPotion) || POTION_OPTIONS[0];

  const [loading, setLoading] = useState<string | null>(null);
  const [brainTraining, setBrainTraining] = useState(false);
  const [brainPct, setBrainPct] = useState(0);
  const [brainMsg, setBrainMsg] = useState("Загрузка...");
  const [brainType, setBrainType] = useState("");
  const isOnline = bot?.status === "online";
  const offline = !isOnline;

  useEffect(() => {
    const api = (window as any).electronAPI;
    if (typeof api?.on !== "function") return;
    const unsubs: Array<() => void> = [];
    const u1 = api.on("bot:farmBrainTraining", (d: any) => {
      if (!bot || d?.botId !== bot.id) return;
      setBrainTraining(true);
      setBrainPct(d.pct ?? 0);
      setBrainMsg(d.msg ?? "Обучение...");
      setBrainType(d.brainType ?? "");
    });
    if (typeof u1 === "function") unsubs.push(u1);
    const u2 = api.on("bot:farmBrainReady", (d: any) => {
      if (!bot || d?.botId !== bot.id) return;
      setBrainTraining(false);
      setBrainPct(100);
    });
    if (typeof u2 === "function") unsubs.push(u2);
    return () => unsubs.forEach(u => { try { u(); } catch {} });
  }, [bot?.id]);

  // ── crop groups ────────────────────────────────────────────────────────
  const cropGroups = Object.entries(
    CROPS.reduce((acc, c) => { (acc[c.type] = acc[c.type] || []).push(c); return acc; }, {} as Record<string, typeof CROPS>)
  );

  async function startFarm() {
    if (!bot) return; setLoading("farm");
    try {
      await (window.electronAPI.bot as any).startFarm(bot.id, {
        type: "crops", crop: selectedCrop, radius: cropRadius,
        bonemeal: useBonemeal, depositChest,
      });
      setFarmRunning(true);
    } catch (e: any) { alert(e.message); }
    setLoading(null);
  }
  async function stopFarm() {
    if (!bot) return;
    await (window.electronAPI.bot as any).stopFarm(bot.id);
    setFarmRunning(false);
  }

  async function startQuick() {
    if (!bot) return; setLoading("quick");
    try {
      await (window.electronAPI.bot as any).startFarm(bot.id, {
        type: "quick", crop: quickCrop, bonemeal: true,
      });
      setQuickRunning(true);
    } catch (e: any) { alert(e.message); }
    setLoading(null);
  }
  async function stopQuick() {
    if (!bot) return;
    await (window.electronAPI.bot as any).stopFarm(bot.id);
    setQuickRunning(false);
  }

  async function startTrees() {
    if (!bot) return; setLoading("trees");
    try {
      await (window.electronAPI.bot as any).startFarm(bot.id, {
        type: "trees", sapling: selectedSapling, spacing: treeSpacing,
        radius: treeRadius, bonemeal: true, depositChest,
      });
      setTreeRunning(true);
    } catch (e: any) { alert(e.message); }
    setLoading(null);
  }
  async function stopTrees() {
    if (!bot) return;
    await (window.electronAPI.bot as any).stopFarm(bot.id);
    setTreeRunning(false);
  }

  async function startBrew() {
    if (!bot) return; setLoading("brew");
    try {
      await (window.electronAPI?.bot as any).startAnarchy(bot.id, {
        task: "brew_potions",
        potionId: selectedPotion,
        wantSplash,
        wantLong,
        homeCommand: "/home",
      });
      setBrewRunning(true);
    } catch (e: any) { alert(e.message); }
    setLoading(null);
  }
  async function stopBrew() {
    if (!bot) return;
    await (window.electronAPI?.bot as any).stopAnarchy(bot.id);
    setBrewRunning(false);
  }

  const isAnyRunning = farmRunning || quickRunning || treeRunning || brewRunning;

  const modeBtn = (id: "crops"|"quick"|"trees"|"brewing", label: string) => (
    <button
      onClick={() => setActiveMode(id)}
      style={{
        flex: 1, padding: "5px 0", fontSize: 11, fontFamily: "monospace",
        background: activeMode === id ? "rgba(126,204,73,0.12)" : "rgba(255,255,255,0.02)",
        border: `1px solid ${activeMode === id ? "rgba(126,204,73,0.5)" : "#2a3550"}`,
        color: activeMode === id ? "#7ecc49" : "#555",
        cursor: "pointer", borderRadius: 4,
      }}
    >{label}</button>
  );

  return (
    <div className="flex flex-col h-full overflow-y-auto p-2 gap-2" style={{ position: "relative" }}>

      {/* ── ОВЕРЛЕЙ ОБУЧЕНИЯ ПВЕ-МОЗГА ────────────────────────────────── */}
      {brainTraining && (
        <div style={{
          position: "absolute", inset: 0, zIndex: 50,
          background: "rgba(8,10,16,0.96)",
          display: "flex", flexDirection: "column",
          alignItems: "center", justifyContent: "center",
          gap: 18, borderRadius: 8,
          backdropFilter: "blur(6px)",
        }}>
          {/* Спиннер */}
          <div style={{
            width: 52, height: 52, borderRadius: "50%",
            border: "3px solid rgba(126,204,73,0.15)",
            borderTopColor: "#7ecc49",
            animation: "spin 0.9s linear infinite",
          }} />
          <div style={{ textAlign: "center", display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ fontSize: 13, fontFamily: "monospace", color: "#7ecc49", fontWeight: "bold", textShadow: "0 0 12px rgba(126,204,73,0.5)" }}>
              🌾 {brainType === "tree" ? "Ферма-дерево" : "Ферма-пшеница"}: обучение нейросети
            </div>
            <div style={{ fontSize: 11, fontFamily: "monospace", color: "#4a6a40", maxWidth: 260, lineHeight: 1.5 }}>
              {brainMsg}
            </div>
          </div>
          {/* Прогресс-бар */}
          <div style={{ width: 220 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, fontFamily: "monospace", color: "#4a5a40", marginBottom: 6 }}>
              <span>Прогресс</span>
              <span style={{ color: "#7ecc49" }}>{Math.round(brainPct)}%</span>
            </div>
            <div style={{ height: 6, background: "rgba(126,204,73,0.1)", borderRadius: 3, overflow: "hidden", border: "1px solid rgba(126,204,73,0.2)" }}>
              <div style={{
                height: "100%", borderRadius: 3, transition: "width 0.4s ease",
                width: `${brainPct}%`,
                background: "linear-gradient(90deg, #3a6a20, #7ecc49)",
                boxShadow: "0 0 8px rgba(126,204,73,0.4)",
              }} />
            </div>
          </div>
          <div style={{ fontSize: 10, fontFamily: "monospace", color: "#2a3a20" }}>
            Первый запуск — обучается один раз, затем мгновенно
          </div>
        </div>
      )}

      {offline && (
        <div className="text-xs text-center p-3" style={{ color: "#555" }}>
          Подключите бота для фарминга
        </div>
      )}

      {/* Режим */}
      <div className="flex gap-1 p-0.5" style={{ background: "rgba(255,255,255,0.02)", borderRadius: 6, border: "1px solid #1a2540" }}>
        {modeBtn("crops",   "🌾 Культуры")}
        {modeBtn("quick",   "⚡ Быстрый")}
        {modeBtn("trees",   "🌳 Деревья")}
        {modeBtn("brewing", "🧪 Зелья")}
      </div>

      {/* ── КУЛЬТУРЫ ─────────────────────────────────────────────────── */}
      {activeMode === "crops" && (
        <div className="panel p-3 flex flex-col gap-2">
          <div className="text-xs font-mono font-bold" style={{ color: "#7ecc49" }}>🌾 Фарм культур</div>

          {/* Выбор культуры по группам */}
          {cropGroups.map(([type, crops]) => (
            <div key={type}>
              <div className="text-xs mb-1" style={{ color: "#555" }}>{TYPE_LABEL[type] || type}:</div>
              <div className="flex flex-wrap gap-1 mb-1">
                {crops.map(c => (
                  <button key={c.id} onClick={() => setSelectedCrop(c.id)}
                    style={{
                      background: selectedCrop === c.id ? "#1a3a1a" : "#111",
                      border: `1px solid ${selectedCrop === c.id ? "#7ecc49" : "#2a3550"}`,
                      color: selectedCrop === c.id ? "#7ecc49" : "#666",
                      borderRadius: 3, padding: "2px 7px", cursor: "pointer", fontSize: 10,
                    }}>{c.name}</button>
                ))}
              </div>
            </div>
          ))}

          {/* Радиус */}
          <div>
            <div className="flex justify-between text-xs mb-1">
              <span style={{ color: "#888" }}>Радиус:</span>
              <span style={{ color: "#7ecc49" }}>{cropRadius}×{cropRadius} ≈ {cropRadius*cropRadius} блоков</span>
            </div>
            <input type="range" min={2} max={40} value={cropRadius}
              onChange={e => setCropRadius(Number(e.target.value))}
              style={{ width: "100%", accentColor: "#7ecc49" }} />
          </div>

          {/* Опции */}
          <div className="flex gap-3">
            {[
              { val: useBonemeal,  set: setUseBonemeal,  label: "🦴 Костная мука" },
              { val: depositChest, set: setDepositChest, label: "📦 Сдавать в сундук" },
            ].map(({ val, set, label }) => (
              <label key={label} className="flex items-center gap-1 text-xs cursor-pointer" style={{ color: val ? "#7ecc49" : "#555" }}>
                <input type="checkbox" checked={val} onChange={e => set(e.target.checked)}
                  style={{ accentColor: "#7ecc49" }} />
                {label}
              </label>
            ))}
          </div>

          {/* Заметка под тыкву/дыню */}
          {(selectedCrop === "melon_seeds" || selectedCrop === "pumpkin_seeds") && (
            <div className="text-xs px-2 py-1 rounded" style={{ background: "rgba(243,156,18,0.08)", color: "#f39c12", border: "1px solid rgba(243,156,18,0.2)" }}>
              ⚠️ Тыква/Дыня: бот автоматически оставляет соседний блок пустым для роста плода и собирает плод (не стебель)
            </div>
          )}
          {(selectedCrop === "sugar_cane" || selectedCrop === "bamboo" || selectedCrop === "cactus") && (
            <div className="text-xs px-2 py-1 rounded" style={{ background: "rgba(52,152,219,0.08)", color: "#3498db", border: "1px solid rgba(52,152,219,0.2)" }}>
              ℹ️ Вертикальный рост: бот оставляет нижний блок, срубает остальное
            </div>
          )}

          <button
            className="btn text-xs w-full mt-1"
            onClick={farmRunning ? stopFarm : startFarm}
            disabled={offline || loading === "farm"}
            style={farmRunning
              ? { background: "#2a0a0a", borderColor: "#e74c3c", color: "#e74c3c" }
              : { background: "#0a2a0a", borderColor: "#7ecc49", color: "#7ecc49" }}>
            {loading === "farm" ? "⏳..." : farmRunning ? "⏹ Остановить фарм" : "▶ Запустить фарм"}
          </button>
          {farmRunning && (
            <div className="text-xs text-center" style={{ color: "#7ecc49", animation: "pulse 2s infinite" }}>
              ● Фарм работает...
            </div>
          )}
        </div>
      )}

      {/* ── БЫСТРЫЙ ФАРМ ─────────────────────────────────────────────── */}
      {activeMode === "quick" && (
        <div className="panel p-3 flex flex-col gap-2">
          <div className="text-xs font-mono font-bold" style={{ color: "#f39c12" }}>⚡ Быстрый фарм (Delta-style)</div>
          <div className="text-xs" style={{ color: "#666" }}>
            Берёт костную муку, встаёт на место, сажает → удобряет → собирает в цикле до конца КМ или стопа
          </div>

          <div>
            <div className="text-xs mb-1" style={{ color: "#888" }}>Культура:</div>
            <div className="flex flex-wrap gap-1">
              {CROPS.filter(c => ["standard"].includes(c.type)).map(c => (
                <button key={c.id} onClick={() => setQuickCrop(c.id)}
                  style={{
                    background: quickCrop === c.id ? "#2a2a0a" : "#111",
                    border: `1px solid ${quickCrop === c.id ? "#f39c12" : "#2a3550"}`,
                    color: quickCrop === c.id ? "#f39c12" : "#666",
                    borderRadius: 3, padding: "2px 7px", cursor: "pointer", fontSize: 10,
                  }}>{c.name}</button>
              ))}
            </div>
          </div>

          <div className="text-xs px-2 py-1 rounded" style={{ background: "rgba(243,156,18,0.06)", color: "#f39c12", border: "1px solid rgba(243,156,18,0.15)" }}>
            ⚙️ Поставь бота на вспаханный блок земли с семенами и запусти. Костная мука — в инвентаре.
          </div>

          <button
            className="btn text-xs w-full"
            onClick={quickRunning ? stopQuick : startQuick}
            disabled={offline || loading === "quick"}
            style={quickRunning
              ? { background: "#2a0a0a", borderColor: "#e74c3c", color: "#e74c3c" }
              : { background: "#2a1a00", borderColor: "#f39c12", color: "#f39c12" }}>
            {loading === "quick" ? "⏳..." : quickRunning ? "⏹ Стоп" : "⚡ Быстрый фарм"}
          </button>
          {quickRunning && (
            <div className="text-xs text-center" style={{ color: "#f39c12", animation: "pulse 2s infinite" }}>
              ⚡ Цикл активен (ждёт концa КМ)...
            </div>
          )}
        </div>
      )}

      {/* ── ДЕРЕВЬЯ ──────────────────────────────────────────────────── */}
      {activeMode === "trees" && (
        <div className="panel p-3 flex flex-col gap-2">
          <div className="text-xs font-mono font-bold" style={{ color: "#2ecc71" }}>🌳 Ферма деревьев</div>

          <div>
            <div className="text-xs mb-1" style={{ color: "#888" }}>Порода:</div>
            <div className="flex flex-wrap gap-1">
              {SAPLINGS.map(s => (
                <button key={s.id} onClick={() => setSelectedSapling(s.id)}
                  style={{
                    background: selectedSapling === s.id ? "#0a2a0a" : "#111",
                    border: `1px solid ${selectedSapling === s.id ? "#2ecc71" : "#2a3550"}`,
                    color: selectedSapling === s.id ? "#2ecc71" : "#666",
                    borderRadius: 3, padding: "2px 7px", cursor: "pointer", fontSize: 10,
                  }}>{s.name}</button>
              ))}
            </div>
          </div>

          <div>
            <div className="flex justify-between text-xs mb-1">
              <span style={{ color: "#888" }}>Интервал:</span>
              <span style={{ color: "#2ecc71" }}>{treeSpacing + 1} блоков между деревьями</span>
            </div>
            <input type="range" min={1} max={8} value={treeSpacing}
              onChange={e => setTreeSpacing(Number(e.target.value))}
              style={{ width: "100%", accentColor: "#2ecc71" }} />
          </div>

          <div>
            <div className="flex justify-between text-xs mb-1">
              <span style={{ color: "#888" }}>Радиус сетки:</span>
              <span style={{ color: "#2ecc71" }}>{treeRadius} блоков</span>
            </div>
            <input type="range" min={5} max={60} value={treeRadius}
              onChange={e => setTreeRadius(Number(e.target.value))}
              style={{ width: "100%", accentColor: "#2ecc71" }} />
          </div>

          <label className="flex items-center gap-1 text-xs cursor-pointer" style={{ color: depositChest ? "#2ecc71" : "#555" }}>
            <input type="checkbox" checked={depositChest} onChange={e => setDepositChest(e.target.checked)}
              style={{ accentColor: "#2ecc71" }} />
            📦 Сдавать в сундук при заполнении
          </label>

          <button
            className="btn text-xs w-full"
            onClick={treeRunning ? stopTrees : startTrees}
            disabled={offline || loading === "trees"}
            style={treeRunning
              ? { background: "#2a0a0a", borderColor: "#e74c3c", color: "#e74c3c" }
              : { background: "#0a2a14", borderColor: "#2ecc71", color: "#2ecc71" }}>
            {loading === "trees" ? "⏳..." : treeRunning ? "⏹ Стоп деревья" : "▶ Ферма деревьев"}
          </button>
          {treeRunning && (
            <div className="text-xs text-center" style={{ color: "#2ecc71", animation: "pulse 2s infinite" }}>
              🌳 Сажаю и рублю деревья...
            </div>
          )}
        </div>
      )}

      {/* ── ЗЕЛЬЯ ────────────────────────────────────────────────────── */}
      {activeMode === "brewing" && (
        <div className="panel p-3 flex flex-col gap-2" style={{ border: "1px solid #3d1f5a" }}>
          <div className="text-xs font-mono font-bold" style={{ color: "#cc88ff" }}>🧪 Зельеварение</div>
          <div className="text-xs" style={{ color: "#666" }}>
            Бот сам найдёт стойку и сундук в радиусе 32 блоков, сварит выбранное зелье
          </div>

          {/* Выбор зелья */}
          <div>
            <label className="text-xs mb-1 block" style={{ color: "#aaa" }}>Зелье:</label>
            <select
              value={selectedPotion}
              onChange={e => setSelectedPotion(e.target.value)}
              disabled={brewRunning}
              className="w-full text-xs p-2 rounded"
              style={{ background: "#1a1a2a", border: "1px solid #3d1f5a", color: brewRunning ? "#555" : "#e8e8e8", fontFamily: "monospace", outline: "none" }}
            >
              {POTION_OPTIONS.map(p => (
                <option key={p.id} value={p.id}>{p.emoji} {p.label}</option>
              ))}
            </select>
          </div>

          {/* Опции */}
          <div className="flex gap-4">
            <label className="flex items-center gap-1.5 cursor-pointer" style={{ opacity: brewRunning ? 0.4 : 1 }}>
              <input type="checkbox" checked={wantSplash} onChange={e => !brewRunning && setWantSplash(e.target.checked)}
                disabled={brewRunning} style={{ accentColor: "#9b59b6" }} />
              <span className="text-xs" style={{ color: "#cc88ff" }}>Сплеш (бросаемое)</span>
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer" style={{ opacity: brewRunning ? 0.4 : 1 }}>
              <input type="checkbox" checked={wantLong} onChange={e => !brewRunning && setWantLong(e.target.checked)}
                disabled={brewRunning} style={{ accentColor: "#3498db" }} />
              <span className="text-xs" style={{ color: "#5dade2" }}>Redstone (8 мин)</span>
            </label>
          </div>

          {/* Ингредиенты */}
          <div style={{ background: "#0d0d1a", border: "1px solid #2a1a3a", borderRadius: 4, padding: "8px 10px" }}>
            <div className="text-xs mb-1 font-mono" style={{ color: "#888" }}>Нужно в инвентаре / сундуке:</div>
            <div className="flex flex-col gap-0.5">
              {currentPotion.ingredients.map((ing, i) => (
                <div key={i} className="text-xs flex items-start gap-1" style={{ color: "#aaa" }}>
                  <span style={{ color: "#9b59b6", flexShrink: 0 }}>•</span>
                  <span>{ing}</span>
                </div>
              ))}
              {wantSplash && (
                <div className="text-xs flex items-start gap-1" style={{ color: "#aaa" }}>
                  <span style={{ color: "#e67e22", flexShrink: 0 }}>•</span>
                  <span>Порох × 3 (для Сплеш)</span>
                </div>
              )}
              {wantLong && (
                <div className="text-xs flex items-start gap-1" style={{ color: "#5dade2" }}>
                  <span style={{ color: "#3498db", flexShrink: 0 }}>•</span>
                  <span>Красный камень × 3 (для 8 мин)</span>
                </div>
              )}
              <div className="text-xs flex items-start gap-1 mt-1" style={{ color: "#666" }}>
                <span style={{ color: "#555", flexShrink: 0 }}>•</span>
                <span>Стеклянные флаконы × 3 (Glass Bottle)</span>
              </div>
            </div>
          </div>

          <button
            className="btn text-xs w-full mt-1"
            onClick={brewRunning ? stopBrew : startBrew}
            disabled={offline || loading === "brew"}
            style={brewRunning
              ? { background: "#2a0a0a", borderColor: "#e74c3c", color: "#e74c3c" }
              : { background: "#1a0d2a", borderColor: "#8e44ad", color: "#cc88ff" }}>
            {loading === "brew" ? "⏳..." : brewRunning ? "⏹ Остановить зельеварение" : "🧪 Запустить зельеварение"}
          </button>
          {brewRunning && (
            <div className="text-xs text-center" style={{ color: "#cc88ff", animation: "pulse 2s infinite" }}>
              🧪 Варю зелья...
            </div>
          )}
        </div>
      )}
    </div>
  );
}
