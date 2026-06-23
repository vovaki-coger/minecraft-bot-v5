import React, { useState, useEffect } from "react";
import { useAppStore } from "../../store/appStore";

const POTION_TYPES = [
  { id: "healing",       label: "❤️ Лечение",       color: "#e74c3c" },
  { id: "regeneration",  label: "💚 Регенерация",    color: "#2ecc71" },
  { id: "strength",      label: "💪 Сила",           color: "#8e44ad" },
  { id: "speed",         label: "⚡ Скорость",       color: "#3498db" },
  { id: "fire_resistance",label:"🔥 Огнестойкость",  color: "#e67e22" },
  { id: "poison",        label: "☠️ Яд (дебаф)",     color: "#27ae60" },
  { id: "weakness",      label: "💔 Слабость (деб.)", color: "#7f8c8d" },
  { id: "slowness",      label: "🐌 Медлительность",  color: "#566573" },
  { id: "blindness",     label: "🕶 Слепота (деб.)",  color: "#212121" },
  { id: "instant_damage",label: "💥 Вред (дебаф)",   color: "#e74c3c" },
];

interface CustomPotion {
  id: string;
  name: string;
  type: "buff" | "debuff";
  potionType: string;
  splash: boolean;
}

interface ServerProfile {
  id: string;
  label: string;
  emoji: string;
  desc: string;
  gappleCooldown: number;
  enchantedGappleCooldown: number;
  pearlCooldown: number;
  attackRange: number;
  color: string;
}

const SERVER_PROFILES: ServerProfile[] = [
  {
    id: "SpookyTime",
    label: "SpookyTime",
    emoji: "🎃",
    desc: "1.8 PVP | 🍏 обычный гэпл КД=30с | ✨ зачарованный гэпл КД=150с",
    gappleCooldown: 30,
    enchantedGappleCooldown: 150,
    pearlCooldown: 10,
    attackRange: 4.5,
    color: "#e67e22",
  },
  {
    id: "FunTime",
    label: "FunTime",
    emoji: "🎮",
    desc: "1.8 PVP | 🍏 гэпл КД=30с | ✨ зачарованный КД=120с",
    gappleCooldown: 30,
    enchantedGappleCooldown: 120,
    pearlCooldown: 16,
    attackRange: 4.5,
    color: "#3498db",
  },
  {
    id: "RealWorld",
    label: "RealWorld",
    emoji: "🌍",
    desc: "1.8 PVP | 🍏 гэпл КД=120с | ✨ зачарованный КД=120с",
    gappleCooldown: 120,
    enchantedGappleCooldown: 120,
    pearlCooldown: 20,
    attackRange: 4.5,
    color: "#7ecc49",
  },
  {
    id: "custom",
    label: "Своё",
    emoji: "⚙️",
    desc: "Ручная настройка кулдаунов яблок и жемчуга",
    gappleCooldown: 30,
    enchantedGappleCooldown: 120,
    pearlCooldown: 16,
    attackRange: 4.0,
    color: "#9b59b6",
  },
];

