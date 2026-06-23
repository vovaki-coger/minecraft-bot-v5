import React, { useState, useEffect } from "react";
import { useAppStore } from "../../store/appStore";

// Полный список предметов Minecraft для пикера
const MC_ITEMS_CATEGORIES: Record<string, string[]> = {
  "Блоки": ["stone","cobblestone","dirt","gravel","sand","netherrack","soul_sand","obsidian","glass","brick","quartz_block","iron_block","gold_block","diamond_block","coal_block","emerald_block","wool","concrete","terracotta"],
  "Руды": ["coal_ore","iron_ore","gold_ore","diamond_ore","emerald_ore","lapis_ore","redstone_ore","nether_quartz_ore","ancient_debris"],
  "Растения": ["grass","fern","dead_bush","sugar_cane","vine","lily_pad","cactus","bamboo","kelp","seagrass","flower"],
  "Еда": ["rotten_flesh","spider_eye","pufferfish","poisonous_potato","raw_beef","raw_chicken","raw_mutton","raw_porkchop","raw_rabbit","raw_fish","raw_salmon"],
  "Мобы/Дроп": ["bone","arrow","feather","gunpowder","string","slimeball","blaze_rod","ghast_tear","magma_cream","ender_pearl","eye_of_ender","nether_star","dragon_breath"],
  "Мусор": ["dirt","gravel","sand","flint","stick","paper","book","map","empty_map","glass_bottle","bowl","bucket","flower_pot"],
};

const ALL_MC_ITEMS = Object.values(MC_ITEMS_CATEGORIES).flat();

interface ItemPickerProps {
  onSelect: (item: string) => void;
  onClose: () => void;
}

