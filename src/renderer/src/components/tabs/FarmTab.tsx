import React, { useState } from "react";
import { BotState } from "../../store/appStore";

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
  const [activeMode, setActiveMode] = useState<"crops"|"quick"|"trees">("crops");

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

  const [loading, setLoading] = useState<string | null>(null);
  const isOnline = bot?.status === "online";
  const offline = !isOnline;

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

  const isAnyRunning = farmRunning || quickRunning || treeRunning;

  const modeBtn = (id: "crops"|"quick"|"trees", label: string) => (
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
    <div className="flex flex-col h-full overflow-y-auto p-2 gap-2">
      {offline && (
        <div className="text-xs text-center p-3" style={{ color: "#555" }}>
          Подключите бота для фарминга
        </div>
      )}

      {/* Режим */}
      <div className="flex gap-1 p-0.5" style={{ background: "rgba(255,255,255,0.02)", borderRadius: 6, border: "1px solid #1a2540" }}>
        {modeBtn("crops", "🌾 Культуры")}
        {modeBtn("quick", "⚡ Быстрый")}
        {modeBtn("trees", "🌳 Деревья")}
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
    </div>
  );
}
