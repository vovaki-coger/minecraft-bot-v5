import React, { useState, useEffect } from "react";
import { useAppStore } from "../../store/appStore";

const POTION_TYPES = [
  { id: "healing",      label: "❤️ Лечение",      color: "#e74c3c" },
  { id: "regeneration", label: "💚 Регенерация",   color: "#2ecc71" },
  { id: "strength",     label: "💪 Сила",          color: "#8e44ad" },
  { id: "speed",        label: "⚡ Скорость",      color: "#3498db" },
  { id: "poison",       label: "☠️ Яд (дебаф)",    color: "#27ae60" },
  { id: "weakness",     label: "💔 Слабость (деб.)",color: "#7f8c8d" },
  { id: "slowness",     label: "🐌 Медлительность", color: "#566573" },
  { id: "blindness",    label: "🕶 Слепота (деб.)", color: "#212121" },
  { id: "instant_damage", label: "💥 Вред (дебаф)", color: "#e74c3c" },
];

interface CustomPotion {
  id: string;
  name: string;
  type: "buff" | "debuff";
  potionType: string;
  splash: boolean;
}

// ── Серверные профили ────────────────────────────────────────────────────────
interface ServerProfile {
  id: string;
  label: string;
  emoji: string;
  desc: string;
  serverMode: "legacy" | "modern";
  gappleCooldown: number;   // сек
  pearlCooldown: number;    // сек
  potionCooldown: number;   // сек
  attackRange: number;
  color: string;
}

const SERVER_PROFILES: ServerProfile[] = [
  {
    id: "SpookyTime",
    label: "SpookyTime",
    emoji: "🎃",
    desc: "1.8 PVP, без кулдауна атаки",
    serverMode: "legacy",
    gappleCooldown: 0,
    pearlCooldown: 10,
    potionCooldown: 0,
    attackRange: 4.5,
    color: "#e67e22",
  },
  {
    id: "FunTime",
    label: "FunTime",
    emoji: "🎮",
    desc: "1.8 PVP, кулдаун гэпл 30 сек",
    serverMode: "legacy",
    gappleCooldown: 30,
    pearlCooldown: 16,
    potionCooldown: 0,
    attackRange: 4.5,
    color: "#3498db",
  },
  {
    id: "RealWorld",
    label: "RealWorld",
    emoji: "🌍",
    desc: "1.8 PVP, кулдаун гэпл 120 сек",
    serverMode: "legacy",
    gappleCooldown: 120,
    pearlCooldown: 20,
    potionCooldown: 0,
    attackRange: 4.5,
    color: "#7ecc49",
  },
  {
    id: "custom",
    label: "Своё",
    emoji: "⚙️",
    desc: "Ручная настройка параметров",
    serverMode: "legacy",
    gappleCooldown: 120,
    pearlCooldown: 16,
    potionCooldown: 0,
    attackRange: 4.0,
    color: "#9b59b6",
  },
];

