import React, { useState, useEffect, useRef, useCallback, Component } from "react";
import { BotState } from "../store/appStore";

interface AnkaProfile {
  id: string;
  serverName: string;
  ankaName: string;
  serverHost: string;
  createdAt: number;
  steps: { windowTitle: string; slot: number; button: number; delay: number }[];
}

interface WindowSlot {
  slot: number;
  name: string;
  displayName: string;
  count: number;
}

interface BotWindow {
  title: string;
  slots: WindowSlot[];
}

// ── Emoji map ─────────────────────────────────────────────────────────────────
const ITEM_EMOJI: Record<string, string> = {
  diamond_sword: "⚔️", iron_sword: "🗡️", wooden_sword: "🗡️", stone_sword: "🗡️",
  bow: "🏹", crossbow: "🏹", shield: "🛡️", trident: "🔱",
  diamond_helmet: "⛑️", diamond_chestplate: "🦺", diamond_leggings: "👖",
  leather_boots: "👢", diamond_boots: "👟", netherite_sword: "⚔️",
  golden_apple: "🍎", apple: "🍏", bread: "🍞", cooked_beef: "🥩",
  potion: "🧪", splash_potion: "💥", lingering_potion: "🧫",
  paper: "📄", book: "📕", writable_book: "📓", written_book: "📖",
  emerald: "💚", diamond: "💎", gold_ingot: "🪙", iron_ingot: "⚙️",
  nether_star: "⭐", end_crystal: "🔮", beacon: "💡",
  chest: "📦", ender_chest: "🎁", trapped_chest: "📦",
  compass: "🧭", map: "🗺️", clock: "⏰", spyglass: "🔭",
  skull: "💀", player_head: "👤",
  arrow: "➡️", spectral_arrow: "✨", tipped_arrow: "🏹",
  oak_planks: "🪵", stone: "🪨", grass_block: "🟩",
  totem_of_undying: "🪆", elytra: "🪂",
};

// Safe — never throws even if name is null/undefined
function getEmoji(name: string | null | undefined): string {
  if (!name || typeof name !== "string") return "📦";
  try {
    for (const key of Object.keys(ITEM_EMOJI)) {
      if (name.includes(key) || key.includes(name)) return ITEM_EMOJI[key];
    }
  } catch {
    // ignore
  }
  return "📦";
}

const SLOT_SIZE = 40;
const GRID_COLS = 9;

// ── SlotGrid helpers — OUTSIDE AnkaRecorder so React never remounts on re-render ──

function buildGrid(slots: WindowSlot[], cols: number = 9): WindowSlot[] {
  if (!Array.isArray(slots) || slots.length === 0) {
    return Array.from({ length: cols }, (_, i) => ({ slot: i, name: "", displayName: "", count: 0 }));
  }
  let maxSlot = -1;
  for (const s of slots) {
    const n = typeof s.slot === "number" ? s.slot : -1;
    if (n > maxSlot) maxSlot = n;
  }
  const size = Math.max(maxSlot + 1, cols);
  const grid: WindowSlot[] = Array.from({ length: size }, (_, i) => ({
    slot: i, name: "", displayName: "", count: 0,
  }));
  for (const s of slots) {
    const idx = typeof s.slot === "number" ? s.slot : -1;
    if (idx >= 0 && idx < grid.length) grid[idx] = s;
  }
  return grid;
}

interface SlotGridProps {
  slots: WindowSlot[];
  windowTitle: string;
  cols?: number;
  label?: string;
  lmbFlash: Set<number>;
  rmbFlash: Set<number>;
  onLMB: (slot: WindowSlot, windowTitle: string) => void;
  onRMB: (e: React.MouseEvent, slot: WindowSlot, windowTitle: string) => void;
}

