import React, { useState } from "react";
import { BotState } from "../../store/appStore";

const CROPS = [
  { id: "wheat_seeds",    name: "🌾 Пшеница" },
  { id: "carrot",         name: "🥕 Морковь" },
  { id: "potato",         name: "🥔 Картофель" },
  { id: "beetroot_seeds", name: "🟤 Свёкла" },
  { id: "melon_seeds",    name: "🍈 Дыня" },
  { id: "pumpkin_seeds",  name: "🎃 Тыква" },
  { id: "nether_wart",    name: "🔴 Бородавка" },
];

const SAPLINGS = [
  { id: "oak_sapling",      name: "🌳 Дуб" },
  { id: "birch_sapling",    name: "🌲 Берёза" },
  { id: "spruce_sapling",   name: "🌲 Ель" },
  { id: "jungle_sapling",   name: "🌴 Джунгли" },
  { id: "acacia_sapling",   name: "🌳 Акация" },
  { id: "dark_oak_sapling", name: "🌑 Тёмный дуб" },
];

interface Props { bot: BotState | null; }

export default function FarmTab({ bot }: Props) {
  const [selectedCrop, setSelectedCrop]       = useState("wheat_seeds");
  const [cropRadius, setCropRadius]           = useState(10);
  const [farmRunning, setFarmRunning]         = useState(false);
  const [quickRunning, setQuickRunning]       = useState(false);
  const [selectedSapling, setSelectedSapling] = useState("oak_sapling");
  const [treeSpacing, setTreeSpacing]         = useState(3);
  const [treeRadius, setTreeRadius]           = useState(20);
  const [treeRunning, setTreeRunning]         = useState(false);
  const [loading, setLoading]                 = useState<string | null>(null);

  const isOnline = bot?.status === "online";

  async function startFarm() {
    if (!bot) return;
    setLoading("farm");
    try {
      await (window.electronAPI.bot as any).startFarm(bot.id, {
        type: "crops", crop: selectedCrop, radius: cropRadius, bonemeal: true,
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
    if (!bot) return;
    setLoading("quick");
    try {
      await (window.electronAPI.bot as any).startFarm(bot.id, {
        type: "quick", crop: selectedCrop, bonemeal: true,
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
    if (!bot) return;
    setLoading("trees");
    try {
      await (window.electronAPI.bot as any).startFarm(bot.id, {
        type: "trees", sapling: selectedSapling, spacing: treeSpacing,
        radius: treeRadius, bonemeal: true,
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

  const offline = !isOnline;

  return (
    <div className="flex flex-col h-full overflow-y-auto p-2 gap-2">
      {offline && (
        <div className="text-xs text-center p-3" style={{ color: "#555" }}>
          Подключите бота для фарминга
        </div>
      )}

      {/* ── КУЛЬТУРЫ ─────────────────────────────────────── */}
      <div className="panel p-3">
        <div className="text-xs font-mono mb-2" style={{ color: "#7ecc49" }}>
          🌾 Фарм культур
        </div>

        <div className="mb-2">
          <div className="text-xs mb-1" style={{ color: "#888" }}>Культура:</div>
          <div className="flex flex-wrap gap-1">
            {CROPS.map((c) => (
              <button key={c.id} onClick={() => setSelectedCrop(c.id)}
                style={{
                  background: selectedCrop === c.id ? "#2a4a1a" : "#1a1a1a",
                  border: `1px solid ${selectedCrop === c.id ? "#7ecc49" : "#333"}`,
                  color: selectedCrop === c.id ? "#7ecc49" : "#777",
                  borderRadius: 3, padding: "3px 7px", cursor: "pointer", fontSize: 10,
                }}>
                {c.name}
              </button>
            ))}
          </div>
        </div>

        <div className="mb-3">
          <div className="flex justify-between text-xs mb-1">
            <span style={{ color: "#888" }}>Радиус поля:</span>
            <span style={{ color: "#7ecc49" }}>
              {cropRadius}×{cropRadius} = {cropRadius * cropRadius} блоков
            </span>
          </div>
          <input type="range" min={2} max={32} value={cropRadius}
            onChange={(e) => setCropRadius(Number(e.target.value))}
            style={{ width: "100%", accentColor: "#7ecc49" }} />
        </div>

        <button
          className="btn text-xs w-full"
          onClick={farmRunning ? stopFarm : startFarm}
          disabled={offline || loading === "farm"}
          style={farmRunning
            ? { background: "#5a1a1a", borderColor: "#e74c3c", color: "#e74c3c" }
            : { background: "#1a3a1a", borderColor: "#7ecc49", color: "#7ecc49" }}>
          {loading === "farm" ? "⏳..." : farmRunning ? "⏹ Стоп фарм" : "▶ Начать фарм"}
        </button>
        <div className="text-xs mt-1" style={{ color: "#444" }}>
          Вспахивает → сажает → костная мука → собирает
        </div>
      </div>

      {/* ── БЫСТРЫЙ ФАРМ ─────────────────────────────────── */}
      <div className="panel p-3" style={{ borderColor: quickRunning ? "#f1c40f" : undefined }}>
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs font-mono" style={{ color: "#f1c40f" }}>⚡ Быстрый фарм</span>
          {quickRunning && (
            <span className="text-xs px-1 rounded pulse"
              style={{ background: "#2a2a00", color: "#f1c40f", border: "1px solid #f1c40f", fontSize: 9 }}>
              АКТИВЕН
            </span>
          )}
        </div>
        <div className="text-xs mb-2" style={{ color: "#666" }}>
          Стоит на месте · смотрит вниз · сажает → муку (×6) → ломает → повтор · задержка 35–45мс
        </div>
        <button className="btn text-xs w-full"
          onClick={quickRunning ? stopQuick : startQuick}
          disabled={offline || loading === "quick"}
          style={{
            background: quickRunning ? "#5a4a00" : "#2a2a00",
            borderColor: "#f1c40f", color: "#f1c40f",
          }}>
          {loading === "quick" ? "⏳..." : quickRunning ? "⏹ Стоп" : "⚡ Запустить быстрый фарм"}
        </button>
      </div>

      {/* ── ДЕРЕВЬЯ ──────────────────────────────────────── */}
      <div className="panel p-3">
        <div className="text-xs font-mono mb-2" style={{ color: "#5b8c3e" }}>
          🌲 Фарм деревьев
        </div>

        <div className="mb-2">
          <div className="text-xs mb-1" style={{ color: "#888" }}>Саженец:</div>
          <div className="flex flex-wrap gap-1">
            {SAPLINGS.map((s) => (
              <button key={s.id} onClick={() => setSelectedSapling(s.id)}
                style={{
                  background: selectedSapling === s.id ? "#1a3a1a" : "#1a1a1a",
                  border: `1px solid ${selectedSapling === s.id ? "#5b8c3e" : "#333"}`,
                  color: selectedSapling === s.id ? "#7ecc49" : "#777",
                  borderRadius: 3, padding: "3px 7px", cursor: "pointer", fontSize: 10,
                }}>
                {s.name}
              </button>
            ))}
          </div>
        </div>

        <div className="mb-2">
          <div className="flex justify-between text-xs mb-1">
            <span style={{ color: "#888" }}>Интервал между деревьями:</span>
            <span style={{ color: "#7ecc49" }}>{treeSpacing} блок(а)</span>
          </div>
          <input type="range" min={1} max={8} value={treeSpacing}
            onChange={(e) => setTreeSpacing(Number(e.target.value))}
            style={{ width: "100%", accentColor: "#7ecc49" }} />
        </div>

        <div className="mb-3">
          <div className="flex justify-between text-xs mb-1">
            <span style={{ color: "#888" }}>Площадь посадки:</span>
            <span style={{ color: "#7ecc49" }}>{treeRadius}×{treeRadius}</span>
          </div>
          <input type="range" min={5} max={50} value={treeRadius}
            onChange={(e) => setTreeRadius(Number(e.target.value))}
            style={{ width: "100%", accentColor: "#7ecc49" }} />
        </div>

        <button className="btn btn-primary text-xs w-full"
          onClick={treeRunning ? stopTrees : startTrees}
          disabled={offline || loading === "trees"}
          style={treeRunning ? { background: "#5a1a1a", borderColor: "#e74c3c", color: "#e74c3c" } : {}}>
          {loading === "trees" ? "⏳..." : treeRunning ? "⏹ Стоп" : "▶ Посадить деревья"}
        </button>
        <div className="text-xs mt-1" style={{ color: "#444" }}>
          Костная мука для ускоренного роста · правильный интервал
        </div>
      </div>
    </div>
  );
}