function ItemPicker({ onSelect, onClose }: ItemPickerProps) {
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState("Блоки");

  const filtered = search.trim()
    ? ALL_MC_ITEMS.filter(i => i.includes(search.toLowerCase()))
    : (MC_ITEMS_CATEGORIES[activeCategory] || []);

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 1000,
      background: "rgba(0,0,0,0.7)",
      display: "flex", alignItems: "center", justifyContent: "center",
      backdropFilter: "blur(4px)",
    }} onClick={onClose}>
      <div
        style={{
          background: "rgba(10,14,22,0.98)",
          border: "1px solid rgba(126,204,73,0.4)",
          borderRadius: 10,
          width: 420, maxHeight: 500,
          display: "flex", flexDirection: "column",
          boxShadow: "0 0 40px rgba(0,0,0,0.8), 0 0 20px rgba(126,204,73,0.1)",
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ padding: "12px 14px", borderBottom: "1px solid rgba(40,55,80,0.5)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ color: "#7ecc49", fontFamily: "monospace", fontSize: 12, fontWeight: "bold" }}>🎒 Выбор предмета</span>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "#555", cursor: "pointer", fontSize: 16 }}>✕</button>
        </div>
        {/* Search */}
        <div style={{ padding: "8px 12px", borderBottom: "1px solid rgba(40,55,80,0.3)" }}>
          <input
            className="input text-xs"
            autoFocus
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Поиск предмета..."
            style={{ borderColor: "rgba(126,204,73,0.3)" }}
          />
        </div>
        {/* Categories */}
        {!search && (
          <div style={{ padding: "6px 12px", borderBottom: "1px solid rgba(40,55,80,0.3)", display: "flex", flexWrap: "wrap", gap: 4 }}>
            {Object.keys(MC_ITEMS_CATEGORIES).map(cat => (
              <button
                key={cat}
                onClick={() => setActiveCategory(cat)}
                style={{
                  padding: "2px 8px", borderRadius: 3, fontSize: 10, fontFamily: "monospace", cursor: "pointer",
                  background: activeCategory === cat ? "rgba(126,204,73,0.12)" : "transparent",
                  border: `1px solid ${activeCategory === cat ? "rgba(126,204,73,0.5)" : "#2a2a2a"}`,
                  color: activeCategory === cat ? "#7ecc49" : "#555",
                }}
              >
                {cat}
              </button>
            ))}
          </div>
        )}
        {/* Items grid */}
        <div style={{ flex: 1, overflowY: "auto", padding: "8px 12px", display: "flex", flexWrap: "wrap", gap: 4, alignContent: "flex-start" }}>
          {filtered.map(item => (
            <button
              key={item}
              onClick={() => { onSelect(item); onClose(); }}
              style={{
                padding: "4px 8px", borderRadius: 4, fontSize: 10, fontFamily: "monospace", cursor: "pointer",
                background: "rgba(20,26,38,0.9)",
                border: "1px solid rgba(40,55,80,0.6)",
                color: "#aaa",
                transition: "all 0.1s",
              }}
              onMouseEnter={e => { (e.target as HTMLButtonElement).style.borderColor = "rgba(126,204,73,0.5)"; (e.target as HTMLButtonElement).style.color = "#7ecc49"; }}
              onMouseLeave={e => { (e.target as HTMLButtonElement).style.borderColor = "rgba(40,55,80,0.6)"; (e.target as HTMLButtonElement).style.color = "#aaa"; }}
            >
              {item}
            </button>
          ))}
          {filtered.length === 0 && (
            <div style={{ color: "#444", fontSize: 11, width: "100%", textAlign: "center", padding: "20px 0" }}>
              Ничего не найдено
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function SettingsTab() {
  const { globalPassword, globalProxy, bots, selectedBotId , updateBotConfigInStore } = useAppStore();
  const bot = bots.find((b) => b.id === selectedBotId);

  const [password, setPassword] = useState(globalPassword || "");
  const [proxy, setProxy] = useState(globalProxy || "");
  const [showPassword, setShowPassword] = useState(false);
  const [saved, setSaved] = useState(false);
  const [proxyResult, setProxyResult] = useState<string | null>(null);
  const [testingProxy, setTestingProxy] = useState(false);
  const [autoCollect, setAutoCollect] = useState(true);
  const [blacklist, setBlacklist] = useState<string[]>([]);
  const [showItemPicker, setShowItemPicker] = useState(false);
  const [blacklistSaved, setBlacklistSaved] = useState(false);

  // Lobby config
  const [lobbyEnabled, setLobbyEnabled] = useState(bot?.config.lobbyConfig?.enabled ?? true);
  const [lobbyMode, setLobbyMode] = useState(bot?.config.lobbyConfig?.mode || "auto");
  const [rankSlot, setRankSlot] = useState(String(bot?.config.lobbyConfig?.rankSlot ?? 0));
  const [rankName, setRankName] = useState(bot?.config.lobbyConfig?.rankName || "");
  const [rankWindowTitle, setRankWindowTitle] = useState(bot?.config.lobbyConfig?.rankWindowTitle || "");
  const [npcMode, setNpcMode] = useState(bot?.config.lobbyConfig?.npcMode ?? true);

  useEffect(() => {
    window.electronAPI.config.getGlobalPassword().then((p: string) => setPassword(p));
    window.electronAPI.config.get().then((cfg: any) => {
      setProxy(cfg.globalProxy || "");
      setAutoCollect(cfg.autoCollect !== false);
      setBlacklist(cfg.pickupBlacklist || []);
    });
  }, []);

  useEffect(() => {
    if (bot?.config.lobbyConfig) {
      const lc = bot.config.lobbyConfig;
      setLobbyEnabled(lc.enabled ?? true);
      setLobbyMode(lc.mode || "auto");
      setRankSlot(String(lc.rankSlot ?? 0));
      setRankName(lc.rankName || "");
      setRankWindowTitle(lc.rankWindowTitle || "");
      setNpcMode(lc.npcMode ?? true);
    }
  }, [bot?.id]);

  function flash(setter: (v: boolean) => void) {
    setter(true); setTimeout(() => setter(false), 2000);
  }

  async function handleSavePassword() {
    await window.electronAPI.config.setGlobalPassword(password);
    flash(setSaved);
  }
  async function handleSaveProxy() {
    await window.electronAPI.config.set("globalProxy", proxy);
    flash(setSaved);
  }
  async function handleTestProxy() {
    if (!proxy.trim()) return;
    setTestingProxy(true); setProxyResult(null);
    const result = await window.electronAPI.proxy.check(proxy);
    setProxyResult(result.success ? `✅ Работает! IP: ${result.ip}` : `❌ Ошибка: ${result.error}`);
    setTestingProxy(false);
  }
  async function handleSaveLobby() {
    if (!bot) return;
    const lobbyConfig = { enabled: lobbyEnabled, mode: lobbyMode, rankSlot: parseInt(rankSlot) || 0, rankName, rankWindowTitle, npcMode };
    await window.electronAPI.bot.updateConfig(bot.id, { lobbyConfig });
    updateBotConfigInStore(bot.id, { lobbyConfig });
    flash(setSaved);
  }
  async function handleSaveBlacklist() {
    await window.electronAPI.config.set("pickupBlacklist", blacklist);
    await window.electronAPI.config.set("autoCollect", autoCollect);
    flash(setBlacklistSaved);
  }
  async function handleTriggerLobby() {
    if (!bot) return;
    await window.electronAPI.bot.triggerLobby(bot.id);
  }

  function addBlacklistItem(item: string) {
    const normalized = item.trim().toLowerCase().replace(/\s+/g, "_");
    if (!normalized || blacklist.includes(normalized)) return;
    setBlacklist(prev => [...prev, normalized]);
  }

  const sectionStyle: React.CSSProperties = {
    background: "rgba(10,14,22,0.88)",
    border: "1px solid rgba(40,55,80,0.6)",
    borderRadius: 8, padding: 14,
    backdropFilter: "blur(8px)",
    boxShadow: "0 2px 12px rgba(0,0,0,0.3)",
  };
  const labelStyle: React.CSSProperties = {
    color: "#7ecc49", fontSize: 11.5, fontFamily: "monospace", fontWeight: "bold",
    marginBottom: 10, textShadow: "0 0 8px rgba(126,204,73,0.3)",
  };
  const hintStyle: React.CSSProperties = { color: "#3a4a3a", fontSize: 10.5, marginBottom: 8 };
  const tagStyle: React.CSSProperties = {
    display: "inline-flex", alignItems: "center", gap: 5,
    background: "rgba(20,28,40,0.9)", border: "1px solid rgba(40,55,80,0.6)",
    borderRadius: 4, padding: "3px 9px", fontSize: 10.5, color: "#9aa",
    fontFamily: "monospace",
  };

  return (
    <div className="flex flex-col h-full overflow-hidden" style={{ background: "transparent" }}>
      {showItemPicker && (
        <ItemPicker
          onSelect={addBlacklistItem}
          onClose={() => setShowItemPicker(false)}
        />
      )}

      <div className="px-3 py-2 border-b text-xs font-mono"
        style={{ borderColor: "rgba(40,55,80,0.5)", color: "#7ecc49", background: "rgba(6,9,14,0.9)", textShadow: "0 0 8px rgba(126,204,73,0.3)" }}>
        ⚙️ Настройки
      </div>

      <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-3">

        {/* ── ПАРОЛЬ ─────────────────────────────────────────────────── */}
        <div style={sectionStyle}>
          <div style={labelStyle}>🔑 Пароль авторизации</div>
          <p style={hintStyle}>/register и /login на всех серверах</p>
          <div className="flex gap-1">
            <input className="input text-xs flex-1" type={showPassword ? "text" : "password"}
              value={password} onChange={e => setPassword(e.target.value)} placeholder="Введите пароль..." />
            <button className="btn text-xs" onClick={() => setShowPassword(!showPassword)}>
              {showPassword ? "🙈" : "👁️"}
            </button>
          </div>
          <button className="btn btn-primary text-xs w-full mt-2" onClick={handleSavePassword}>
            {saved ? "✅ Сохранено!" : "💾 Сохранить"}
          </button>
        </div>

        {/* ── ПРОКСИ ─────────────────────────────────────────────────── */}
        <div style={sectionStyle}>
          <div style={labelStyle}>🔒 Глобальный прокси</div>
          <input className="input text-xs mb-2 w-full" value={proxy}
            onChange={e => setProxy(e.target.value)}
            placeholder="socks5://IP:порт" />
          <div className="flex gap-1">
            <button className="btn btn-primary text-xs flex-1" onClick={handleSaveProxy}>💾 Сохранить</button>
            <button className="btn text-xs" onClick={handleTestProxy} disabled={testingProxy || !proxy.trim()}>
              {testingProxy ? "⏳" : "🔍 Тест"}
            </button>
          </div>
          {proxyResult && (
            <div style={{ marginTop: 6, fontSize: 10.5, color: proxyResult.startsWith("✅") ? "#7ecc49" : "#e74c3c", fontFamily: "monospace" }}>
              {proxyResult}
            </div>
          )}
        </div>

        {/* ── ЧЁРНЫЙ СПИСОК ──────────────────────────────────────────── */}
        <div style={sectionStyle}>
          <div style={labelStyle}>🚫 Чёрный список подбора</div>
          <div className="flex items-center gap-2 mb-3">
            <input type="checkbox" checked={autoCollect} onChange={e => setAutoCollect(e.target.checked)}
              id="autoCollect" style={{ accentColor: "#7ecc49" }} />
            <label htmlFor="autoCollect" style={{ color: "#aaa", fontSize: 11, cursor: "pointer" }}>
              Авто-подбор предметов
            </label>
          </div>

          {/* Интерактивный пикер */}
          <button
            onClick={() => setShowItemPicker(true)}
            style={{
              width: "100%", padding: "8px 0", marginBottom: 10,
              borderRadius: 5, border: "1px dashed rgba(126,204,73,0.4)",
              background: "rgba(126,204,73,0.04)",
              color: "#7ecc49", fontFamily: "monospace", fontSize: 11,
              cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
              transition: "all 0.15s",
            }}
            onMouseEnter={e => { const el = e.currentTarget; el.style.background = "rgba(126,204,73,0.08)"; el.style.borderColor = "rgba(126,204,73,0.6)"; }}
            onMouseLeave={e => { const el = e.currentTarget; el.style.background = "rgba(126,204,73,0.04)"; el.style.borderColor = "rgba(126,204,73,0.4)"; }}
          >
            <span style={{ fontSize: 14 }}>+</span>
            <span>Выбрать предмет из списка</span>
          </button>

          {blacklist.length > 0 ? (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginBottom: 10 }}>
              {blacklist.map(item => (
                <div key={item} style={tagStyle}>
                  <span style={{ fontSize: 10 }}>🚫</span>
                  <span>{item}</span>
                  <button onClick={() => setBlacklist(p => p.filter(x => x !== item))}
                    style={{ background: "none", border: "none", color: "#444", cursor: "pointer", fontSize: 12, padding: 0, lineHeight: 1 }}>
                    ✕
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ color: "#333", fontSize: 10.5, marginBottom: 10, fontStyle: "italic" }}>
              Список пуст — подбираем всё
            </div>
          )}
          <button className="btn btn-primary text-xs w-full" onClick={handleSaveBlacklist}>
            {blacklistSaved ? "✅ Сохранено!" : "💾 Сохранить список"}
          </button>
        </div>

        {/* ── ЛОББИ ──────────────────────────────────────────────────── */}
        {bot && (
          <div style={sectionStyle}>
            <div style={labelStyle}>🏰 Настройки лобби</div>
            <div className="flex items-center gap-2 mb-3">
              <input type="checkbox" checked={lobbyEnabled} onChange={e => setLobbyEnabled(e.target.checked)}
                id="lobbyEnabled" style={{ accentColor: "#7ecc49" }} />
              <label htmlFor="lobbyEnabled" style={{ color: "#aaa", fontSize: 11, cursor: "pointer" }}>
                Авто-лобби включено
              </label>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div>
                <div style={{ color: "#444", fontSize: 10, marginBottom: 3 }}>Режим:</div>
                <select className="input text-xs" value={lobbyMode} onChange={e => setLobbyMode(e.target.value)}
                  style={{ background: "rgba(6,8,14,0.95)", color: "#ccc", border: "1px solid rgba(35,45,65,0.8)" }}>
                  <option value="auto">auto</option>
                  <option value="compass">compass</option>
                  <option value="npc">npc</option>
                  <option value="manual">manual</option>
                </select>
              </div>
              <div>
                <div style={{ color: "#444", fontSize: 10, marginBottom: 3 }}>Слот компаса (0-8):</div>
                <input className="input text-xs" value={rankSlot}
                  onChange={e => setRankSlot(e.target.value)} placeholder="0" type="number" min="0" max="8" />
              </div>
              <div>
                <div style={{ color: "#444", fontSize: 10, marginBottom: 3 }}>Название ранга:</div>
                <input className="input text-xs" value={rankName}
                  onChange={e => setRankName(e.target.value)} placeholder="VIP, MVP+ ..." />
              </div>
              <div>
                <div style={{ color: "#444", fontSize: 10, marginBottom: 3 }}>Заголовок окна:</div>
                <input className="input text-xs" value={rankWindowTitle}
                  onChange={e => setRankWindowTitle(e.target.value)} placeholder="Rank Selection" />
              </div>
              <div className="flex items-center gap-2">
                <input type="checkbox" checked={npcMode} onChange={e => setNpcMode(e.target.checked)}
                  id="npcMode" style={{ accentColor: "#7ecc49" }} />
                <label htmlFor="npcMode" style={{ color: "#aaa", fontSize: 11, cursor: "pointer" }}>NPC-режим</label>
              </div>
            </div>
            <div className="flex gap-2 mt-3">
              <button className="btn btn-primary text-xs flex-1" onClick={handleSaveLobby}>
                {saved ? "✅ Сохранено!" : "💾 Сохранить"}
              </button>
              <button className="btn text-xs" onClick={handleTriggerLobby}>
                🚀 Запустить
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