export default function PvpTab() {
  const { bots, selectedBotId } = useAppStore();
  const bot = bots.find(b => b.id === selectedBotId) || null;

  const [teammates, setTeammates] = useState<string[]>([]);
  const [teammateInput, setTeammateInput] = useState("");
  const [customPotions, setCustomPotions] = useState<CustomPotion[]>([]);
  const [showPotionForm, setShowPotionForm] = useState(false);
  const [newPotion, setNewPotion] = useState<Partial<CustomPotion>>({
    type: "buff", potionType: "healing", splash: true,
  });
  const [autoTarget, setAutoTarget] = useState(true);
  const [attackRange, setAttackRange] = useState(4);
  const [pvpActive, setPvpActive] = useState(false);
  const [saved, setSaved] = useState(false);

  // Серверный профиль
  const [serverProfile, setServerProfile] = useState<string>("custom");
  const [serverMode, setServerMode] = useState<"legacy" | "modern">("legacy");
  const [gappleCooldown, setGappleCooldown] = useState(120);
  const [pearlCooldown, setPearlCooldown] = useState(16);

  const activeProfile = SERVER_PROFILES.find(p => p.id === serverProfile) || SERVER_PROFILES[3];

  useEffect(() => {
    if (bot) {
      const cfg = bot.config as any;
      setTeammates(cfg.teammates || []);
      setCustomPotions(cfg.pvpCustomPotions || []);
      setAutoTarget(cfg.pvpAutoTarget !== false);
      setAttackRange(cfg.pvpAttackRange || 4);
      setPvpActive((bot as any).pvpMode || false);
      setServerProfile(cfg.pvpServerProfile || "custom");
      setServerMode(cfg.pvpServerMode || "legacy");
      setGappleCooldown(cfg.pvpGappleCooldown ?? 120);
      setPearlCooldown(cfg.pvpPearlCooldown ?? 16);
    }
  }, [bot?.id]);

  function applyProfile(profile: ServerProfile) {
    setServerProfile(profile.id);
    setServerMode(profile.serverMode);
    setGappleCooldown(profile.gappleCooldown);
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
    const pt = POTION_TYPES.find(p => p.id === newPotion.potionType);
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
    await (window as any).electronAPI.bot.updateConfig(bot.id, {
      teammates,
      pvpCustomPotions: customPotions,
      pvpAutoTarget: autoTarget,
      pvpAttackRange: attackRange,
      pvpServerProfile: serverProfile,
      pvpServerMode: serverMode,
      pvpGappleCooldown: gappleCooldown,
      pvpPearlCooldown: pearlCooldown,
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
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
        serverMode,
        serverProfile,
        gappleCooldown,
        pearlCooldown,
      });
      setPvpActive(true);
    }
  }

  const sectionCls: React.CSSProperties = {
    background: "rgba(14,18,26,0.9)",
    border: "1px solid rgba(55,65,88,0.7)",
    borderRadius: 8,
    padding: 14,
    backdropFilter: "blur(8px)",
    boxShadow: "0 0 20px rgba(0,0,0,0.3)",
  };

  const labelCls: React.CSSProperties = {
    color: "#e74c3c",
    fontSize: 11.5,
    fontFamily: "monospace",
    fontWeight: "bold",
    marginBottom: 10,
    display: "flex",
    alignItems: "center",
    gap: 6,
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
          ⚔️ PVP-нейросеть
        </span>
        {bot && (
          <span className="text-xs font-mono" style={{ color: pvpActive ? "#e74c3c" : "#555" }}>
            {pvpActive ? `● ${serverMode === "legacy" ? "1.8 CPS" : "1.9 CD"}` : "○ неактивен"}
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
            boxShadow: pvpActive ? `0 0 15px rgba(231,76,60,0.3)` : "none",
            transition: "all 0.2s",
            opacity: (!bot || bot.status !== "online") ? 0.4 : 1,
          }}>
          {pvpActive ? "⏹ ОСТАНОВИТЬ PVP" : "▶ ЗАПУСТИТЬ PVP-НЕЙРОСЕТЬ"}
        </button>

        {/* ── СЕРВЕРНЫЙ ПРОФИЛЬ ──────────────────────────────────────── */}
        <div style={sectionCls}>
          <div style={labelCls}>🌐 Сервер / Профиль</div>
          <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 10 }}>
            {SERVER_PROFILES.map(profile => (
              <button
                key={profile.id}
                onClick={() => applyProfile(profile)}
                style={{
                  flex: "1 1 auto", minWidth: 70,
                  padding: "7px 6px", borderRadius: 5,
                  border: `1px solid ${serverProfile === profile.id ? profile.color : "rgba(55,65,88,0.6)"}`,
                  background: serverProfile === profile.id ? `${profile.color}18` : "rgba(14,18,26,0.6)",
                  color: serverProfile === profile.id ? profile.color : "#666",
                  fontFamily: "monospace", fontSize: 10,
                  cursor: "pointer", transition: "all 0.15s",
                  fontWeight: serverProfile === profile.id ? "bold" : "normal",
                }}>
                <div style={{ fontSize: 14 }}>{profile.emoji}</div>
                <div>{profile.label}</div>
              </button>
            ))}
          </div>
          <div style={{ fontSize: 10, color: "#555", fontFamily: "monospace", marginBottom: 10 }}>
            {activeProfile.desc}
          </div>

          {/* Режим атаки */}
          <div style={{ marginBottom: 10 }}>
            <div style={{ color: "#666", fontSize: 10, marginBottom: 5 }}>Режим атаки:</div>
            <div style={{ display: "flex", gap: 5 }}>
              {(["legacy", "modern"] as const).map(mode => (
                <button
                  key={mode}
                  onClick={() => setServerMode(mode)}
                  style={{
                    flex: 1, padding: "6px 0", borderRadius: 4,
                    border: `1px solid ${serverMode === mode ? "#e74c3c" : "#333"}`,
                    background: serverMode === mode ? "rgba(231,76,60,0.12)" : "transparent",
                    color: serverMode === mode ? "#e74c3c" : "#555",
                    fontFamily: "monospace", fontSize: 10, cursor: "pointer",
                  }}>
                  {mode === "legacy" ? "⚡ 1.8 CPS (8-12/сек)" : "⏱ 1.9 Cooldown"}
                </button>
              ))}
            </div>
          </div>

          {/* Кулдауны */}
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div>
              <div style={{ color: "#666", fontSize: 10, marginBottom: 3, display: "flex", justifyContent: "space-between" }}>
                <span>🍎 Enchanted Gapple КД:</span>
                <span style={{ color: "#e74c3c" }}>{gappleCooldown === 0 ? "нет" : gappleCooldown + " сек"}</span>
              </div>
              <input type="range" min={0} max={300} step={5} value={gappleCooldown}
                onChange={e => setGappleCooldown(+e.target.value)}
                style={{ width: "100%", accentColor: "#e74c3c" }} />
              <div style={{ color: "#444", fontSize: 9, marginTop: 2 }}>
                Примеры: SpookyTime=нет, FunTime=30с, RealWorld=120с, ванилла=120с
              </div>
            </div>
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
              <div style={{ color: "#666", fontSize: 10, marginBottom: 4 }}>Дальность атаки: <span style={{ color: "#e74c3c" }}>{attackRange} блоков</span></div>
              <input type="range" min={2} max={6} step={0.5} value={attackRange}
                onChange={e => setAttackRange(parseFloat(e.target.value))}
                style={{ width: "100%", accentColor: "#e74c3c" }} />
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
                  <span>👤</span>
                  <span>{nick}</span>
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

          {/* Инфо о приоритете еды */}
          <div style={{ background: "rgba(230,126,34,0.06)", border: "1px solid rgba(230,126,34,0.2)", borderRadius: 5, padding: "8px 10px", marginBottom: 8, fontSize: 10, fontFamily: "monospace" }}>
            <div style={{ color: "#e67e22", marginBottom: 4 }}>🍖 Приоритет еды (авто):</div>
            <div style={{ color: "#666", lineHeight: 1.6 }}>
              🥕 Золотая морковь → 🥩 Стейк/Свинина →<br />
              🍗 Курица → 🍞 Хлеб → 🍎 Яблоко →<br />
              🍏 Обычный гэпл →{" "}
              <span style={{ color: "#f39c12" }}>✨ Enchanted Golden Apple</span>
              <span style={{ color: "#e74c3c" }}> (только HP ≤ 2❤, КД готов!)</span>
            </div>
          </div>

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
                      <span style={{ color: "#555", fontSize: 9 }}>{pot.splash ? "Сплэш" : "Питьевое"} · {pot.type === "buff" ? "баф (на себя)" : "дебаф (на врага)"}</span>
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

        {/* ── СТАТУС НЕЙРОСЕТИ ───────────────────────────────────────── */}
        <div style={{ ...sectionCls, borderColor: "rgba(126,204,73,0.2)" }}>
          <div style={{ color: "#7ecc49", fontSize: 11.5, fontFamily: "monospace", fontWeight: "bold", marginBottom: 8, textShadow: "0 0 8px rgba(126,204,73,0.3)" }}>
            🧠 О нейросети
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: 10.5, color: "#666", fontFamily: "monospace" }}>
            <div style={{ color: "#888" }}>Архитектура: <span style={{ color: "#7ecc49" }}>12→24→18→12→7</span></div>
            <div style={{ color: "#888" }}>Сценариев обучения: <span style={{ color: "#aaa" }}>1027</span></div>
            <div style={{ color: "#888" }}>Режим: <span style={{ color: "#e74c3c" }}>{serverMode === "legacy" ? "Legacy 1.8 (8-12 CPS)" : "Modern 1.9+ (cooldown)"}</span></div>
            <div style={{ borderTop: "1px solid #222", paddingTop: 5, marginTop: 3 }}>
              {[
                ["⚔️ attack",      "Ударить цель (мгновенно в 1.8)"],
                ["🏃 retreat",     "Отступить от опасности"],
                ["🍖 eat",         "Съесть морковь/мясо (НЕ гэпл)"],
                ["❤️ throwHeal",   "Сплэш хилки под себя"],
                ["💥 throwPotion", "Сплэш яд/слабость на врага"],
                ["✨ throwPerk",   "Зелье силы/скорости на себя"],
                ["🌀 strafe",      "Стрейф вокруг цели"],
              ].map(([act, desc]) => (
                <div key={act} style={{ display: "flex", gap: 8, color: "#555", marginBottom: 2 }}>
                  <span style={{ color: "#7ecc49", minWidth: 90 }}>{act}</span>
                  <span>{desc}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ── СОХРАНИТЬ ──────────────────────────────────────────────── */}
        <button
          onClick={handleSave}
          disabled={!bot}
          style={{
            padding: "8px 0", borderRadius: 6,
            border: "1px solid rgba(126,204,73,0.5)",
            background: "rgba(126,204,73,0.08)",
            color: saved ? "#7ecc49" : "#6ab04c",
            fontFamily: "monospace", fontSize: 12,
            cursor: "pointer", width: "100%",
            boxShadow: saved ? "0 0 12px rgba(126,204,73,0.2)" : "none",
            transition: "all 0.2s",
          }}>
          {saved ? "✅ Настройки PVP сохранены!" : "💾 Сохранить настройки PVP"}
        </button>

      </div>
    </div>
  );
}
