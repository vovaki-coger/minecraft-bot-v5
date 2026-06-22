import React, { useState, useEffect, useCallback } from "react";
import { BotState } from "../../store/appStore";
import BotEditModal from "../BotEditModal";

interface WindowSlot { slot: number; name: string; displayName: string; count: number; }
interface BotWindow { title: string; slots: WindowSlot[]; }

const ITEM_EMOJI: Record<string, string> = {
  diamond_sword: "⚔️", iron_sword: "🗡️", wooden_sword: "🗡️", stone_sword: "🗡️",
  bow: "🏹", crossbow: "🏹", shield: "🛡️", trident: "🔱", elytra: "🪂",
  diamond: "💎", gold_ingot: "🪙", iron_ingot: "⚙️", emerald: "💚", coal: "🖤",
  apple: "🍏", golden_apple: "🍎", bread: "🍞", cooked_beef: "🥩", cooked_chicken: "🍗",
  potion: "🧪", ender_pearl: "🔮", totem_of_undying: "🪆",
  chest: "📦", ender_chest: "🎁", crafting_table: "🪚", furnace: "🔥",
  compass: "🧭", map: "🗺️", clock: "⏰",
  oak_log: "🪵", birch_log: "🪵", spruce_log: "🪵", dark_oak_log: "🪵",
  cobblestone: "🪨", stone: "🪨", torch: "🔦", bucket: "🪣",
};

function getEmoji(name: string): string {
  if (!name || typeof name !== "string") return "·";
  try {
    for (const [k, v] of Object.entries(ITEM_EMOJI)) {
      if (name === k || name.includes(k)) return v;
    }
    if (/helmet|chestplate|leggings|boots/.test(name)) return "🛡️";
    if (/sword|axe/.test(name)) return "⚔️";
    if (/pickaxe|shovel|hoe/.test(name)) return "⛏️";
    if (/log|planks|wood/.test(name)) return "🪵";
    if (/stone|cobble|ore/.test(name)) return "🪨";
    if (/beef|chicken|pork|salmon|cod|rabbit|stew/.test(name)) return "🍖";
  } catch {}
  return "📦";
}

function stripNs(name: string): string {
  return name ? name.replace(/^minecraft:/, "") : name;
}

function getItemIcon(name: string): string {
  const clean = stripNs(name);
  const fmt = clean.split("_").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join("_");
  return `https://minecraft.wiki/images/Invicon_${fmt}.png`;
}

const SLOT_SZ = 42;

