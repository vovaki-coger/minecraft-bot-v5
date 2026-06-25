import React, { useState, useEffect, useRef } from "react";
import { useAppStore } from "../../store/appStore";

const PHASE_LABELS: Record<string, string> = {
  idle:         "Ожидание",
  task:         "Выполняю задачу",
  going_home:   "Иду домой",
  depositing:   "Сдаю ресурсы",
  resuming:     "Возобновляю",
  brewing:      "Варю зелья",
};

const PHASE_COLOR: Record<string, string> = {
  idle:         "#555",
  task:         "#2ec4b6",
  going_home:   "#f39c12",
  depositing:   "#e67e22",
  resuming:     "#7ecc49",
  brewing:      "#9b59b6",
};

interface TaskPreset {
  id: string;
  label: string;
  desc: string;
  task: string;
}

const TASK_PRESETS: TaskPreset[] = [
  { id: "wood",        label: "Рубить дерево",          desc: "Собирает брёвна в радиусе 64 блоков",    task: "Рубить дерево 32" },
  { id: "stone",       label: "Добывать камень",         desc: "Добывает булыжник и руду",               task: "Добывать камень 64" },
  { id: "food",        label: "Охота / Еда",             desc: "Охотится на животных, собирает еду",     task: "Охотиться еда" },
  { id: "farm_wheat",  label: "Ферма пшеницы",           desc: "Засевает и собирает пшеницу (r=15)",     task: "Фармить пшеница" },
  { id: "farm_carrot", label: "Ферма моркови",           desc: "Засевает и собирает морковь (r=15)",     task: "Фармить морковь" },
  { id: "farm_potato", label: "Ферма картофеля",         desc: "Засевает и собирает картофель (r=15)",   task: "Фармить картофель" },
  { id: "farm_quick",  label: "Быстрый фарм (боне-мил)", desc: "Delta-стиль: костная мука на 3x3 зоне", task: "Быстрый фарм боне" },
  { id: "explore",     label: "Исследование",            desc: "Бродит по миру, исследует новые чанки", task: "Исследовать территорию" },
  { id: "brew_potions",label: "Зельеварение",            desc: "Варит зелья анархии (Сила, Скорость...)",task: "brew_potions" },
];

// ── Зелья анархии (топ-список) ──────────────────────────────────────────────
interface PotionOption {
  id: string;
  label: string;
  emoji: string;
  ingredients: string[];
}

