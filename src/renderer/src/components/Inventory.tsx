import React, { useState, useEffect } from "react";
import { BotState, InventoryItem, useAppStore } from "../store/appStore";

interface Props { bot: BotState; }

// ── Minecraft-style textures ───────────────────────────────────────────────
function getItemIconSources(name: string): string[] {
  const formatted = name.split("_").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join("_");
  // texture:// — кастомный Electron-протокол, проксирует GitHub raw через net.fetch (обходит webSecurity)
  return [
    `texture://InventivetalentDev/minecraft-assets/1.20.4/assets/minecraft/textures/item/${name}.png`,
    `texture://InventivetalentDev/minecraft-assets/1.20.4/assets/minecraft/textures/block/${name}.png`,
    `texture://InventivetalentDev/minecraft-assets/1.21/assets/minecraft/textures/item/${name}.png`,
    `texture://InventivetalentDev/minecraft-assets/1.21/assets/minecraft/textures/block/${name}.png`,
    `https://minecraft.wiki/images/Invicon_${formatted}.png`,
  ];
}

type Category = "all" | "weapons" | "tools" | "armor" | "food" | "blocks" | "misc";

function getCategory(name: string): Category {
  if (/sword|bow|crossbow|trident|mace/.test(name)) return "weapons";
  if (/pickaxe|shovel|hoe|fishing_rod|flint_and_steel|shears/.test(name)) return "tools";
  if (/helmet|chestplate|leggings|boots|shield/.test(name)) return "armor";
  if (/apple|bread|beef|pork|chicken|mutton|salmon|cod|carrot|potato|melon|golden|cookie|cake|rabbit|stew|soup|pie|berry|sugar_cane/.test(name)) return "food";
  if (/log|wood|planks|stone|cobble|dirt|sand|gravel|glass|brick|concrete|wool|terracotta|ore|coal_block|iron_block|gold_block|diamond_block|emerald_block|quartz|obsidian|netherrack|soul/.test(name)) return "blocks";
  return "misc";
}

const CATEGORY_COLOR: Record<Category, string> = {
  all: "#7ecc49", weapons: "#e74c3c", tools: "#f39c12",
  armor: "#3498db", food: "#e67e22", blocks: "#95a5a6", misc: "#9b59b6",
};
const CATEGORY_LABEL: Record<Category, string> = {
  all: "Всё", weapons: "⚔ Оружие", tools: "⛏ Инстр.", armor: "🛡 Броня",
  food: "🍖 Еда", blocks: "🧱 Блоки", misc: "📦 Проч.",
};

function getDurabilityColor(pct: number): string {
  if (pct > 0.6) return "#7ecc49";
  if (pct > 0.3) return "#f39c12";
  return "#e74c3c";
}

// Slot index → mineflayer window slot number (main inventory: 9-35, hotbar: 36-44)
function uiSlotToMcSlot(uiSlot: number, isHotbar: boolean): number {
  if (isHotbar) return uiSlot + 36; // hotbar slots 36-44
  return uiSlot + 9;                // main slots 9-35
}

interface SlotProps {
  item: InventoryItem | null;
  active: boolean;
  highlight: boolean;
  dim?: boolean;
  slotIndex: number;
  isHotbar: boolean;
  botId: string;
  isChest?: boolean;
}