function SlotCell({ slot, hotbarActive, lmbFlash, rmbFlash, onClick, onRightClick }: {
  slot: WindowSlot; hotbarActive: boolean;
  lmbFlash: boolean; rmbFlash: boolean;
  onClick: () => void; onRightClick: (e: React.MouseEvent) => void;
}) {
  const [imgOk, setImgOk] = useState(true);
  const [hovered, setHovered] = useState(false);
  const cleanName = stripNs(slot.name);
  const hasItem = Boolean(cleanName);

  useEffect(() => { setImgOk(true); }, [cleanName]);

  const borderCol = lmbFlash ? "#00ff9d" : rmbFlash ? "#ffaa00" : hotbarActive ? "#00c8ff" : hasItem ? "#222c48" : "#141c30";
  const bg        = lmbFlash ? "rgba(0,255,157,.12)" : rmbFlash ? "rgba(255,170,0,.12)" : hotbarActive ? "rgba(0,200,255,.07)" : "rgba(0,0,0,.45)";
  const glow      = lmbFlash ? "0 0 8px rgba(0,255,157,.4)" : rmbFlash ? "0 0 8px rgba(255,170,0,.4)" : hotbarActive ? "0 0 8px rgba(0,200,255,.25)" : "none";
  const label     = (stripNs(slot.displayName) || cleanName || "").replace(/_/g, " ");

  return (
    <div
      onClick={onClick}
      onContextMenu={onRightClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      title={hasItem ? `${label} × ${slot.count}` : undefined}
      style={{
        width: SLOT_SZ, height: SLOT_SZ, flexShrink: 0,
        background: bg, border: `1px solid ${borderCol}`, borderRadius: 3,
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
        position: "relative", cursor: hasItem ? "pointer" : "default",
        transition: "border-color .1s, background .1s", boxShadow: glow,
      }}
    >
      {hasItem ? (
        <>
          {imgOk ? (
            <img src={getItemIcon(cleanName)} alt={cleanName} width={26} height={26}
              style={{ imageRendering: "pixelated" }} onError={() => setImgOk(false)} />
          ) : (
            <span style={{ fontSize: 20, lineHeight: 1 }}>{getEmoji(cleanName)}</span>
          )}
          {Number(slot.count) > 1 && (
            <span style={{
              position: "absolute", bottom: 1, right: 3, fontSize: 8,
              color: "#fff", textShadow: "1px 1px 0 #000",
              fontWeight: "bold", fontFamily: "monospace", lineHeight: 1, pointerEvents: "none",
            }}>{slot.count}</span>
          )}
        </>
      ) : (
        <span style={{ fontSize: 8, color: "#141c30", pointerEvents: "none" }}>·</span>
      )}
      {hovered && hasItem && (
        <div style={{
          position: "absolute", bottom: "calc(100% + 4px)", left: "50%",
          transform: "translateX(-50%)", zIndex: 300,
          background: "#07090f", border: "1px solid rgba(0,200,255,.25)",
          borderRadius: 4, padding: "4px 8px", whiteSpace: "nowrap",
          pointerEvents: "none", fontSize: 10, boxShadow: "0 2px 12px rgba(0,0,0,.9)",
        }}>
          <div style={{ color: "#00c8ff", fontWeight: "bold" }}>{label}</div>
          {Number(slot.count) > 0 && <div style={{ color: "#4a6080" }}>× {slot.count}</div>}
        </div>
      )}
    </div>
  );
}

function StatBar({ icon, value, max, color }: { icon: string; value: number; max: number; color: string }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 10 }}>
      <span style={{ width: 14, textAlign: "center", flexShrink: 0 }}>{icon}</span>
      <div style={{ flex: 1, height: 5, background: "rgba(255,255,255,.05)", borderRadius: 3, overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", background: color, borderRadius: 3, transition: "width .35s", boxShadow: `0 0 5px ${color}88` }} />
      </div>
      <span style={{ color: "#3a5a7a", width: 30, textAlign: "right", fontFamily: "monospace" }}>
        {Math.round(value)}/{max}
      </span>
    </div>
  );
}

function buildGrid(slots: WindowSlot[], size: number): WindowSlot[] {
  const grid: WindowSlot[] = Array.from({ length: size }, (_, i) => ({ slot: i, name: "", displayName: "", count: 0 }));
  for (const s of slots) {
    if (typeof s.slot === "number" && s.slot >= 0 && s.slot < grid.length) grid[s.slot] = s;
  }
  return grid;
}