const POTION_OPTIONS: PotionOption[] = [
  {
    id: "strength_1",
    label: "Сила I (3 мин)",
    emoji: "⚔️",
    ingredients: ["Стержень визера (топливо)", "Адский гриб × 3 (основа)", "Пыль визера × 3"],
  },
  {
    id: "strength_2",
    label: "Сила II (1.5 мин)",
    emoji: "⚔️",
    ingredients: ["Стержень визера (топливо)", "Адский гриб × 3 (основа)", "Пыль визера × 3", "Светокаменная пыль × 3"],
  },
  {
    id: "speed_1",
    label: "Скорость I (3 мин)",
    emoji: "🏃",
    ingredients: ["Стержень визера (топливо)", "Адский гриб × 3 (основа)", "Сахар × 3"],
  },
  {
    id: "speed_2",
    label: "Скорость II (1.5 мин)",
    emoji: "🏃",
    ingredients: ["Стержень визера (топливо)", "Адский гриб × 3 (основа)", "Сахар × 3", "Светокаменная пыль × 3"],
  },
  {
    id: "fire_resistance",
    label: "Огнестойкость (4 мин)",
    emoji: "🔥",
    ingredients: ["Стержень визера (топливо)", "Адский гриб × 3 (основа)", "Магматический крем × 3"],
  },
  {
    id: "invisibility",
    label: "Невидимость (3 мин)",
    emoji: "👁️",
    ingredients: ["Стержень визера (топливо)", "Адский гриб × 3 (основа)", "Золотая морковь × 3", "Паучий глаз (фермент.) × 3"],
  },
  {
    id: "leaping_1",
    label: "Прыжок I (3 мин)",
    emoji: "🐇",
    ingredients: ["Стержень визера (топливо)", "Адский гриб × 3 (основа)", "Кроличья лапка × 3"],
  },
  {
    id: "leaping_2",
    label: "Прыжок II (1.5 мин)",
    emoji: "🐇",
    ingredients: ["Стержень визера (топливо)", "Адский гриб × 3 (основа)", "Кроличья лапка × 3", "Светокаменная пыль × 3"],
  },
  {
    id: "water_breathing",
    label: "Водное дыхание (4 мин)",
    emoji: "🐟",
    ingredients: ["Стержень визера (топливо)", "Адский гриб × 3 (основа)", "Рыба-шар × 3"],
  },
  {
    id: "night_vision",
    label: "Ночное зрение (4 мин)",
    emoji: "🌙",
    ingredients: ["Стержень визера (топливо)", "Адский гриб × 3 (основа)", "Золотая морковь × 3"],
  },
  {
    id: "regeneration_1",
    label: "Регенерация I (45 сек)",
    emoji: "💚",
    ingredients: ["Стержень визера (топливо)", "Адский гриб × 3 (основа)", "Слеза гаста × 3"],
  },
  {
    id: "regeneration_2",
    label: "Регенерация II (22 сек)",
    emoji: "💚",
    ingredients: ["Стержень визера (топливо)", "Адский гриб × 3 (основа)", "Слеза гаста × 3", "Светокаменная пыль × 3"],
  },
  {
    id: "healing_1",
    label: "Лечение I (мгновенное)",
    emoji: "❤️",
    ingredients: ["Стержень визера (топливо)", "Адский гриб × 3 (основа)", "Блестящая дыня × 3"],
  },
  {
    id: "healing_2",
    label: "Лечение II (мгновенное)",
    emoji: "❤️",
    ingredients: ["Стержень визера (топливо)", "Адский гриб × 3 (основа)", "Блестящая дыня × 3", "Светокаменная пыль × 3"],
  },
  {
    id: "poison_1",
    label: "Отравление I (45 сек)",
    emoji: "☠️",
    ingredients: ["Стержень визера (топливо)", "Адский гриб × 3 (основа)", "Паучий глаз × 3"],
  },
  {
    id: "slowness",
    label: "Замедление (1.5 мин)",
    emoji: "🐢",
    ingredients: ["Стержень визера (топливо)", "Адский гриб × 3 (основа)", "Сахар × 3", "Паучий глаз (фермент.) × 3"],
  },
];

interface AnarchyState {
  isRunning: boolean;
  task: string;
  homeCommand: string;
  phase: string;
  cycleCount: number;
  log: { msg: string; time: number }[];
}