export default function PvpTab() {
  // ── Получаем updateBotConfigInStore для синхронизации store после save ──
  const bots = useAppStore(s => s.bots);
  const selectedBotId = useAppStore(s => s.selectedBotId);
  const updateBotConfigInStore = useAppStore(s => s.updateBotConfigInStore);
  const bot = bots.find(b => b.id === selectedBotId) || null;

  const [teammates, setTeammates]         = useState<string[]>([]);
  const [teammateInput, setTeammateInput] = useState("");
  const [customPotions, setCustomPotions] = useState<CustomPotion[]>([]);
  const [showPotionForm, setShowPotionForm] = useState(false);
  const [newPotion, setNewPotion]         = useState<Partial<CustomPotion>>({ type: "buff", potionType: "healing", splash: true });
  const [autoTarget, setAutoTarget]       = useState(true);
  const [attackRange, setAttackRange]     = useState(4.5);
  const [pvpActive, setPvpActive]         = useState(false);
  const [saved, setSaved]                 = useState(false);

  const [serverProfile, setServerProfile]                     = useState<string>("custom");
  const [gappleCooldown, setGappleCooldown]                   = useState(30);
  const [enchantedGappleCooldown, setEnchantedGappleCooldown] = useState(120);
  const [pearlCooldown, setPearlCooldown]                     = useState(16);

  const activeProfile = SERVER_PROFILES.find(p => p.id === serverProfile) || SERVER_PROFILES[3];

  // ── Читаем из store ТОЛЬКО при смене бота (bot?.id) ──────────────────
  // После save — store обновляется через updateBotConfigInStore,
  // поэтому при возврате на вкладку useEffect увидит актуальные данные
  useEffect(() => {
    if (!bot) return;
    const cfg = bot.config as any;
    setTeammates(Array.isArray(cfg.teammates) ? cfg.teammates : []);
    setCustomPotions(cfg.pvpCustomPotions || []);
    setAutoTarget(cfg.pvpAutoTarget !== false);
    setAttackRange(cfg.pvpAttackRange || 4.5);
    setPvpActive((bot as any).pvpMode || false);
    setServerProfile(cfg.pvpServerProfile || "custom");
    setGappleCooldown(cfg.pvpGappleCooldown ?? 30);
    setEnchantedGappleCooldown(cfg.pvpEnchantedGappleCooldown ?? 120);
    setPearlCooldown(cfg.pvpPearlCooldown ?? 16);
  }, [bot?.id]);

  // Синхронизируем pvpActive при изменении pvpMode в store
  useEffect(() => {
    if (bot) setPvpActive((bot as any).pvpMode || false);
  }, [(bot as any)?.pvpMode]);

  function applyProfile(profile: ServerProfile) {
    setServerProfile(profile.id);
    setGappleCooldown(profile.gappleCooldown);
    setEnchantedGappleCooldown(profile.enchantedGappleCooldown);
    setPearlCooldown(profile.pearlCooldown);
    setAttackRange(profile.attackRange);
  }

  function addTeammate() {
    const n = teammateInput.trim();
    if (!n || teammates.includes(n)) return;
    setTeammates(p => [...p, n]);
    setTeammateInput("");
  }

  function addPotion() {
    if (!newPotion.potionType) return;
    const isDebuff = ["poison","weakness","slowness","blindness","instant_damage"].includes(newPotion.potionType || "");
    const potion: CustomPotion = {
      id: Date.now().toString(),
      name: (newPotion.splash ? "splash_potion" : "potion") + "_of_" + newPotion.potionType,
      type: isDebuff ? "debuff" : "buff",
      potionType: newPotion.potionType!,
      splash: !!newPotion.splash,
    };
    setCustomPotions(p => [...p, potion]);
    setShowPotionForm(false);
    setNewPotion({ type: "buff", potionType: "healing", splash: true });
  }

  async function handleSave() {
    if (!bot) return;
    const patch = {
      teammates,
      pvpCustomPotions:           customPotions,
      pvpAutoTarget:              autoTarget,
      pvpAttackRange:             attackRange,
      pvpServerProfile:           serverProfile,
      pvpGappleCooldown:          gappleCooldown,
      pvpEnchantedGappleCooldown: enchantedGappleCooldown,
      pvpPearlCooldown:           pearlCooldown,
    };
    try {
      await (window as any).electronAPI.bot.updateConfig(bot.id, patch);
      // ── КЛЮЧЕВОЙ ФИС: обновляем Zustand store сразу ─────────────────
      // Без этого при переходе на другую вкладку и обратно
      // useEffect читал бы старый bot.config из store
      updateBotConfigInStore(bot.id, patch);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      console.error("[PvpTab] save error:", err);
    }
  }

  async function handleTogglePvp() {
    if (!bot) return;
    if (pvpActive) {
      await (window as any).electronAPI.bot.stopPvp(bot.id);
      setPvpActive(false);
    } else {
      await handleSave();
      await (window as any).electronAPI.bot.startPvp(bot.id, {
        autoTarget,
        teammates,
        customPotions,
        attackRange,
        serverProfile,
        gappleCooldown,
        enchantedGappleCooldown,
        pearlCooldown,
      });
      setPvpActive(true);
    }
  }

  const sectionCls: React.CSSProperties = {
    background:   "rgba(14,18,26,0.9)",
    border:       "1px solid rgba(55,65,88,0.7)",
    borderRadius: 8,
    padding:      14,
    backdropFilter: "blur(8px)",
    boxShadow:    "0 0 20px rgba(0,0,0,0.3)",
  };
  const labelCls: React.CSSProperties = {
    color: "#e74c3c", fontSize: 11.5, fontFamily: "monospace", fontWeight: "bold",
    marginBottom: 10, display: "flex", alignItems: "center", gap: 6,
    textShadow: "0 0 8px rgba(231,76,60,0.4)",
  };
  const tagCls: React.CSSProperties = {
    display: "inline-flex", alignItems: "center", gap: 5,
    background: "rgba(231,76,60,0.1)", border: "1px solid rgba(231,76,60,0.4)",
    borderRadius: 4, padding: "3px 9px", fontSize: 10.5, color: "#e67e7e", fontFamily: "monospace",
  };

  const pvpColor = pvpActive ? "#e74c3c" : "#9b59b6";

  return (
    <div className="flex flex-col h-full overflow-hidden" style={{ background: "transparent" }}>
      {/* Header */}
      <div className="px-3 py-2 border-b flex items-center justify-between"
        style={{ borderColor: "rgba(231,76,60,0.3)", background: "rgba(10,12,18,0.85)" }}>
        <span className="font-mono text-xs font-bold" style={{ color: "#e74c3c", textShadow: "0 0 10px rgba(231,76,60,0.5)" }}>
          ⚔️ PVP-нейросеть v5
        </span>
        {bot && (
          <span className="text-xs font-mono" style={{ color: pvpActive ? "#e74c3c" : "#555" }}>
            {pvpActive ? "● крит+спринт" : "○ неактивен"}
          </span>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-3">

        {/* ── КНОПКА ЗАПУСКА ─────────────────────────────────────────── */}
        <button
          onClick={handleTogglePvp}
          disabled={!bot || bot.status !== "online"}
          style={{
            width: "100%", padding: "10px 0", borderRadius: 6,
            border: `1px solid ${pvpColor}`,
            background: pvpActive ? "rgba(231,76,60,0.15)" : "rgba(155,89,182,0.12)",
            color: pvpColor, fontFamily: "monospace", fontSize: 12,
            cursor: "pointer", fontWeight: "bold", letterSpacing: "0.05em",
            boxShadow: pvpActive ? "0 0 15px rgba(231,76,60,0.3)" : "none",
            transition: "all 0.2s",
            opacity: (!bot || bot.status !== "online") ? 0.4 : 1,
          }}>
          {pvpActive ? "⏹ ОСТАНОВИТЬ PVP" : "▶ ЗАПУСТИТЬ PVP (крит+спринт)"}
        </button>

        {/* ── СЕРВЕРНЫЙ ПРОФИЛЬ ──────────────────────────────────────── */}
        <div style={sectionCls}>
          <div style={labelCls}>🌐 Профиль сервера</div>
          <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 10 }}>
            {SERVER_PROFILES.map(profile => (
              <button
                key={profile.id}
                onClick={() => applyProfile(profile)}
                style={{
                  flex: "1 1 auto", minWidth: 70, padding: "7px 6px", borderRadius: 5,
                  border: `1px solid ${serverProfile === profile.id ? profile.color : "rgba(55,65,88,0.6)"}`,
                  background: serverProfile === profile.id ? `${profile.color}18` : "rgba(14,18,26,0.6)",
                  color: serverProfile === profile.id ? profile.color : "#666",
                  fontFamily: "monospace", fontSize: 10, cursor: "pointer", transition: "all 0.15s",
                  fontWeight: serverProfile === profile.id ? "bold" : "normal",
                }}>
                <div style={{ fontSize: 14 }}>{profile.emoji}</div>
                <div>{profile.label}</div>
              </button>
            ))}
          </div>
          <div style={{ fontSize: 10, color: "#555", fontFamily: "monospace", marginBottom: 12, lineHeight: 1.5 }}>
            {activeProfile.desc}
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {/* Golden Apple */}
            <div style={{ background: "rgba(126,204,73,0.05)", border: "1px solid rgba(126,204,73,0.2)", borderRadius: 5, padding: "8px 10px" }}>
              <div style={{ color: "#666", fontSize: 10, marginBottom: 4, display: "flex", justifyContent: "space-between" }}>
                <span>🍏 Golden Apple КД:</span>
                <span style={{ color: "#7ecc49", fontWeight: "bold" }}>
                  {gappleCooldown === 0 ? "нет КД" : gappleCooldown + " сек"}
                </span>
              </div>
              <input type="range" min={0} max={300} step={5} value={gappleCooldown}
                onChange={e => setGappleCooldown(+e.target.value)}
                style={{ width: "100%", accentColor: "#7ecc49" }} />
              <div style={{ color: "#444", fontSize: 9, marginTop: 2 }}>SpookyTime=30с · FunTime=30с · RealWorld=120с</div>
            </div>
            {/* Enchanted Golden Apple */}
            <div style={{ background: "rgba(243,156,18,0.05)", border: "1px solid rgba(243,156,18,0.2)", borderRadius: 5, padding: "8px 10px" }}>
              <div style={{ color: "#666", fontSize: 10, marginBottom: 4, display: "flex", justifyContent: "space-between" }}>
                <span>✨ Enchanted Golden Apple КД:</span>
                <span style={{ color: "#f39c12", fontWeight: "bold" }}>
                  {enchantedGappleCooldown === 0 ? "нет КД" : enchantedGappleCooldown + " сек"}
                </span>
              </div>
              <input type="range" min={0} max={300} step={5} value={enchantedGappleCooldown}
                onChange={e => setEnchantedGappleCooldown(+e.target.value)}
                style={{ width: "100%", accentColor: "#f39c12" }} />
              <div style={{ color: "#444", fontSize: 9, marginTop: 2 }}>SpookyTime=150с · FunTime/RealWorld=120с</div>
            </div>
            {/* Жемчуг */}
            <div>
              <div style={{ color: "#666", fontSize: 10, marginBottom: 3, display: "flex", justifyContent: "space-between" }}>
                <span>🔮 Эндер-жемчуг КД:</span>
                <span style={{ color: "#3498db" }}>{pearlCooldown} сек</span>
              </div>
              <input type="range" min={0} max={60} step={1} value={pearlCooldown}
                onChange={e => setPearlCooldown(+e.target.value)}
                style={{ width: "100%", accentColor: "#3498db" }} />
            </div>
          </div>
        </div>

        {/* ── HP-ЛОГИКА ЕДЫ ──────────────────────────────────────────── */}
        <div style={{ ...sectionCls, borderColor: "rgba(230,126,34,0.3)" }}>
          <div style={{ color: "#e67e22", fontSize: 11, fontFamily: "monospace", fontWeight: "bold", marginBottom: 8 }}>
            🍖 Логика еды по HP (авто)
          </div>
          <div style={{ fontSize: 10, color: "#888", fontFamily: "monospace", lineHeight: 1.8 }}>
            <div>HP ≥ 15 или HP 8-14 + голод: <span style={{ color: "#bbb" }}>🥕 морковь → 🥩 мясо → 🍞 хлеб</span></div>
            <div>HP ≤ 8 + еда полная (≥18):    <span style={{ color: "#7ecc49" }}>🍏 gapple сразу</span></div>
            <div>HP ≤ 8 + еда не полная:       <span style={{ color: "#f39c12" }}>🥩 мясо → потом 🍏 gapple</span></div>
            <div>HP ≤ 4 (экстренное):          <span style={{ color: "#e74c3c" }}>✨ enchanted gapple / хилка</span></div>
          </div>
        </div>

        {/* ── ПАРАМЕТРЫ БОЯ ──────────────────────────────────────────── */}
        <div style={sectionCls}>
          <div style={labelCls}>⚙️ Параметры боя</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
              <input type="checkbox" checked={autoTarget} onChange={e => setAutoTarget(e.target.checked)}
                style={{ accentColor: "#e74c3c" }} />
              <span style={{ color: "#bbb", fontSize: 11 }}>Авто-выбор цели</span>
            </label>
            <div>
              <div style={{ color: "#666", fontSize: 10, marginBottom: 4 }}>
                Дальность атаки: <span style={{ color: "#e74c3c" }}>{attackRange} блоков</span>
              </div>
              <input type="range" min={2} max={6} step={0.5} value={attackRange}
                onChange={e => setAttackRange(parseFloat(e.target.value))}
                style={{ width: "100%", accentColor: "#e74c3c" }} />
            </div>
            <div style={{ background: "rgba(231,76,60,0.05)", border: "1px solid rgba(231,76,60,0.2)", borderRadius: 5, padding: "6px 10px", fontSize: 10, color: "#888", fontFamily: "monospace" }}>
              <span style={{ color: "#e74c3c" }}>⚡ Режим:</span> Крит (прыжок@360мс) + спринт (Ctrl+W)
            </div>
            <div style={{ background: "rgba(52,152,219,0.05)", border: "1px solid rgba(52,152,219,0.2)", borderRadius: 5, padding: "6px 10px", fontSize: 10, color: "#888", fontFamily: "monospace" }}>
              <span style={{ color: "#3498db" }}>🤝 Ollama:</span> ИИ автоматически ставится на паузу пока PVP активен
            </div>
          </div>
        </div>

        {/* ── ТИМЕЙТЫ ────────────────────────────────────────────────── */}
        <div style={sectionCls}>
          <div style={labelCls}>🤝 Тимейты (не атакуем)</div>
          <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
            <input
              className="input text-xs flex-1"
              value={teammateInput}
              onChange={e => setTeammateInput(e.target.value)}
              placeholder="Никнейм союзника..."
              onKeyDown={e => e.key === "Enter" && addTeammate()}
              style={{ borderColor: "rgba(231,76,60,0.3)" }}
            />
            <button onClick={addTeammate}
              style={{ padding: "4px 12px", borderRadius: 4, border: "1px solid rgba(231,76,60,0.5)", background: "rgba(231,76,60,0.1)", color: "#e74c3c", cursor: "pointer", fontFamily: "monospace", fontSize: 12 }}>
              +
            </button>
          </div>
          {teammates.length > 0 ? (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
              {teammates.map(nick => (
                <div key={nick} style={tagCls}>
                  <span>👤</span><span>{nick}</span>
                  <button onClick={() => setTeammates(p => p.filter(x => x !== nick))}
                    style={{ background: "none", border: "none", color: "#666", cursor: "pointer", padding: 0 }}>✕</button>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ color: "#444", fontSize: 10, fontStyle: "italic" }}>Нет союзников — атакуем всех</div>
          )}
        </div>

        {/* ── ЗЕЛЬЯ ──────────────────────────────────────────────────── */}
        <div style={sectionCls}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
            <div style={labelCls}>🧪 Зелья нейросети</div>
            <button onClick={() => setShowPotionForm(v => !v)}
              style={{ padding: "3px 10px", borderRadius: 4, border: "1px solid rgba(52,152,219,0.5)", background: "rgba(52,152,219,0.1)", color: "#5dade2", cursor: "pointer", fontSize: 11, fontFamily: "monospace" }}>
              {showPotionForm ? "✕ Закрыть" : "+ Добавить"}
            </button>
          </div>

          {showPotionForm && (
            <div style={{ background: "rgba(8,10,16,0.8)", border: "1px solid rgba(52,152,219,0.3)", borderRadius: 6, padding: 12, marginBottom: 10 }}>
              <div style={{ color: "#5dade2", fontSize: 11, fontFamily: "monospace", marginBottom: 8 }}>Новое зелье</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <select value={newPotion.potionType}
                  onChange={e => setNewPotion(p => ({ ...p, potionType: e.target.value }))}
                  style={{ width: "100%", background: "rgba(8,10,16,0.9)", color: "#ccc", border: "1px solid #2a3040", borderRadius: 4, padding: "5px 8px", fontFamily: "monospace", fontSize: 11 }}>
                  {POTION_TYPES.map(pt => <option key={pt.id} value={pt.id}>{pt.label}</option>)}
                </select>
                <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                  <input type="checkbox" checked={!!newPotion.splash} onChange={e => setNewPotion(p => ({ ...p, splash: e.target.checked }))}
                    style={{ accentColor: "#5dade2" }} />
                  <span style={{ color: "#bbb", fontSize: 11 }}>Сплэш (бросить)</span>
                </label>
                <div style={{ display: "flex", gap: 4 }}>
                  {["buff","debuff"].map(t => (
                    <button key={t} onClick={() => setNewPotion(p => ({ ...p, type: t as any }))}
                      style={{
                        flex: 1, padding: "5px 0", borderRadius: 4, fontSize: 11, fontFamily: "monospace", cursor: "pointer",
                        border: `1px solid ${newPotion.type === t ? (t === "buff" ? "#7ecc49" : "#e74c3c") : "#333"}`,
                        background: newPotion.type === t ? (t === "buff" ? "rgba(126,204,73,0.1)" : "rgba(231,76,60,0.1)") : "transparent",
                        color: newPotion.type === t ? (t === "buff" ? "#7ecc49" : "#e74c3c") : "#555",
                      }}>
                      {t === "buff" ? "✅ Баф (на себя)" : "💀 Дебаф (на врага)"}
                    </button>
                  ))}
                </div>
                <button onClick={addPotion}
                  style={{ padding: "7px 0", borderRadius: 4, border: "1px solid rgba(126,204,73,0.5)", background: "rgba(126,204,73,0.1)", color: "#7ecc49", cursor: "pointer", fontFamily: "monospace", fontSize: 11 }}>
                  ✅ Добавить зелье
                </button>
              </div>
            </div>
          )}

          {customPotions.length > 0 ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              {customPotions.map(pot => {
                const pt = POTION_TYPES.find(p => p.id === pot.potionType);
                return (
                  <div key={pot.id} style={{
                    display: "flex", alignItems: "center", justifyContent: "space-between",
                    background: "rgba(20,24,32,0.8)",
                    border: `1px solid ${pot.type === "buff" ? "rgba(126,204,73,0.3)" : "rgba(231,76,60,0.3)"}`,
                    borderRadius: 5, padding: "6px 10px",
                  }}>
                    <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                      <span style={{ color: pt?.color || "#aaa", fontSize: 11, fontFamily: "monospace" }}>{pt?.label || pot.potionType}</span>
                      <span style={{ color: "#555", fontSize: 9 }}>{pot.splash ? "Сплэш" : "Питьевое"} · {pot.type === "buff" ? "баф" : "дебаф"}</span>
                    </div>
                    <button onClick={() => setCustomPotions(p => p.filter(x => x.id !== pot.id))}
                      style={{ background: "none", border: "none", color: "#555", cursor: "pointer", fontSize: 14 }}>✕</button>
                  </div>
                );
              })}
            </div>
          ) : (
            <div style={{ color: "#444", fontSize: 10, fontStyle: "italic" }}>Зелья не настроены — нейросеть использует стандартные</div>
          )}
        </div>

        {/* ── О НЕЙРОСЕТИ ────────────────────────────────────────────── */}
        <div style={{ ...sectionCls, borderColor: "rgba(126,204,73,0.2)" }}>
          <div style={{ color: "#7ecc49", fontSize: 11.5, fontFamily: "monospace", fontWeight: "bold", marginBottom: 8, textShadow: "0 0 8px rgba(126,204,73,0.3)" }}>
            🧠 О нейросети
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 10.5, color: "#666", fontFamily: "monospace" }}>
            <div>Архитектура: <span style={{ color: "#7ecc49" }}>12→24→18→12→7</span></div>
            <div>Сценариев обучения: <span style={{ color: "#aaa" }}>10 000+</span></div>
            <div>Режим: <span style={{ color: "#e74c3c" }}>💥 Крит@360мс + 🏃 Спринт + 🎯 прицел в грудь</span></div>
            <div>Ollama конфликт: <span style={{ color: "#3498db" }}>✅ исправлен — авто-пауза</span></div>
            <div>Сохранение: <span style={{ color: "#7ecc49" }}>✅ исправлено — store синхронизирован</span></div>
          </div>
        </div>

        {/* ── СОХРАНИТЬ ──────────────────────────────────────────────── */}
        <button
          onClick={handleSave}
          disabled={!bot}
          style={{
            padding: "10px 0", borderRadius: 6,
            border: saved ? "1px solid #7ecc49" : "1px solid rgba(126,204,73,0.5)",
            background: saved ? "rgba(126,204,73,0.15)" : "rgba(126,204,73,0.08)",
            color: saved ? "#7ecc49" : "#6ab04c",
            fontFamily: "monospace", fontSize: 12,
            cursor: "pointer", width: "100%",
            boxShadow: saved ? "0 0 14px rgba(126,204,73,0.25)" : "none",
            transition: "all 0.2s",
            opacity: !bot ? 0.4 : 1,
          }}>
          {saved ? "✅ Настройки сохранены!" : "💾 Сохранить настройки PVP"}
        </button>

      </div>
    </div>
  );
}