export default function CenterPanel({ bot }: { bot: BotState | null }) {
  const [showInfo, setShowInfo]           = useState(false);
  const [editOpen, setEditOpen]           = useState(false);
  const [currentWindow, setCurrentWindow] = useState<BotWindow | null>(null);
  const [botInventory, setBotInventory]   = useState<WindowSlot[]>([]);
  const [recording, setRecording]         = useState(false);
  const [stepCount, setStepCount]         = useState(0);
  const [lmbFlash, setLmbFlash]           = useState<Set<number>>(new Set());
  const [rmbFlash, setRmbFlash]           = useState<Set<number>>(new Set());
  const [loading, setLoading]             = useState<string | null>(null);

  useEffect(() => {
    if (!bot) return;
    const unsubs: Array<() => void> = [];
    unsubs.push(window.electronAPI.on("bot:windowOpen", (d: any) => {
      if (d?.botId === bot.id && d?.window) setCurrentWindow(d.window);
    }));
    unsubs.push(window.electronAPI.on("bot:windowClose", (d: any) => {
      if (d?.botId === bot.id) setCurrentWindow(null);
    }));
    unsubs.push(window.electronAPI.on("bot:inventoryUpdated", (d: any) => {
      if (d?.botId === bot.id && Array.isArray(d.inventory)) setBotInventory(d.inventory);
    }));
    return () => { for (const fn of unsubs) { try { fn(); } catch {} } };
  }, [bot?.id]);

  useEffect(() => {
    setCurrentWindow(null); setBotInventory([]);
    setRecording(false); setStepCount(0);
  }, [bot?.id]);

  useEffect(() => {
    if (!bot || bot.status !== "online") { setRecording(false); setStepCount(0); return; }
    const iv = setInterval(async () => {
      try {
        const isRec = await (window.electronAPI.anka as any).isRecording(bot.id) as boolean;
        const cnt   = await window.electronAPI.anka.getStepCount(bot.id) as number;
        setRecording(Boolean(isRec));
        setStepCount(cnt || 0);
      } catch {}
    }, 600);
    return () => clearInterval(iv);
  }, [bot?.id, bot?.status]);

  const flash = useCallback((slotIdx: number, button: number) => {
    if (button === 0) {
      setLmbFlash(p => new Set([...p, slotIdx]));
      setTimeout(() => setLmbFlash(p => { const s = new Set(p); s.delete(slotIdx); return s; }), 280);
    } else {
      setRmbFlash(p => new Set([...p, slotIdx]));
      setTimeout(() => setRmbFlash(p => { const s = new Set(p); s.delete(slotIdx); return s; }), 280);
    }
  }, []);

  const handleClick = useCallback(async (slot: WindowSlot, button: number, windowTitle: string) => {
    if (!bot || bot.status !== "online") return;
    flash(slot.slot, button);
    try { await window.electronAPI.anka.clickSlot(bot.id, slot.slot, button); } catch {}
    try { await window.electronAPI.anka.addStep(bot.id, { windowTitle, slot: slot.slot, button }); } catch {}
  }, [bot?.id, bot?.status, flash]);

  async function handleConnect() {
    if (!bot) return;
    const connected = bot.status === "online" || bot.status === "connecting";
    setLoading("conn");
    try {
      if (connected) await window.electronAPI.bot.disconnect(bot.id);
      else           await window.electronAPI.bot.connect(bot.id);
    } catch (e: any) { alert(e?.message || "Ошибка"); }
    finally { setLoading(null); }
  }

  async function handleSurvivor() {
    if (!bot) return;
    setLoading("surv");
    try {
      if ((bot as any).survivorMode) await window.electronAPI.bot.stopSurvivor(bot.id);
      else                           await window.electronAPI.bot.startSurvivor(bot.id);
    } catch (e: any) { alert(e?.message || "Ошибка"); }
    finally { setLoading(null); }
  }

  async function handleToggleAI() {
    if (!bot) return;
    await window.electronAPI.bot.toggleAI(bot.id, !bot.config.aiEnabled);
  }

  if (!bot) {
    return (
      <div className="panel" style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 12 }}>
        <div style={{ fontSize: 52, opacity: .15 }}>⛏️</div>
        <p style={{ color: "#1e2a40", fontFamily: "monospace" }}>Выберите бота</p>
      </div>
    );
  }

  const s        = bot.stats;
  const isOnline = bot.status === "online";
  const isSurv   = Boolean((bot as any).survivorMode);
  const hotbar   = Number((s as any).hotbarSlot) || 0;
  const winTitle = currentWindow?.title ?? "";

  // Build chest grid
  let chestGrid: WindowSlot[] = [];
  if (currentWindow && currentWindow.slots.length > 0) {
    const maxSlot = currentWindow.slots.reduce((m, sl) => Math.max(m, sl.slot), -1);
    chestGrid = buildGrid(currentWindow.slots, maxSlot + 1);
  }

  // Build inventory: main (9-35) then hotbar (36-44)
  const mainSlots   = buildGrid(
    botInventory.filter(it => it.slot >= 9  && it.slot <= 35).map(it => ({ ...it, slot: it.slot - 9  })), 27,
  );
  const hotbarSlots = buildGrid(
    botInventory.filter(it => it.slot >= 36 && it.slot <= 44).map(it => ({ ...it, slot: it.slot - 36 })), 9,
  );
  for (let i = 0; i < mainSlots.length;   i++) mainSlots[i].slot   = i + 9;
  for (let i = 0; i < hotbarSlots.length; i++) hotbarSlots[i].slot = i + 36;

  return (
    <div className="panel" style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>

      {/* Header */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "6px 10px", borderBottom: "1px solid #1a2040", background: "#060810",
        gap: 8, flexShrink: 0,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 7, minWidth: 0, overflow: "hidden" }}>
          <span style={{
            width: 8, height: 8, borderRadius: "50%", display: "inline-block", flexShrink: 0,
            background: isOnline ? "#00ff9d" : bot.status === "connecting" ? "#ffee22" : "#2a3a5a",
            boxShadow: isOnline ? "0 0 8px #00ff9d88" : "none",
          }} />
          <span style={{ color: "#00ff9d", fontFamily: "monospace", fontWeight: "bold", fontSize: 13, textShadow: "0 0 10px rgba(0,255,157,.3)", whiteSpace: "nowrap" }}>
            {bot.config.nick}
          </span>
          <span style={{ color: "#2a3a5a", fontSize: 10, whiteSpace: "nowrap" }}>
            {isOnline ? "в игре" : bot.status === "connecting" ? "подключение…" : "офлайн"}
          </span>
          {isSurv && (
            <span className="pulse" style={{ fontSize: 9, padding: "1px 5px", borderRadius: 3, background: "rgba(255,34,85,.1)", border: "1px solid rgba(255,34,85,.35)", color: "#ff2255", whiteSpace: "nowrap", flexShrink: 0 }}>⚔️ ВЫЖИВАЛЬЩИК</span>
          )}
          {recording && (
            <span className="pulse" style={{ fontSize: 9, padding: "1px 5px", borderRadius: 3, background: "rgba(255,34,85,.06)", border: "1px solid #2a1020", color: "#ff5555", whiteSpace: "nowrap", flexShrink: 0 }}>
              ● РЕК{stepCount > 0 ? ` (${stepCount})` : ""}
            </span>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 5, flexShrink: 0 }}>
          <span style={{ color: "#1e2840", fontSize: 9, fontFamily: "monospace", maxWidth: 130, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {bot.config.host}
          </span>
          <button
            onClick={() => setShowInfo(v => !v)}
            title="Параметры бота"
            style={{
              background: showInfo ? "rgba(0,200,255,.1)" : "none",
              border: `1px solid ${showInfo ? "rgba(0,200,255,.35)" : "#1a2040"}`,
              borderRadius: 4, padding: "2px 7px", cursor: "pointer",
              color: showInfo ? "#00c8ff" : "#2a3a5a", fontSize: 12, transition: "all .15s",
            }}
          >⚙️</button>
        </div>
      </div>

      {/* Collapsible bot info */}
      {showInfo && (
        <div style={{
          padding: "7px 10px", borderBottom: "1px solid #1a2040",
          background: "rgba(0,200,255,.02)",
          display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", flexShrink: 0,
        }}>
          <span style={{ color: "#2a4060", fontSize: 10 }}>{bot.config.host}:{bot.config.port}</span>
          <span style={{ color: "#2a4060", fontSize: 10 }}>v{bot.config.version}</span>
          <span style={{ color: "#2a4060", fontSize: 10 }}>ИИ: {bot.config.aiModel?.split(":")[0] || "—"} [{bot.config.aiMode || "local"}]</span>
          <button
            onClick={() => { setShowInfo(false); setEditOpen(true); }}
            style={{ marginLeft: "auto", fontSize: 10, padding: "2px 8px", background: "none", border: "1px solid #1a2040", borderRadius: 3, color: "#3a5070", cursor: "pointer" }}
          >✏️ Изменить</button>
        </div>
      )}

      {/* Scrollable body */}
      <div style={{ flex: 1, overflowY: "auto", padding: 8, display: "flex", flexDirection: "column", gap: 7 }}>

        {/* Stats */}
        <div style={{ background: "rgba(0,0,0,.3)", border: "1px solid #1a2040", borderRadius: 5, padding: "7px 9px", display: "flex", flexDirection: "column", gap: 5 }}>
          <StatBar icon="❤️" value={s.health}     max={20} color="#ff2255" />
          <StatBar icon="🍗" value={s.food}       max={20} color="#ff8800" />
          <StatBar icon="🛡️" value={s.armor}      max={20} color="#4488ff" />
          <StatBar icon="⭐" value={s.experience} max={Math.max(s.experience, 30)} color="#ffee22" />
          <div style={{ display: "flex", gap: 10, fontSize: 10, color: "#2a3a5a", fontFamily: "monospace" }}>
            <span>X <span style={{ color: "#00c8ff" }}>{s.x}</span></span>
            <span>Y <span style={{ color: "#00c8ff" }}>{s.y}</span></span>
            <span>Z <span style={{ color: "#00c8ff" }}>{s.z}</span></span>
            {(s as any).biome && <span style={{ color: "#1e3050" }}>· {(s as any).biome}</span>}
          </div>
        </div>

        {/* Chest/window slots — выше инвентаря */}
        {currentWindow && (
          <div style={{ background: "rgba(0,0,0,.3)", border: "1px solid #2a4060", borderRadius: 5, overflow: "hidden" }}>
            <div style={{ padding: "5px 10px", borderBottom: "1px solid #1a2040", background: "rgba(0,200,255,.03)" }}>
              <span style={{ color: "#00c8ff", fontSize: 11, fontFamily: "monospace" }}>
                📦 {winTitle || "Сундук / Меню"}
              </span>
            </div>
            <div style={{ padding: "8px 10px" }}>
              {chestGrid.length > 0 ? (
                <div style={{ overflowX: "auto" }}>
                  <div style={{ display: "grid", gridTemplateColumns: `repeat(9, ${SLOT_SZ}px)`, gap: 2, width: "fit-content" }}>
                    {chestGrid.map((slot) => (
                      <SlotCell key={slot.slot} slot={slot} hotbarActive={false}
                        lmbFlash={lmbFlash.has(slot.slot)} rmbFlash={rmbFlash.has(slot.slot)}
                        onClick={() => handleClick(slot, 0, winTitle)}
                        onRightClick={(e) => { e.preventDefault(); handleClick(slot, 1, winTitle); }}
                      />
                    ))}
                  </div>
                </div>
              ) : (
                <div style={{ color: "#1e3a50", fontSize: 11, padding: "6px 0", fontFamily: "monospace" }}>
                  ⏳ Загрузка содержимого…
                </div>
              )}
            </div>
          </div>
        )}

        {/* Combined inventory */}
        <div style={{ background: "rgba(0,0,0,.3)", border: "1px solid #1a2040", borderRadius: 5, overflow: "hidden" }}>
          <div style={{ padding: "5px 10px", borderBottom: "1px solid #1a2040", display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ color: "#00c8ff", fontSize: 11, fontFamily: "monospace" }}>🎒 ИНВЕНТАРЬ</span>
            {isOnline && (
              <span style={{ marginLeft: "auto", fontSize: 9, color: "#2a3a5a" }}>
                <span style={{ background: "rgba(0,255,157,.06)", border: "1px solid rgba(0,255,157,.15)", borderRadius: 2, padding: "1px 4px", color: "#00ff9d55", marginRight: 4 }}>ЛКМ</span>
                <span style={{ background: "rgba(255,170,0,.06)", border: "1px solid rgba(255,170,0,.15)", borderRadius: 2, padding: "1px 4px", color: "#ffaa0055" }}>ПКМ</span>
              </span>
            )}
          </div>

          {/* Bot inventory */}
          <div style={{ padding: "8px 10px" }}>
            {!isOnline ? (
              <div style={{ textAlign: "center", color: "#1e2a3a", padding: "18px 0", fontSize: 11 }}>Бот не в сети</div>
            ) : (
              <>
                {/* Main: 3 rows (slots 9–35) */}
                <div style={{ display: "grid", gridTemplateColumns: `repeat(9, ${SLOT_SZ}px)`, gap: 2, width: "fit-content", marginBottom: 4 }}>
                  {mainSlots.map((slot) => (
                    <SlotCell key={slot.slot} slot={slot} hotbarActive={false}
                      lmbFlash={lmbFlash.has(slot.slot)} rmbFlash={rmbFlash.has(slot.slot)}
                      onClick={() => handleClick(slot, 0, "__inventory__")}
                      onRightClick={(e) => { e.preventDefault(); handleClick(slot, 1, "__inventory__"); }}
                    />
                  ))}
                </div>
                {/* Separator */}
                <div style={{ height: 2, background: "rgba(0,200,255,.07)", borderRadius: 1, marginBottom: 4 }} />
                {/* Hotbar: 1 row (slots 36–44) */}
                <div style={{ display: "grid", gridTemplateColumns: `repeat(9, ${SLOT_SZ}px)`, gap: 2, width: "fit-content" }}>
                  {hotbarSlots.map((slot, i) => (
                    <SlotCell key={slot.slot} slot={slot} hotbarActive={i === hotbar}
                      lmbFlash={lmbFlash.has(slot.slot)} rmbFlash={rmbFlash.has(slot.slot)}
                      onClick={() => handleClick(slot, 0, "__inventory__")}
                      onRightClick={(e) => { e.preventDefault(); handleClick(slot, 1, "__inventory__"); }}
                    />
                  ))}
                </div>
              </>
            )}
          </div>
        </div>


      </div>

      {editOpen && <BotEditModal bot={bot} onClose={() => setEditOpen(false)} />}
    </div>
  );
}
