import React, { useState, useEffect, useRef } from "react";
import { BotState } from "../store/appStore";

interface Props {
  bot: BotState;
  onClose: () => void;
}

const RECOMMENDED_MODELS = [
  { name: "sweaterdog/andy-4:micro-q8_0", label: "Andy-4 Micro (Minecraft) — рекомендуется" },
  { name: "andy-4", label: "Andy-4 (Minecraft) — полная" },
  { name: "llama3", label: "Llama 3 8B" },
  { name: "mistral", label: "Mistral 7B" },
  { name: "gemma:2b", label: "Gemma 2B" },
  { name: "phi3:mini", label: "Phi-3 Mini" },
  { name: "deepseek-r1:7b", label: "DeepSeek R1 7B" },
];

const VERSIONS = ["1.20.4", "1.20.1", "1.19.4", "1.18.2", "1.17.1", "1.16.5", "1.12.2", "1.8.9"];

export default function BotEditModal({ bot, onClose }: Props) {
  const cfg = bot.config;
  const [form, setForm] = useState({
    nick: cfg.nick,
    host: cfg.host,
    port: String(cfg.port),
    version: cfg.version,
    authType: cfg.authType || "offline",
    aiEnabled: cfg.aiEnabled,
    aiModel: cfg.aiModel,
    aiMode: cfg.aiMode || "local",
    apiKey: cfg.apiKey || "",
    systemPrompt: cfg.systemPrompt || "",
    proxy: cfg.proxy || "",
    autoLogin: cfg.autoLogin,
    autoRegister: cfg.autoRegister,
    autoResponse: cfg.autoResponse ?? true,
    autoReconnect: cfg.autoReconnect ?? true,
    reconnectDelay: String(cfg.reconnectDelay ?? 5000),
  });

  const [installedModels, setInstalledModels] = useState<{ name: string; size: string }[]>([]);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState(false);
  const [needsReconnect, setNeedsReconnect] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    window.electronAPI.ollama.listInstalledModels().then(setInstalledModels).catch(() => {});
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node))
        setDropdownOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  function update(key: string, value: any) {
    setForm(f => ({ ...f, [key]: value }));
    if (["host", "port", "version", "nick"].includes(key)) setNeedsReconnect(true);
  }

  async function handleSave() {
    setLoading(true);
    await window.electronAPI.bot.updateConfig(bot.id, {
      nick: form.nick,
      host: form.host,
      port: parseInt(form.port) || 25565,
      version: form.version,
      authType: form.authType,
      aiEnabled: form.aiEnabled,
      aiModel: form.aiModel,
      aiMode: form.aiMode,
      apiKey: form.apiKey,
      systemPrompt: form.systemPrompt,
      proxy: form.proxy,
      autoLogin: form.autoLogin,
      autoRegister: form.autoRegister,
      autoResponse: form.autoResponse,
      autoReconnect: form.autoReconnect,
      reconnectDelay: parseInt(form.reconnectDelay) || 5000,
    });

    // Если изменился сервер/ник — переподключаем
    if (needsReconnect && bot.status === "online") {
      await window.electronAPI.bot.disconnect(bot.id).catch(() => {});
      setTimeout(() => window.electronAPI.bot.connect(bot.id).catch(() => {}), 1000);
    }

    setSaved(true);
    setLoading(false);
    setTimeout(() => { setSaved(false); onClose(); }, 1000);
  }

  return (
    <div
      className="fixed inset-0 flex items-center justify-center z-50"
      style={{ background: "rgba(0,0,0,0.75)" }}
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div className="panel p-5" style={{ width: 420, maxHeight: "90vh", overflowY: "auto", borderColor: "#5b8c3e" }}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-mono" style={{ color: "#7ecc49" }}>
            ✏️ Редактировать бота
          </h2>
          <span className="text-xs" style={{ color: "#555" }}>{bot.id.slice(0, 8)}</span>
        </div>

        <div className="flex flex-col gap-3">
          {/* Nick */}
          <div>
            <label className="text-xs mb-1 block" style={{ color: "#888" }}>Ник бота</label>
            <input className="input w-full" value={form.nick} onChange={e => update("nick", e.target.value)} />
          </div>

          {/* Server */}
          <div className="flex gap-2">
            <div className="flex-1">
              <label className="text-xs mb-1 block" style={{ color: "#888" }}>IP / хост сервера</label>
              <input className="input w-full" value={form.host} onChange={e => update("host", e.target.value)} />
            </div>
            <div style={{ width: 85 }}>
              <label className="text-xs mb-1 block" style={{ color: "#888" }}>Порт</label>
              <input className="input w-full" type="number" value={form.port}
                onChange={e => update("port", e.target.value)} />
            </div>
          </div>

          {needsReconnect && (
            <div className="text-xs px-2 py-1 rounded" style={{ background: "#2a1a00", border: "1px solid #5a3a00", color: "#f39c12" }}>
              ⚠️ Изменились параметры сервера — бот переподключится после сохранения
            </div>
          )}

          {/* Version + Auth */}
          <div className="flex gap-2">
            <div className="flex-1">
              <label className="text-xs mb-1 block" style={{ color: "#888" }}>Версия MC</label>
              <select className="input w-full" value={form.version} onChange={e => update("version", e.target.value)}>
                {VERSIONS.map(v => <option key={v} value={v}>{v}</option>)}
              </select>
            </div>
            <div className="flex-1">
              <label className="text-xs mb-1 block" style={{ color: "#888" }}>Авторизация</label>
              <select className="input w-full" value={form.authType} onChange={e => update("authType", e.target.value)}>
                <option value="offline">Офлайн</option>
                <option value="microsoft">Microsoft</option>
              </select>
            </div>
          </div>

          {/* AI Model */}
          <div>
            <label className="text-xs mb-1 block" style={{ color: "#888" }}>Модель ИИ</label>
            <div className="relative" ref={dropdownRef}>
              <div className="flex items-center gap-1 cursor-pointer"
                style={{ background: "#1e1e1e", border: "1px solid #3a3a3a", borderRadius: 4, padding: "6px 8px" }}
                onClick={() => setDropdownOpen(v => !v)}>
                <span className="flex-1 text-xs truncate" style={{ color: "#e8e8e8" }}>{form.aiModel || "Выберите модель..."}</span>
                <span style={{ color: "#555", fontSize: 10 }}>{dropdownOpen ? "▲" : "▼"}</span>
              </div>
              {dropdownOpen && (
                <div style={{
                  position: "absolute", top: "100%", left: 0, right: 0,
                  background: "#1e1e1e", border: "1px solid #3a3a3a", borderTop: "none",
                  borderRadius: "0 0 4px 4px", maxHeight: 180, overflowY: "auto", zIndex: 100,
                }}>
                  {installedModels.map(m => (
                    <div key={m.name} className="flex items-center justify-between px-2 py-1.5 cursor-pointer"
                      style={{ background: form.aiModel === m.name ? "#2a3a2a" : "" }}
                      onMouseEnter={e => (e.currentTarget.style.background = "#2a2a2a")}
                      onMouseLeave={e => (e.currentTarget.style.background = form.aiModel === m.name ? "#2a3a2a" : "")}
                      onClick={() => { update("aiModel", m.name); setDropdownOpen(false); }}>
                      <span className="text-xs" style={{ color: form.aiModel === m.name ? "#7ecc49" : "#e8e8e8" }}>
                        {form.aiModel === m.name ? "✓ " : ""}{m.name}
                      </span>
                      <span style={{ color: "#555", fontSize: 9 }}>{m.size}</span>
                    </div>
                  ))}
                  {RECOMMENDED_MODELS.map(m => (
                    <div key={m.name} className="px-2 py-1.5 cursor-pointer text-xs"
                      style={{ color: form.aiModel === m.name ? "#7ecc49" : "#aaa" }}
                      onMouseEnter={e => (e.currentTarget.style.background = "#2a2a2a")}
                      onMouseLeave={e => (e.currentTarget.style.background = "")}
                      onClick={() => { update("aiModel", m.name); setDropdownOpen(false); }}>
                      {form.aiModel === m.name ? "✓ " : ""}{m.label}
                    </div>
                  ))}
                  <div style={{ borderTop: "1px solid #2a2a2a", padding: "4px 8px" }}>
                    <input className="input text-xs w-full" placeholder="Ввести вручную..."
                      value={form.aiModel} onChange={e => update("aiModel", e.target.value)}
                      onClick={e => e.stopPropagation()} />
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* AI mode */}
          <div className="flex gap-2">
            <div className="flex-1">
              <label className="text-xs mb-1 block" style={{ color: "#888" }}>Режим ИИ</label>
              <select className="input w-full" value={form.aiMode} onChange={e => update("aiMode", e.target.value)}>
                <option value="local">Локально (Ollama)</option>
                <option value="api">API (OpenAI/Claude)</option>
              </select>
            </div>
            {form.aiMode === "api" && (
              <div className="flex-1">
                <label className="text-xs mb-1 block" style={{ color: "#888" }}>API ключ</label>
                <input className="input w-full text-xs" type="password" value={form.apiKey}
                  onChange={e => update("apiKey", e.target.value)} placeholder="sk-..." />
              </div>
            )}
          </div>

          {/* System prompt */}
          <div>
            <label className="text-xs mb-1 block" style={{ color: "#888" }}>Системный промпт</label>
            <textarea className="input w-full text-xs" rows={3} value={form.systemPrompt}
              onChange={e => update("systemPrompt", e.target.value)}
              style={{ resize: "vertical", fontFamily: "monospace" }}
              placeholder="Ты Minecraft бот. Всегда отвечай по-русски..." />
          </div>

          {/* Proxy */}
          <div>
            <label className="text-xs mb-1 block" style={{ color: "#888" }}>Прокси (необязательно)</label>
            <input className="input w-full" value={form.proxy}
              onChange={e => update("proxy", e.target.value)} placeholder="socks5://IP:порт" />
          </div>

          {/* Reconnect delay */}
          <div>
            <label className="text-xs mb-1 block" style={{ color: "#888" }}>Задержка переподключения (мс)</label>
            <input className="input w-full" type="number" value={form.reconnectDelay}
              onChange={e => update("reconnectDelay", e.target.value)} />
          </div>

          {/* Checkboxes */}
          <div className="grid grid-cols-2 gap-2 text-xs" style={{ color: "#888" }}>
            {([
              ["aiEnabled", "🤖 ИИ включён"],
              ["autoResponse", "💬 Автоответ"],
              ["autoLogin", "🔑 Авто-логин"],
              ["autoRegister", "📝 Авто-регистрация"],
              ["autoReconnect", "🔄 Авто-реконнект"],
            ] as [string, string][]).map(([key, label]) => (
              <label key={key} className="flex items-center gap-1.5 cursor-pointer">
                <input type="checkbox" checked={!!form[key as keyof typeof form]}
                  onChange={e => update(key, e.target.checked)}
                  style={{ accentColor: "#7ecc49" }} />
                {label}
              </label>
            ))}
          </div>
        </div>

        <div className="flex gap-2 mt-5">
          <button className="btn btn-primary flex-1" onClick={handleSave} disabled={loading}>
            {saved ? "✅ Сохранено!" : loading ? "⏳ Сохранение..." : "💾 Сохранить"}
          </button>
          <button className="btn" onClick={onClose}>Отмена</button>
        </div>
      </div>
    </div>
  );
}