export default function AnarchyTab() {
  const { bots, selectedBotId } = useAppStore();
  const bot = bots.find(b => b.id === selectedBotId) || bots[0] || null;

  const [selectedTask, setSelectedTask] = useState("wood");
  const [homeCmd, setHomeCmd] = useState("/home");
  const [rtpCmd, setRtpCmd] = useState("");
  const [cycleMin, setCycleMin] = useState(5);
  const [maxInv, setMaxInv] = useState(28);
  const [state, setState] = useState<AnarchyState | null>(null);
  const [log, setLog] = useState<{ msg: string; time: number }[]>([]);
  const logRef = useRef<HTMLDivElement>(null);

  // Brewing options
  const [selectedPotion, setSelectedPotion] = useState("strength_1");
  const [wantSplash, setWantSplash] = useState(false);
  const [wantLong, setWantLong] = useState(false);

  const isBrewing = selectedTask === "brew_potions";
  const currentPotion = POTION_OPTIONS.find(p => p.id === selectedPotion) || POTION_OPTIONS[0];

  useEffect(() => {
    if (!window.electronAPI) return;
    const unsubs = [
      window.electronAPI.on("bot:anarchyStarted", (data: any) => {
        if (data.botId !== bot?.id) return;
        setState(s => ({ ...s!, isRunning: true, phase: isBrewing ? "brewing" : "task", cycleCount: 0 } as AnarchyState));
      }),
      window.electronAPI.on("bot:anarchyStopped", (data: any) => {
        if (data.botId !== bot?.id) return;
        setState(s => s ? { ...s, isRunning: false, phase: "idle" } : null);
      }),
      window.electronAPI.on("bot:anarchyPhase", (data: any) => {
        if (data.botId !== bot?.id) return;
        setState(s => s ? { ...s, phase: data.phase } : null);
      }),
      window.electronAPI.on("bot:anarchyLog", (data: any) => {
        if (data.botId !== bot?.id) return;
        setLog(prev => [...prev.slice(-99), { msg: data.msg, time: data.time }]);
      }),
    ];
    return () => { unsubs.forEach(fn => fn && fn()); };
  }, [bot?.id, isBrewing]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: 9999, behavior: "smooth" });
  }, [log]);

  useEffect(() => {
    if (!bot?.id || !window.electronAPI?.bot?.getAnarchyState) return;
    (window.electronAPI.bot as any).getAnarchyState(bot.id).then((s: AnarchyState) => {
      if (s) { setState(s); setLog(s.log || []); }
    }).catch(() => {});
  }, [bot?.id]);

  async function startAnarchy() {
    if (!bot?.id) return;

    if (isBrewing) {
      await (window.electronAPI?.bot as any).startAnarchy(bot.id, {
        task: "brew_potions",
        potionId: selectedPotion,
        wantSplash,
        wantLong,
        homeCommand: homeCmd,
      });
      return;
    }

    const preset = TASK_PRESETS.find(p => p.id === selectedTask) || TASK_PRESETS[0];
    await (window.electronAPI?.bot as any).startAnarchy(bot.id, {
      task: preset.task,
      homeCommand: homeCmd,
      rtpCommand: rtpCmd,
      cycleMinutes: cycleMin,
      maxInventory: maxInv,
    });
  }

  async function stopAnarchy() {
    if (!bot?.id) return;
    await (window.electronAPI?.bot as any).stopAnarchy(bot.id);
  }

  const isRunning = state?.isRunning ?? false;
  const phase = state?.phase ?? "idle";
  const phaseColor = PHASE_COLOR[phase] ?? "#555";

  function fmtTime(ts: number) {
    const d = new Date(ts);
    return String(d.getHours()).padStart(2,"0") + ":" + String(d.getMinutes()).padStart(2,"0") + ":" + String(d.getSeconds()).padStart(2,"0");
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="px-3 py-2 border-b flex items-center justify-between flex-shrink-0"
        style={{ borderColor: "#1a3a3a", background: "#141f1f" }}>
        <span className="text-xs font-mono font-bold" style={{ color: "#e74c3c" }}>
          Протокол Анархии
        </span>
        {isRunning && (
          <div className="flex items-center gap-2">
            <span style={{
              width: 8, height: 8, borderRadius: "50%",
              background: phaseColor, display: "inline-block",
              boxShadow: "0 0 6px " + phaseColor,
            }} />
            <span className="text-xs font-mono" style={{ color: phaseColor }}>
              {PHASE_LABELS[phase] ?? phase}
            </span>
            <span className="text-xs" style={{ color: "#555" }}>#{state?.cycleCount ?? 0}</span>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-3">

        {!bot && (
          <div className="panel p-3 text-center text-xs" style={{ color: "#555" }}>
            Выберите бота на вкладке "Боты"
          </div>
        )}

        {/* Task presets */}
        <div className="panel p-3" style={{ background: "#0f1a1a", border: "1px solid #1a3a3a" }}>
          <div className="text-xs font-mono mb-2" style={{ color: "#e74c3c" }}>Задача (скриптовая, без ИИ)</div>
          <div className="flex flex-col gap-1">
            {TASK_PRESETS.map(preset => {
              const isActive = selectedTask === preset.id;
              const isBrew = preset.id === "brew_potions";
              return (
                <button
                  key={preset.id}
                  onClick={() => !isRunning && setSelectedTask(preset.id)}
                  disabled={isRunning}
                  className="text-left px-3 py-2 rounded transition-all"
                  style={{
                    background: isActive ? (isBrew ? "rgba(155,89,182,0.15)" : "rgba(231,76,60,0.12)") : "transparent",
                    border: "1px solid " + (isActive ? (isBrew ? "#8e44ad" : "#c0392b") : "#1a3a3a"),
                    color: isRunning ? "#444" : (isActive ? (isBrew ? "#cc88ff" : "#ff6b6b") : "#888"),
                    cursor: isRunning ? "default" : "pointer",
                    fontSize: 11,
                  }}
                >
                  <div className="font-mono font-bold" style={{ color: isRunning ? "#444" : (isActive ? (isBrew ? "#cc88ff" : "#ff8080") : "#ccc") }}>
                    {isBrew ? "🧪 " : ""}{preset.label}
                  </div>
                  <div style={{ color: "#555", fontSize: 10 }}>{preset.desc}</div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Brewing options — показываем только при выборе brew_potions */}
        {isBrewing && (
          <div className="panel p-3 flex flex-col gap-2" style={{ background: "#110d1a", border: "1px solid #3d1f5a" }}>
            <div className="text-xs font-mono mb-1" style={{ color: "#cc88ff" }}>🧪 Настройки зельеварения</div>

            {/* Выбор зелья */}
            <div>
              <label className="text-xs mb-1 block" style={{ color: "#aaa" }}>Зелье:</label>
              <select
                value={selectedPotion}
                onChange={e => setSelectedPotion(e.target.value)}
                disabled={isRunning}
                className="w-full text-xs p-2 rounded"
                style={{
                  background: "#1a1a2a",
                  border: "1px solid #3d1f5a",
                  color: isRunning ? "#555" : "#e8e8e8",
                  fontFamily: "monospace",
                  outline: "none",
                }}
              >
                {POTION_OPTIONS.map(p => (
                  <option key={p.id} value={p.id}>{p.emoji} {p.label}</option>
                ))}
              </select>
            </div>

            {/* Варианты */}
            <div className="flex gap-3">
              <label className="flex items-center gap-1.5 cursor-pointer select-none" style={{ opacity: isRunning ? 0.4 : 1 }}>
                <input
                  type="checkbox"
                  checked={wantSplash}
                  onChange={e => !isRunning && setWantSplash(e.target.checked)}
                  disabled={isRunning}
                  style={{ accentColor: "#9b59b6" }}
                />
                <span className="text-xs" style={{ color: "#cc88ff" }}>Сплеш (бросаемое)</span>
              </label>
              <label className="flex items-center gap-1.5 cursor-pointer select-none" style={{ opacity: isRunning ? 0.4 : 1 }}>
                <input
                  type="checkbox"
                  checked={wantLong}
                  onChange={e => !isRunning && setWantLong(e.target.checked)}
                  disabled={isRunning}
                  style={{ accentColor: "#3498db" }}
                />
                <span className="text-xs" style={{ color: "#5dade2" }}>Redstone (8 мин, по желанию)</span>
              </label>
            </div>

            {/* Список ингредиентов */}
            <div style={{ background: "#0d0d1a", border: "1px solid #2a1a3a", borderRadius: 4, padding: "8px 10px" }}>
              <div className="text-xs mb-1.5 font-mono" style={{ color: "#888" }}>Что нужно в инвентаре / сундуке:</div>
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
                    <span>Порох × 3 (для Сплеш-версии)</span>
                  </div>
                )}
                {wantLong && (
                  <div className="text-xs flex items-start gap-1" style={{ color: "#5dade2" }}>
                    <span style={{ color: "#3498db", flexShrink: 0 }}>•</span>
                    <span>Красный камень × 3 (необязательно, если есть — варит 8 мин)</span>
                  </div>
                )}
                <div className="text-xs flex items-start gap-1 mt-1" style={{ color: "#666" }}>
                  <span style={{ color: "#555", flexShrink: 0 }}>•</span>
                  <span>Стеклянные флаконы × 3 (Glass Bottle)</span>
                </div>
              </div>
            </div>

            <div className="text-xs" style={{ color: "#555" }}>
              Бот сам найдёт стойку и сундук в радиусе 32 блоков
            </div>
          </div>
        )}

        {/* Config — скрываем для brewing (ненужные поля) */}
        {!isBrewing && (
          <div className="panel p-3" style={{ background: "#0f1a1a", border: "1px solid #1a3a3a" }}>
            <div className="text-xs font-mono mb-2" style={{ color: "#e74c3c" }}>Конфигурация</div>
            <div className="flex flex-col gap-2">
              <div className="flex gap-2">
                <div className="flex-1">
                  <label className="text-xs mb-1 block" style={{ color: "#888" }}>Команда домой:</label>
                  <input type="text" value={homeCmd} onChange={e => setHomeCmd(e.target.value)}
                    disabled={isRunning} className="w-full text-xs p-2 rounded"
                    style={{ background: "#1a1a1a", border: "1px solid #1a3a3a", color: isRunning ? "#555" : "#e8e8e8", fontFamily: "monospace", outline: "none" }}
                    placeholder="/home" />
                </div>
                <div className="flex-1">
                  <label className="text-xs mb-1 block" style={{ color: "#888" }}>RTP-команда:</label>
                  <input type="text" value={rtpCmd} onChange={e => setRtpCmd(e.target.value)}
                    disabled={isRunning} className="w-full text-xs p-2 rounded"
                    style={{ background: "#1a1a1a", border: "1px solid #1a3a3a", color: isRunning ? "#555" : "#e8e8e8", fontFamily: "monospace", outline: "none" }}
                    placeholder="/rtp, /wild..." />
                </div>
              </div>
              <div className="flex gap-2">
                <div className="flex-1">
                  <label className="text-xs mb-1 block" style={{ color: "#888" }}>Цикл (мин):</label>
                  <input type="number" value={cycleMin}
                    onChange={e => setCycleMin(Math.max(1, parseInt(e.target.value) || 5))}
                    disabled={isRunning} min={1} max={60} className="w-full text-xs p-2 rounded text-center"
                    style={{ background: "#1a1a1a", border: "1px solid #1a3a3a", color: isRunning ? "#555" : "#e8e8e8", outline: "none" }} />
                </div>
                <div className="flex-1">
                  <label className="text-xs mb-1 block" style={{ color: "#888" }}>Макс. слотов:</label>
                  <input type="number" value={maxInv}
                    onChange={e => setMaxInv(Math.max(10, parseInt(e.target.value) || 28))}
                    disabled={isRunning} min={10} max={36} className="w-full text-xs p-2 rounded text-center"
                    style={{ background: "#1a1a1a", border: "1px solid #1a3a3a", color: isRunning ? "#555" : "#e8e8e8", outline: "none" }} />
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Start/Stop */}
        <div className="flex gap-2">
          {!isRunning ? (
            <button onClick={startAnarchy} disabled={!bot || bot.status !== "online"}
              className="flex-1 py-2 text-sm font-mono font-bold rounded"
              style={{
                background: bot?.status === "online"
                  ? (isBrewing ? "#2a0f3a" : "#7b1515")
                  : "#2a2a2a",
                color: bot?.status === "online"
                  ? (isBrewing ? "#cc88ff" : "#ff5555")
                  : "#555",
                border: "1px solid " + (bot?.status === "online" ? (isBrewing ? "#8e44ad" : "#c0392b") : "#333"),
                cursor: bot?.status === "online" ? "pointer" : "default",
              }}>
              {isBrewing ? "🧪 НАЧАТЬ ЗЕЛЬЕВАРЕНИЕ" : "ЗАПУСТИТЬ ПРОТОКОЛ АНАРХИИ"}
            </button>
          ) : (
            <button onClick={stopAnarchy}
              className="flex-1 py-2 text-sm font-mono font-bold rounded"
              style={{
                background: isBrewing ? "#1a0d2a" : "#2a1a1a",
                color: isBrewing ? "#cc88ff" : "#e74c3c",
                border: "1px solid " + (isBrewing ? "#6c3483" : "#7b1515"),
                cursor: "pointer",
              }}>
              ОСТАНОВИТЬ
            </button>
          )}
        </div>

        {/* Status */}
        {isRunning && (
          <div className="panel p-3" style={{ background: "#0f1a0f", border: "1px solid #1a3a1a" }}>
            <div className="text-xs font-mono mb-2" style={{ color: "#7ecc49" }}>Статус</div>
            <div className="grid grid-cols-2 gap-1 text-xs">
              <div style={{ color: "#888" }}>Фаза:</div>
              <div style={{ color: phaseColor, fontWeight: "bold" }}>{PHASE_LABELS[phase] ?? phase}</div>
              <div style={{ color: "#888" }}>Задача:</div>
              <div style={{ color: "#ccc" }}>
                {isBrewing
                  ? (currentPotion.emoji + " " + currentPotion.label)
                  : (TASK_PRESETS.find(p => p.id === selectedTask)?.label ?? state?.task)
                }
              </div>
              {!isBrewing && <>
                <div style={{ color: "#888" }}>Циклов:</div>
                <div style={{ color: "#2ec4b6" }}>{state?.cycleCount ?? 0}</div>
                <div style={{ color: "#888" }}>База:</div>
                <div style={{ color: "#f39c12", fontFamily: "monospace" }}>{homeCmd}</div>
              </>}
            </div>
          </div>
        )}

        {/* How it works */}
        <div className="panel p-3" style={{ border: "1px solid #1a1a1a" }}>
          <div className="text-xs font-mono mb-1" style={{ color: "#555" }}>Как работает</div>
          <div className="text-xs flex flex-col gap-0.5" style={{ color: "#444" }}>
            {isBrewing ? (
              <>
                <div>Находит стойку зельеварения в радиусе 32 блоков</div>
                <div>Берёт ингредиенты из ближайшего сундука</div>
                <div>Варит выбранное зелье (3 флакона за раз)</div>
                <div>Если есть Redstone и включён флаг — делает 8-минутную версию</div>
                <div>Если есть порох и включён Сплеш — добавляет после варки</div>
                <div style={{ color: "#6c3483", marginTop: 4 }}>Работает без ИИ / Ollama</div>
              </>
            ) : (
              <>
                <div>Выполняет задачу указанное число минут</div>
                <div>При заполнении инвентаря или по таймеру идёт домой</div>
                <div>На базе сдаёт ресурсы в сундук, берёт еду</div>
                <div>RTP-команда: телепорт перед каждым циклом работы</div>
                <div>Инструменты, броня и оружие НЕ сдаются</div>
                <div style={{ color: "#2e6a2e", marginTop: 4 }}>Работает без ИИ / Ollama</div>
              </>
            )}
          </div>
        </div>

        {/* Log */}
        <div className="panel flex flex-col" style={{ minHeight: 120 }}>
          <div className="px-3 py-1.5 border-b text-xs font-mono" style={{ borderColor: "#2a2a2a", color: "#555" }}>
            Журнал ({log.length})
          </div>
          <div ref={logRef} className="flex-1 overflow-y-auto p-2"
            style={{ maxHeight: 180, fontFamily: "monospace", fontSize: 10 }}>
            {log.length === 0 ? (
              <div className="text-center mt-4" style={{ color: "#333" }}>Журнал пуст</div>
            ) : (
              log.map((entry, i) => (
                <div key={i} className="mb-0.5">
                  <span style={{ color: "#3a3a3a" }}>[{fmtTime(entry.time)}] </span>
                  <span style={{
                    color: entry.msg.startsWith("Ошибка") || entry.msg.startsWith("Ой")
                      ? "#e67e22"
                      : (entry.msg.startsWith("✅") ? "#7ecc49" : (isBrewing ? "#cc88ff" : "#7ecc49"))
                  }}>
                    {entry.msg}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>

      </div>
    </div>
  );
}