// Stable component — defined at module level, never recreated
const SlotGrid = React.memo(function SlotGrid({
  slots, windowTitle, cols = GRID_COLS, label,
  lmbFlash, rmbFlash, onLMB, onRMB,
}: SlotGridProps) {
  const grid = buildGrid(slots, cols);
  const isInv = windowTitle === "__inventory__";

  return (
    <div>
      {label && (
        <div className="text-xs mb-1.5" style={{ color: "#666" }}>{label}</div>
      )}
      <div style={{
        display: "grid",
        gridTemplateColumns: `repeat(${cols}, ${SLOT_SIZE}px)`,
        gap: 3,
        background: "#111",
        padding: 6,
        borderRadius: 6,
        border: "1px solid #2a2a2a",
        width: "fit-content",
      }}>
        {grid.map((slot) => {
          const hasItem = Boolean(slot.name);
          const isLmb = lmbFlash.has(slot.slot);
          const isRmb = rmbFlash.has(slot.slot);
          const isHotbar = isInv && slot.slot >= 36 && slot.slot <= 44;
          return (
            <div
              key={slot.slot}
              onClick={() => onLMB(slot, windowTitle)}
              onContextMenu={(e) => onRMB(e, slot, windowTitle)}
              title={hasItem
                ? `Слот ${slot.slot}: ${slot.displayName || slot.name}\nЛКМ = в руку · ПКМ = правый клик`
                : `Слот ${slot.slot} (пустой)`}
              style={{
                width: SLOT_SIZE,
                height: SLOT_SIZE,
                background: isLmb ? "#1a4a1a" : isRmb ? "#4a3a0a" : isHotbar ? "#1a1a2a" : "#181818",
                border: isLmb
                  ? "2px solid #7ecc49"
                  : isRmb
                  ? "2px solid #ffcc44"
                  : isHotbar
                  ? "1px solid #3a3a5a"
                  : "1px solid #252525",
                borderRadius: 4,
                cursor: hasItem ? "pointer" : "default",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 18,
                transition: "all 0.15s",
                position: "relative",
                userSelect: "none",
                flexShrink: 0,
              }}
            >
              {hasItem ? (
                <>
                  <span style={{ lineHeight: 1 }}>{getEmoji(slot.name)}</span>
                  {slot.count > 1 && (
                    <span style={{
                      fontSize: 9, color: "#ffcc44",
                      position: "absolute", bottom: 2, right: 3,
                      fontWeight: "bold", textShadow: "0 0 3px #000",
                    }}>
                      {slot.count}
                    </span>
                  )}
                </>
              ) : (
                <span style={{ fontSize: 10, color: "#333" }}>·</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
});

// ── Error boundary ────────────────────────────────────────────────────────────
interface EBState { hasError: boolean; msg: string }
class ErrorBoundary extends Component<{ children: React.ReactNode }, EBState> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, msg: "" };
  }
  static getDerivedStateFromError(err: Error): EBState {
    return { hasError: true, msg: err?.message || "Неизвестная ошибка" };
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 16, color: "#ff5555", fontSize: 12, fontFamily: "monospace" }}>
          ⚠️ Ошибка рендера: {this.state.msg}
          <br />
          <button
            style={{ marginTop: 8, padding: "4px 10px", fontSize: 11, cursor: "pointer",
              background: "#1a1a1a", border: "1px solid #3a1a1a", color: "#ff9999", borderRadius: 4 }}
            onClick={() => this.setState({ hasError: false, msg: "" })}
          >
            Перезагрузить
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// ── Main component ────────────────────────────────────────────────────────────
export default function AnkaRecorder({ bot }: { bot: BotState }) {
  const [profiles, setProfiles] = useState<AnkaProfile[]>([]);
  const [recording, setRecording] = useState(false);
  const [stepCount, setStepCount] = useState(0);
  const [currentWindow, setCurrentWindow] = useState<BotWindow | null>(null);
  const [botInventory, setBotInventory] = useState<WindowSlot[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [serverName, setServerName] = useState(bot.config.host || "");
  const [ankaName, setAnkaName] = useState("");
  const [playing, setPlaying] = useState(false);
  const [playMsg, setPlayMsg] = useState("");
  const [lmbFlash, setLmbFlash] = useState<Set<number>>(new Set());
  const [rmbFlash, setRmbFlash] = useState<Set<number>>(new Set());
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    loadProfiles();

    const unsubWindow = window.electronAPI.on("bot:windowOpen", (d: { botId: string; window: BotWindow }) => {
      if (d?.botId === bot.id && d?.window) setCurrentWindow(d.window);
    });
    const unsubClose = window.electronAPI.on("bot:windowClose", (d: { botId: string }) => {
      if (d?.botId === bot.id) setCurrentWindow(null);
    });
    const unsubInv = window.electronAPI.on("bot:inventoryUpdated", (d: { botId: string; inventory: WindowSlot[] }) => {
      if (d?.botId === bot.id && Array.isArray(d.inventory)) setBotInventory(d.inventory);
    });

    return () => {
      try { unsubWindow(); } catch {}
      try { unsubClose(); } catch {}
      try { unsubInv(); } catch {}
    };
  }, [bot.id]);

  useEffect(() => {
    if (recording) {
      pollRef.current = setInterval(async () => {
        const n = await (window.electronAPI.anka.getStepCount(bot.id) as Promise<number>).catch(() => 0);
        setStepCount(n);
      }, 500);
    } else {
      if (pollRef.current) clearInterval(pollRef.current);
      setStepCount(0);
    }
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [recording, bot.id]);

  async function loadProfiles() {
    try {
      const list = await window.electronAPI.anka.list();
      if (Array.isArray(list)) setProfiles(list);
    } catch {}
  }

  const flashSlot = useCallback((slotIdx: number, button: number) => {
    if (button === 0) {
      setLmbFlash(prev => new Set([...prev, slotIdx]));
      setTimeout(() => setLmbFlash(prev => { const s = new Set(prev); s.delete(slotIdx); return s; }), 350);
    } else {
      setRmbFlash(prev => new Set([...prev, slotIdx]));
      setTimeout(() => setRmbFlash(prev => { const s = new Set(prev); s.delete(slotIdx); return s; }), 350);
    }
  }, []);

  const handleSlotClick = useCallback(async (slot: WindowSlot, button: number, windowTitle: string) => {
    if (bot.status !== "online") return;
    flashSlot(slot.slot, button);
    try {
      await window.electronAPI.anka.clickSlot(bot.id, slot.slot, button);
    } catch {}
    if (recording) {
      try {
        await window.electronAPI.anka.addStep(bot.id, { windowTitle, slot: slot.slot, button });
      } catch {}
    }
  }, [bot.id, bot.status, recording, flashSlot]);

  const onLMB = useCallback((slot: WindowSlot, windowTitle: string) => {
    handleSlotClick(slot, 0, windowTitle);
  }, [handleSlotClick]);

  const onRMB = useCallback((e: React.MouseEvent, slot: WindowSlot, windowTitle: string) => {
    e.preventDefault();
    handleSlotClick(slot, 1, windowTitle);
  }, [handleSlotClick]);

  async function startRec() {
    try { await window.electronAPI.anka.startRecording(bot.id); } catch {}
    setRecording(true);
    setLmbFlash(new Set());
    setRmbFlash(new Set());
    setShowForm(false);
  }

  async function stopAndSave() {
    if (!ankaName.trim()) return;
    try {
      const result: any = await window.electronAPI.anka.stopRecording(bot.id, {
        serverName, ankaName, serverHost: bot.config.host,
      });
      if (result?.error) { alert(result.error); return; }
    } catch (e: any) { alert(e?.message || "Ошибка сохранения"); return; }
    setRecording(false);
    setShowForm(false);
    setAnkaName("");
    loadProfiles();
  }

  async function cancelRec() {
    try { await window.electronAPI.anka.cancelRecording(bot.id); } catch {}
    setRecording(false);
    setShowForm(false);
  }

  async function playProfile(profile: AnkaProfile) {
    setPlaying(true);
    setPlayMsg("▶️ Воспроизведение...");
    try {
      const result: any = await window.electronAPI.anka.play(bot.id, profile.id);
      setPlayMsg(result?.error ? `❌ ${result.error}` : "✅ Выполнено!");
    } catch (e: any) {
      setPlayMsg(`❌ ${e?.message || "Ошибка"}`);
    }
    setTimeout(() => { setPlaying(false); setPlayMsg(""); }, 2500);
  }

  async function deleteProfile(id: string) {
    try { await window.electronAPI.anka.delete(id); } catch {}
    loadProfiles();
  }

  const isOnline = bot.status === "online";

  const serverProfiles = profiles.filter(p =>
    !p.serverHost || p.serverHost === bot.config.host ||
    bot.config.host?.includes(p.serverHost)
  );

  return (
    <ErrorBoundary>
      <div style={{ fontFamily: "monospace" }}>
        {/* Header */}
        <div className="flex items-center justify-between px-3 py-2 border-b" style={{ borderColor: "#2a2a2a" }}>
          <div className="flex items-center gap-2">
            <span style={{ fontSize: 15 }}>🎯</span>
            <span className="text-xs font-mono" style={{ color: "#7ecc49" }}>Управление / Запись анки</span>
            {recording && (
              <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: "#3a0000", color: "#ff5555", border: "1px solid #550000" }}>
                ● РЕК {stepCount > 0 ? `(${stepCount})` : ""}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            {!recording ? (
              <button onClick={startRec} disabled={!isOnline}
                className="text-xs px-2 py-1 rounded"
                style={{ background: "#1a3a1a", border: "1px solid #3a6a3a", color: "#7ecc49", cursor: isOnline ? "pointer" : "not-allowed", opacity: isOnline ? 1 : 0.4 }}>
                ● Записать
              </button>
            ) : (
              <>
                {stepCount > 0 && !showForm && (
                  <button onClick={() => setShowForm(true)} className="text-xs px-2 py-1 rounded"
                    style={{ background: "#1a3a1a", border: "1px solid #3a6a3a", color: "#7ecc49", cursor: "pointer" }}>
                    💾 Сохранить ({stepCount})
                  </button>
                )}
                <button onClick={cancelRec} className="text-xs px-2 py-1 rounded"
                  style={{ background: "none", border: "1px solid #3a1a1a", color: "#666", cursor: "pointer" }}>
                  ✕ Стоп
                </button>
              </>
            )}
          </div>
        </div>

        <div className="p-3 flex flex-col gap-3">
          {/* Legend */}
          {isOnline && (
            <div className="flex items-center gap-3 text-xs" style={{ color: "#555" }}>
              <span>
                <span style={{ display: "inline-block", width: 10, height: 10, background: "#1a4a1a", border: "1px solid #7ecc49", borderRadius: 2, marginRight: 4, verticalAlign: "middle" }} />
                ЛКМ — взять в руку
              </span>
              <span>
                <span style={{ display: "inline-block", width: 10, height: 10, background: "#4a3a0a", border: "1px solid #ffcc44", borderRadius: 2, marginRight: 4, verticalAlign: "middle" }} />
                ПКМ — правый клик
              </span>
            </div>
          )}

          {/* Save form */}
          {showForm && (
            <div style={{ background: "#111", border: "1px solid #2a3a2a", borderRadius: 6, padding: 10 }}
              className="flex flex-col gap-2">
              <div className="text-xs" style={{ color: "#7ecc49" }}>Сохранить запись анки</div>
              <input style={{ background: "#0d0d0d", border: "1px solid #3a3a3a", borderRadius: 4, padding: "4px 8px", color: "#e8e8e8", fontSize: 11 }}
                placeholder="Сервер (напр. funtime.su)"
                value={serverName} onChange={e => setServerName(e.target.value)} />
              <input style={{ background: "#0d0d0d", border: "1px solid #3a3a3a", borderRadius: 4, padding: "4px 8px", color: "#e8e8e8", fontSize: 11 }}
                placeholder="Название анки (напр. Лучник, Маг...)"
                value={ankaName} onChange={e => setAnkaName(e.target.value)}
                autoFocus />
              <div className="flex gap-2">
                <button onClick={stopAndSave} disabled={!ankaName.trim()}
                  style={{ flex: 1, background: "#1a3a1a", border: "1px solid #3a6a3a", borderRadius: 4, color: "#7ecc49", fontSize: 11, padding: "5px", cursor: "pointer", opacity: ankaName.trim() ? 1 : 0.4 }}>
                  ✅ Сохранить
                </button>
                <button onClick={() => setShowForm(false)}
                  style={{ flex: 1, background: "none", border: "1px solid #3a3a3a", borderRadius: 4, color: "#666", fontSize: 11, padding: "5px", cursor: "pointer" }}>
                  Отмена
                </button>
              </div>
            </div>
          )}

          {/* Chest / menu window */}
          {currentWindow ? (
            <div style={{ background: "#0f1a0f", border: "1px solid #2a4a2a", borderRadius: 8, padding: 10 }}>
              <div className="flex items-center gap-2 mb-2">
                <span>📦</span>
                <span className="text-xs font-mono" style={{ color: "#7ecc49" }}>
                  {currentWindow.title || "Сундук / Меню"}
                </span>
                {recording && <span className="text-xs" style={{ color: "#ff5555" }}>● запись</span>}
              </div>
              <div style={{ overflowX: "auto" }}>
                <SlotGrid
                  slots={currentWindow.slots ?? []}
                  windowTitle={currentWindow.title ?? ""}
                  cols={GRID_COLS}
                  lmbFlash={lmbFlash}
                  rmbFlash={rmbFlash}
                  onLMB={onLMB}
                  onRMB={onRMB}
                />
              </div>
              <div className="text-xs mt-2" style={{ color: "#444" }}>
                Кликай — бот повторит клик в реальном времени
              </div>
            </div>
          ) : isOnline ? (
            <div className="text-xs text-center py-3" style={{ color: "#3a3a3a", border: "1px dashed #222", borderRadius: 6 }}>
              Сундук/меню не открыто
              <div style={{ fontSize: 10, color: "#2a2a2a", marginTop: 2 }}>
                Когда бот откроет сундук — он появится здесь
              </div>
            </div>
          ) : null}

          {/* Bot inventory */}
          {isOnline && botInventory.length > 0 && (
            <div style={{ background: "#0f0f1a", border: "1px solid #2a2a4a", borderRadius: 8, padding: 10 }}>
              <div className="flex items-center gap-2 mb-2">
                <span>🎒</span>
                <span className="text-xs font-mono" style={{ color: "#aaaaff" }}>Инвентарь бота</span>
                {recording && <span className="text-xs" style={{ color: "#ff5555" }}>● запись</span>}
              </div>
              <div style={{ overflowX: "auto" }}>
                <SlotGrid
                  slots={botInventory}
                  windowTitle="__inventory__"
                  cols={GRID_COLS}
                  label="Хотбар (36–44) → основной инвентарь"
                  lmbFlash={lmbFlash}
                  rmbFlash={rmbFlash}
                  onLMB={onLMB}
                  onRMB={onRMB}
                />
              </div>
              <div className="text-xs mt-2" style={{ color: "#444" }}>
                ЛКМ = взять в руку · ПКМ = правый клик по предмету
              </div>
            </div>
          )}

          {!isOnline && (
            <div className="text-xs text-center py-4" style={{ color: "#333" }}>
              Бот не подключён
            </div>
          )}

          {playMsg && (
            <div className="text-xs px-2 py-1.5 rounded text-center"
              style={{ background: "#1a1a2a", border: "1px solid #3a3a6a", color: "#aaaaff" }}>
              {playMsg}
            </div>
          )}

          {/* Saved profiles */}
          {serverProfiles.length > 0 && (
            <div>
              <div className="text-xs mb-1.5" style={{ color: "#444" }}>
                Сохранённые анки — {bot.config.host}:
              </div>
              <div className="flex flex-col gap-2">
                {serverProfiles.map(p => (
                  <div key={p.id} style={{
                    background: "#111", border: "1px solid #2a3a2a",
                    borderRadius: 6, padding: "8px 10px",
                  }}>
                    <div className="flex items-start justify-between">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 mb-0.5">
                          <span style={{ fontSize: 13 }}>🎯</span>
                          <span className="text-xs font-mono" style={{ color: "#7ecc49" }}>{p.ankaName}</span>
                        </div>
                        <div className="text-xs" style={{ color: "#444" }}>
                          {p.steps.length} кликов · {new Date(p.createdAt).toLocaleDateString("ru")}
                        </div>
                        <div className="mt-1 flex gap-1 flex-wrap">
                          {p.steps.slice(0, 10).map((s, i) => (
                            <span key={i} style={{
                              background: s.button === 0 ? "#0a1a0a" : "#1a1200",
                              border: s.button === 0 ? "1px solid #2a4a2a" : "1px solid #3a2a00",
                              borderRadius: 3, padding: "1px 5px",
                              fontSize: 9,
                              color: s.button === 0 ? "#4a7a4a" : "#7a6a20",
                            }}>
                              {s.button === 1 ? "ПКМ" : "ЛКМ"}#{s.slot}
                            </span>
                          ))}
                          {p.steps.length > 10 && (
                            <span style={{ fontSize: 9, color: "#333" }}>+{p.steps.length - 10}...</span>
                          )}
                        </div>
                      </div>
                      <div className="flex flex-col gap-1 ml-2">
                        <button onClick={() => playProfile(p)}
                          disabled={playing || recording || !isOnline}
                          style={{
                            background: "none", border: "1px solid #3a6a3a", borderRadius: 4,
                            color: "#7ecc49", cursor: "pointer", padding: "3px 10px", fontSize: 11,
                            opacity: (playing || recording || !isOnline) ? 0.4 : 1,
                          }}>
                          ▶ Играть
                        </button>
                        <button onClick={() => deleteProfile(p.id)}
                          style={{
                            background: "none", border: "1px solid #3a1a1a", borderRadius: 4,
                            color: "#ff5555", cursor: "pointer", padding: "3px 10px", fontSize: 11,
                          }}>
                          🗑
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {serverProfiles.length === 0 && !recording && isOnline && (
            <div className="text-xs text-center py-4" style={{ color: "#333" }}>
              <div style={{ fontSize: 28, marginBottom: 6 }}>🎯</div>
              Нет записей для этого сервера
              <br />
              <span style={{ color: "#2a2a2a" }}>Нажми «● Записать» и кликай по слотам</span>
            </div>
          )}

          {profiles.length > serverProfiles.length && (
            <details>
              <summary className="text-xs cursor-pointer" style={{ color: "#333" }}>
                Другие серверы ({profiles.length - serverProfiles.length})
              </summary>
              <div className="mt-2 flex flex-col gap-1.5">
                {profiles.filter(p => !serverProfiles.find(s => s.id === p.id)).map(p => (
                  <div key={p.id} style={{
                    background: "#0d0d0d", border: "1px solid #1e1e1e",
                    borderRadius: 4, padding: "6px 8px",
                    display: "flex", alignItems: "center", justifyContent: "space-between",
                  }}>
                    <div>
                      <span className="text-xs" style={{ color: "#666" }}>🎯 {p.ankaName}</span>
                      <span className="text-xs ml-2" style={{ color: "#333" }}>{p.serverName}</span>
                    </div>
                    <button onClick={() => deleteProfile(p.id)}
                      style={{ background: "none", border: "1px solid #3a1a1a", borderRadius: 4, color: "#ff5555", cursor: "pointer", padding: "2px 6px", fontSize: 10 }}>
                      🗑
                    </button>
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>
      </div>
    </ErrorBoundary>
  );
}
