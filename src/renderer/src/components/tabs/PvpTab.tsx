import React, { useState, useEffect } from "react";
import { useAppStore } from "../../store/appStore";

const MINECRAFT_ITEMS = [
  "diamond_sword","iron_sword","stone_sword","wooden_sword","netherite_sword",
  "bow","crossbow","trident","mace",
  "splash_potion","lingering_potion","potion",
  "golden_apple","enchanted_golden_apple",
  "ender_pearl","fireball","snowball",
  "tnt","respawn_anchor",
  "shield","totem_of_undying",
  "cooked_beef","cooked_porkchop","cooked_chicken","bread","apple",
  "iron_axe","diamond_axe","netherite_axe",
  "flint_and_steel","lava_bucket","water_bucket",
];

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

  useEffect(() => {
    if (bot) {
      const cfg = bot.config as any;
      setTeammates(cfg.teammates || []);
      setCustomPotions(cfg.pvpCustomPotions || []);
      setAutoTarget(cfg.pvpAutoTarget !== false);
      setAttackRange(cfg.pvpAttackRange || 4);
      setPvpActive((bot as any).pvpMode || false);
    }
  }, [bot?.id]);

  function addTeammate() {
    const n = teammateInput.trim();
    if (!n || teammates.includes(n)) return;
    setTeammates(p => [...p, n]);
    setTeammateInput("");
  }

  function addPotion() {
    if (!newPotion.potionType) return;
    const pt = POTION_TYPES.find(p => p.id === newPotion.potionType);
    const isDebuff = newPotion.potionType === "poison" || newPotion.potionType === "weakness" || newPotion.potionType === "slowness" || newPotion.potionType === "blindness" || newPotion.potionType === "instant_damage";
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
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    background: "rgba(231,76,60,0.1)",
    border: "1px solid rgba(231,76,60,0.4)",
    borderRadius: 4,
    padding: "3px 9px",
    fontSize: 10.5,
    color: "#e67e7e",
    fontFamily: "monospace",
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
            {pvpActive ? "● АКТИВЕН" : "○ неактивен"}
          </span>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-3">

        {/* ── КНОПКА ЗАПУСКА ─────────────────────────────────────────── */}
        <button
          onClick={handleTogglePvp}
          disabled={!bot || bot.status !== "online"}
          style={{
            width: "100%",
            padding: "10px 0",
            borderRadius: 6,
            border: `1px solid ${pvpColor}`,
            background: pvpActive
              ? "rgba(231,76,60,0.15)"
              : "rgba(155,89,182,0.12)",
            color: pvpColor,
            fontFamily: "monospace",
            fontSize: 12,
            cursor: "pointer",
            fontWeight: "bold",
            letterSpacing: "0.05em",
            boxShadow: pvpActive ? `0 0 15px rgba(231,76,60,0.3)` : "none",
            transition: "all 0.2s",
            opacity: (!bot || bot.status !== "online") ? 0.4 : 1,
          }}
        >
          {pvpActive ? "⏹ ОСТАНОВИТЬ PVP" : "▶ ЗАПУСТИТЬ PVP-НЕЙРОСЕТЬ"}
        </button>

        {/* ── ПАРАМЕТРЫ ──────────────────────────────────────────────── */}
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
            <button
              onClick={addTeammate}
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

        {/* ── КАСТОМ ЗЕЛЬЯ ───────────────────────────────────────────── */}
        <div style={sectionCls}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
            <div style={labelCls}>🧪 Зелья нейросети</div>
            <button
              onClick={() => setShowPotionForm(v => !v)}
              style={{ padding: "3px 10px", borderRadius: 4, border: "1px solid rgba(52,152,219,0.5)", background: "rgba(52,152,219,0.1)", color: "#5dade2", cursor: "pointer", fontSize: 11, fontFamily: "monospace" }}>
              {showPotionForm ? "✕ Закрыть" : "+ Добавить"}
            </button>
          </div>

          {showPotionForm && (
            <div style={{ background: "rgba(8,10,16,0.8)", border: "1px solid rgba(52,152,219,0.3)", borderRadius: 6, padding: 12, marginBottom: 10 }}>
              <div style={{ color: "#5dade2", fontSize: 11, fontFamily: "monospace", marginBottom: 8 }}>Новое зелье</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <div>
                  <div style={{ color: "#555", fontSize: 10, marginBottom: 3 }}>Тип зелья:</div>
                  <select
                    value={newPotion.potionType}
                    onChange={e => setNewPotion(p => ({ ...p, potionType: e.target.value }))}
                    style={{ width: "100%", background: "rgba(8,10,16,0.9)", color: "#ccc", border: "1px solid #2a3040", borderRadius: 4, padding: "5px 8px", fontFamily: "monospace", fontSize: 11 }}>
                    {POTION_TYPES.map(pt => (
                      <option key={pt.id} value={pt.id}>{pt.label}</option>
                    ))}
                  </select>
                </div>
                <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                  <input type="checkbox" checked={!!newPotion.splash} onChange={e => setNewPotion(p => ({ ...p, splash: e.target.checked }))}
                    style={{ accentColor: "#5dade2" }} />
                  <span style={{ color: "#bbb", fontSize: 11 }}>Сплэш (бросить)</span>
                </label>
                <div style={{ display: "flex", gap: 2 }}>
                  {["buff", "debuff"].map(t => (
                    <button
                      key={t}
                      onClick={() => setNewPotion(p => ({ ...p, type: t as any }))}
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
                    background: "rgba(20,24,32,0.8)", border: `1px solid ${pot.type === "buff" ? "rgba(126,204,73,0.3)" : "rgba(231,76,60,0.3)"}`,
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
            <div style={{ color: "#444", fontSize: 10, fontStyle: "italic" }}>
              Зелья не настроены — нейросеть использует стандартные
            </div>
          )}
        </div>

        {/* ── СТАТУС НЕЙРОСЕТИ ───────────────────────────────────────── */}
        <div style={{ ...sectionCls, borderColor: "rgba(126,204,73,0.2)" }}>
          <div style={{ color: "#7ecc49", fontSize: 11.5, fontFamily: "monospace", fontWeight: "bold", marginBottom: 8, textShadow: "0 0 8px rgba(126,204,73,0.3)" }}>
            🧠 О нейросети
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: 10.5, color: "#666", fontFamily: "monospace" }}>
            <div style={{ color: "#888" }}>Архитектура: <span style={{ color: "#7ecc49" }}>brain.js (12→16→12→7)</span></div>
            <div style={{ color: "#888" }}>Входов: <span style={{ color: "#aaa" }}>12 признаков боя</span></div>
            <div style={{ color: "#888" }}>Выходов: <span style={{ color: "#aaa" }}>7 действий</span></div>
            <div style={{ color: "#888" }}>Обучение: <span style={{ color: "#aaa" }}>онлайн (из реального боя)</span></div>
            <div style={{ borderTop: "1px solid #222", paddingTop: 5, marginTop: 3 }}>
              <div style={{ color: "#555" }}>Действия нейросети:</div>
              <div style={{ marginTop: 4, display: "flex", flexDirection: "column", gap: 2 }}>
                {[
                  ["⚔️ attack",      "Ударить цель (1.9 PVP кулдаун)"],
                  ["🏃 retreat",     "Отступить от опасности"],
                  ["🍖 eat",         "Съесть еду при голоде"],
                  ["❤️ throwHeal",   "Бросить хил-зелье под себя"],
                  ["💥 throwPotion", "Бросить зелье на врага"],
                  ["✨ throwPerk",   "Применить перк (сила/скорость)"],
                  ["🌀 strafe",      "Стрейф по кругу вокруг цели"],
                ].map(([act, desc]) => (
                  <div key={act} style={{ display: "flex", gap: 8, color: "#555" }}>
                    <span style={{ color: "#7ecc49", minWidth: 90 }}>{act}</span>
                    <span>{desc}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* ── КНОПКА СОХРАНИТЬ ───────────────────────────────────────── */}
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