function ItemSlot({ item, active, highlight, dim, slotIndex, isHotbar, botId, isChest }: SlotProps) {
  const [srcIdx, setSrcIdx] = useState(0);
  const [hovered, setHovered] = useState(false);
  const [clicking, setClicking] = useState(false);
  const sources = item ? getItemIconSources(item.name) : [];
  const imgFailed = srcIdx >= sources.length;
  const cat = item ? getCategory(item.name) : "misc";
  const catColor = item ? CATEGORY_COLOR[cat] : "#555";
  const hasDur = item && (item as any).durabilityUsed !== undefined && (item as any).maxDurability > 0;
  const durPct = hasDur ? 1 - ((item as any).durabilityUsed / (item as any).maxDurability) : 1;
  const borderColor = active ? "#7ecc49" : highlight && item ? catColor : "#444";

  function handleClick(e: React.MouseEvent, button: number) {
    e.preventDefault();
    if (!botId) return;
    setClicking(true);
    setTimeout(() => setClicking(false), 200);
    const mcSlot = isChest ? slotIndex : uiSlotToMcSlot(slotIndex, isHotbar);
    (window as any).electronAPI?.bot?.clickItem?.(botId, mcSlot, button).catch(() => {});
  }

  return (
    <div
      style={{ position: "relative", display: "inline-block" }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div
        onClick={(e) => handleClick(e, 0)}
        onContextMenu={(e) => handleClick(e, 1)}
        style={{
          width: 36, height: 36,
          background: clicking ? "#2a3a1a" : active ? "#1e2e0f" : highlight && item ? `${catColor}15` : "#1a1a1a",
          border: `2px solid ${borderColor}`,
          borderBottomColor: active ? "#4a8c19" : highlight && item ? catColor : "#2a2a2a",
          borderRightColor: active ? "#4a8c19" : highlight && item ? catColor : "#2a2a2a",
          imageRendering: "pixelated",
          position: "relative",
          display: "flex", alignItems: "center", justifyContent: "center",
          flexShrink: 0, boxSizing: "border-box",
          cursor: item ? "pointer" : "default",
          transition: "all 0.08s",
          opacity: dim ? 0.4 : 1,
        }}
      >
        {item && (
          <>
            {!imgFailed ? (
              <img
                src={sources[srcIdx]}
                alt={item.name}
                width={26} height={26}
                style={{ imageRendering: "pixelated", display: "block" }}
                onError={() => setSrcIdx(p => p + 1)}
                draggable={false}
              />
            ) : (
              // Fallback: coloured square with first letter (Minecraft-style)
              <div style={{
                width: 26, height: 26, background: catColor + "44",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 11, color: catColor, fontWeight: "bold", fontFamily: "monospace",
                textTransform: "uppercase", border: `1px solid ${catColor}55`,
              }}>
                {item.name.charAt(0)}
              </div>
            )}
            {item.count > 1 && (
              <span style={{
                position: "absolute", bottom: 1, right: 2,
                fontSize: 8.5, color: "#fff",
                textShadow: "1px 1px 0 #000, -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000",
                fontWeight: "bold", fontFamily: "monospace", lineHeight: 1, pointerEvents: "none",
              }}>{item.count}</span>
            )}
            {hasDur && (
              <div style={{
                position: "absolute", bottom: 0, left: 1, right: 1, height: 2,
                background: "#111", borderRadius: 1,
              }}>
                <div style={{
                  width: `${Math.round(durPct * 100)}%`, height: "100%",
                  background: getDurabilityColor(durPct), borderRadius: 1,
                }} />
              </div>
            )}
          </>
        )}
      </div>

      {/* Tooltip */}
      {hovered && item && (
        <div style={{
          position: "absolute", bottom: "calc(100% + 4px)", left: "50%",
          transform: "translateX(-50%)", zIndex: 200,
          background: "rgba(16, 0, 32, 0.95)", border: `1px solid ${catColor}`,
          borderRadius: 3, padding: "6px 9px",
          pointerEvents: "none", whiteSpace: "nowrap",
          boxShadow: `0 4px 16px rgba(0,0,0,0.7), 0 0 8px ${catColor}30`,
          minWidth: 130,
        }}>
          <div style={{ color: catColor, fontSize: 11, fontWeight: "bold", fontFamily: "monospace" }}>
            {(item.displayName || item.name).replace(/_/g, " ")}
          </div>
          {item.count > 1 && (
            <div style={{ color: "#aaa", fontSize: 9.5, marginTop: 2 }}>
              Количество: <span style={{ color: "#eee" }}>{item.count}</span>
            </div>
          )}
          {hasDur && (
            <div style={{ color: "#aaa", fontSize: 9.5 }}>
              Прочность: <span style={{ color: getDurabilityColor(durPct) }}>{Math.round(durPct * 100)}%</span>
            </div>
          )}
          <div style={{ color: "#555", fontSize: 8.5, marginTop: 3, borderTop: "1px solid #333", paddingTop: 3 }}>
            ЛКМ — взять · ПКМ — действие
          </div>
        </div>
      )}
    </div>
  );
}

const CATEGORIES: Category[] = ["all", "weapons", "tools", "armor", "food", "blocks", "misc"];

export default function Inventory({ bot }: Props) {
  const [activeCategory, setActiveCategory] = useState<Category>("all");
  const { inventory = [], hotbarSlot = 0 } = bot.stats;

  // Chest state (emitted from main process)
  const [chestItems, setChestItems] = useState<InventoryItem[]>([]);
  const [chestTitle, setChestTitle] = useState("");
  const [chestOpen, setChestOpen] = useState(false);

  useEffect(() => {
    const api = (window as any).electronAPI;
    if (!api?.on) return;
    // bot:windowOpen шлёт { botId, window: { title, slots } }
    const offOpen = api.on("bot:windowOpen", (data: { botId: string; window?: { title: string; slots: InventoryItem[] } }) => {
      if (data.botId !== bot.id) return;
      const slots = data.window?.slots || [];
      // Фильтруем пустые слоты (count=0 и нет имени)
      const filled = slots.filter((s: InventoryItem) => s.count > 0 || s.name);
      setChestItems(filled);
      setChestTitle(data.window?.title || "Контейнер");
      setChestOpen(true);
    });
    const offClose = api.on("bot:windowClose", (data: { botId: string }) => {
      if (data.botId !== bot.id) return;
      setChestOpen(false);
      setChestItems([]);
    });
    // Явные события от bot-manager (closeBotWindow)
    const offChestOpen = api.on("bot:chestOpened", (data: { botId: string; title?: string; items?: InventoryItem[] }) => {
      if (data.botId !== bot.id) return;
      setChestItems(data.items || []);
      setChestTitle(data.title || "Контейнер");
      setChestOpen(true);
    });
    const offChestClose = api.on("bot:chestClosed", (data: { botId: string }) => {
      if (data.botId !== bot.id) return;
      setChestOpen(false);
      setChestItems([]);
    });
    return () => { offOpen?.(); offClose?.(); offChestOpen?.(); offChestClose?.(); };
  }, [bot.id]);

  const slots: (InventoryItem | null)[] = Array(36).fill(null);
  for (const item of inventory) {
    if (item.slot >= 9 && item.slot < 45) slots[item.slot - 9] = item;
  }
  const mainSlots = slots.slice(0, 27);
  const hotbarSlots = slots.slice(27, 36);

  const totalItems = inventory.length;
  const totalCount = inventory.reduce((s, i) => s + i.count, 0);
  const weightPct = Math.round((totalItems / 36) * 100);

  const shouldHighlight = (item: InventoryItem | null) =>
    activeCategory === "all" || (item !== null && getCategory(item.name) === activeCategory);
  const shouldDim = (item: InventoryItem | null) =>
    activeCategory !== "all" && item !== null && getCategory(item.name) !== activeCategory;

  const categoryCounts: Partial<Record<Category, number>> = {};
  for (const item of inventory) {
    const c = getCategory(item.name);
    categoryCounts[c] = (categoryCounts[c] || 0) + 1;
  }

  // Chest grid
  const chestSlots: (InventoryItem | null)[] = Array(54).fill(null);
  for (const item of chestItems) {
    if (item.slot >= 0 && item.slot < 54) chestSlots[item.slot] = item;
  }
  const chestRows = Math.ceil(chestItems.length > 0 ? Math.max(...chestItems.map(i => i.slot + 1)) : 0 / 9) || 3;

  return (
    <div style={{ background: "rgba(13,17,23,0.82)", borderRadius: 6, padding: "10px 10px 8px", backdropFilter: "blur(4px)" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 7 }}>
        <span style={{ color: "#7ecc49", fontSize: 11.5, fontFamily: "monospace", fontWeight: "bold" }}>
          🎒 Инвентарь
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ color: "#555", fontSize: 10 }}>{totalCount} шт</span>
          <div style={{ width: 55, height: 3, background: "#2a2a2a", borderRadius: 2 }}>
            <div style={{
              width: `${weightPct}%`, height: "100%",
              background: weightPct > 80 ? "#e74c3c" : "#7ecc49", borderRadius: 2,
              transition: "width 0.3s",
            }} />
          </div>
          <span style={{ color: "#555", fontSize: 10 }}>{totalItems}/36</span>
        </div>
      </div>

      {/* Category filter */}
      <div style={{ display: "flex", gap: 2, marginBottom: 7, flexWrap: "wrap" }}>
        {CATEGORIES.filter(c => c === "all" || (categoryCounts[c] || 0) > 0).map(cat => (
          <button
            key={cat}
            onClick={() => setActiveCategory(cat)}
            style={{
              background: activeCategory === cat ? CATEGORY_COLOR[cat] + "28" : "transparent",
              border: `1px solid ${activeCategory === cat ? CATEGORY_COLOR[cat] : "#2a2a2a"}`,
              borderRadius: 3, padding: "1px 5px",
              color: activeCategory === cat ? CATEGORY_COLOR[cat] : "#444",
              fontSize: 8.5, fontFamily: "monospace", cursor: "pointer",
              transition: "all 0.12s",
            }}
          >
            {cat === "all" ? `Всё (${totalItems})` : `${CATEGORY_LABEL[cat].split(" ")[0]} ${categoryCounts[cat] || 0}`}
          </button>
        ))}
      </div>

      {/* Minecraft Inventory Grid */}
      <div style={{
        background: "#C6C6C6",
        border: "2px solid #555",
        borderTopColor: "#fff", borderLeftColor: "#fff",
        padding: "4px 4px 2px",
        display: "inline-block", width: "100%", boxSizing: "border-box",
        borderRadius: 2,
      }}>
        {/* 3 main rows */}
        <div style={{
          display: "grid", gridTemplateColumns: "repeat(9, 36px)",
          gap: 2, justifyContent: "center", marginBottom: 4,
        }}>
          {mainSlots.map((item, i) => (
            <ItemSlot key={i} item={item} active={false}
              highlight={shouldHighlight(item)} dim={shouldDim(item)}
              slotIndex={i} isHotbar={false} botId={bot.id} />
          ))}
        </div>

        {/* Divider */}
        <div style={{ height: 2, background: "#888", borderTopColor: "#555", margin: "2px 0" }} />

        {/* Hotbar */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(9, 36px)", gap: 2, justifyContent: "center" }}>
          {hotbarSlots.map((item, i) => (
            <ItemSlot key={i} item={item} active={i === hotbarSlot}
              highlight={shouldHighlight(item)} dim={shouldDim(item)}
              slotIndex={i} isHotbar={true} botId={bot.id} />
          ))}
        </div>
      </div>

      {/* Chest section — shown when container is open */}
      {chestOpen && (
        <div style={{ marginTop: 10 }}>
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            marginBottom: 5,
          }}>
            <span style={{ color: "#e67e22", fontSize: 11, fontFamily: "monospace", fontWeight: "bold" }}>
              📦 {chestTitle}
            </span>
            <button
              onClick={() => { setChestOpen(false); (window as any).electronAPI?.bot?.closeWindow?.(bot.id).catch?.(() => {}); }}
              style={{ background: "none", border: "1px solid #444", borderRadius: 3,
                color: "#888", fontSize: 9, padding: "1px 6px", cursor: "pointer" }}
            >
              ✕ Закрыть
            </button>
          </div>
          <div style={{
            background: "#C6C6C6",
            border: "2px solid #555", borderTopColor: "#fff", borderLeftColor: "#fff",
            padding: "4px", display: "inline-block", width: "100%", boxSizing: "border-box",
            borderRadius: 2,
          }}>
            <div style={{
              display: "grid", gridTemplateColumns: "repeat(9, 36px)",
              gap: 2, justifyContent: "center",
            }}>
              {chestSlots.slice(0, Math.max(27, chestRows * 9)).map((item, i) => (
                <ItemSlot key={i} item={item} active={false} highlight={true}
                  slotIndex={i} isHotbar={false} botId={bot.id} isChest={true} />
              ))}
            </div>
          </div>
        </div>
      )}

      {totalItems === 0 && !chestOpen && (
        <div style={{ textAlign: "center", color: "#555", fontSize: 11, marginTop: 8 }}>
          Инвентарь пуст
        </div>
      )}
    </div>
  );
}
