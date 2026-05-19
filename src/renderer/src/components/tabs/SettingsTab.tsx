import React, { useState, useEffect } from "react";
import { useAppStore } from "../../store/appStore";

export default function SettingsTab() {
  const { globalPassword, globalProxy, bots, selectedBotId } = useAppStore();
  const bot = bots.find((b) => b.id === selectedBotId);

  const [password, setPassword] = useState(globalPassword || "");
  const [proxy, setProxy] = useState(globalProxy || "");
  const [showPassword, setShowPassword] = useState(false);
  const [saved, setSaved] = useState(false);
  const [proxyResult, setProxyResult] = useState<string | null>(null);
  const [testingProxy, setTestingProxy] = useState(false);

  // Lobby config state
  const [lobbyEnabled, setLobbyEnabled] = useState(bot?.config.lobbyConfig?.enabled ?? true);
  const [lobbyMode, setLobbyMode] = useState(bot?.config.lobbyConfig?.mode || "auto");
  const [rankSlot, setRankSlot] = useState(String(bot?.config.lobbyConfig?.rankSlot ?? 0));
  const [rankName, setRankName] = useState(bot?.config.lobbyConfig?.rankName || "");
  const [rankWindowTitle, setRankWindowTitle] = useState(bot?.config.lobbyConfig?.rankWindowTitle || "");
  const [npcMode, setNpcMode] = useState(bot?.config.lobbyConfig?.npcMode ?? true);

  useEffect(() => {
    window.electronAPI.config.getGlobalPassword().then((p: string) => setPassword(p));
    window.electronAPI.config.get().then((cfg: any) => setProxy(cfg.globalProxy || ""));
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

  async function handleSavePassword() {
    await window.electronAPI.config.setGlobalPassword(password);
    setSaved(true); setTimeout(() => setSaved(false), 2000);
  }

  async function handleSaveProxy() {
    await window.electronAPI.config.set("globalProxy", proxy);
    setSaved(true); setTimeout(() => setSaved(false), 2000);
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
    const lobbyConfig = {
      enabled: lobbyEnabled,
      mode: lobbyMode,
      rankSlot: parseInt(rankSlot) || 0,
      rankName,
      rankWindowTitle,
      npcMode,
    };
    await window.electronAPI.bot.updateConfig(bot.id, { lobbyConfig });
    setSaved(true); setTimeout(() => setSaved(false), 2000);
  }

  async function handleTriggerLobby() {
    if (!bot) return;
    await window.electronAPI.bot.triggerLobby(bot.id);
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="px-3 py-2 border-b text-xs font-mono" style={{ borderColor: "#3a3a3a", color: "#7ecc49" }}>
        ⚙️ Глобальные настройки
      </div>

      <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-4">
        {/* Password */}
        <div className="panel p-3">
          <h3 className="text-xs font-mono mb-3" style={{ color: "#7ecc49" }}>🔑 Общий пароль</h3>
          <p className="text-xs mb-2" style={{ color: "#666" }}>Используется для /register и /login на всех серверах</p>
          <div className="flex gap-1">
            <input className="input text-xs flex-1" type={showPassword ? "text" : "password"}
              value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Введите пароль..." />
            <button className="btn text-xs" onClick={() => setShowPassword(!showPassword)}>
              {showPassword ? "🙈" : "👁️"}
            </button>
          </div>
          <button className="btn btn-primary text-xs w-full mt-2" onClick={handleSavePassword}>
            {saved ? "✅ Сохранено!" : "💾 Сохранить пароль"}
          </button>
        </div>

        {/* Proxy */}
        <div className="panel p-3">
          <h3 className="text-xs font-mono mb-3" style={{ color: "#7ecc49" }}>🔒 Глобальный прокси</h3>
          <input className="input text-xs mb-2 w-full" value={proxy}
            onChange={(e) => setProxy(e.target.value)}
            placeholder="socks5://IP:порт или логин:пароль@IP:порт" />
          <div className="flex gap-1">
            <button className="btn btn-primary text-xs flex-1" onClick={handleSaveProxy}>💾 Сохранить</button>
            <button className="btn text-xs" onClick={handleTestProxy} disabled={testingProxy || !proxy.trim()}>
              {testingProxy ? "⏳" : "🔍 Тест"}
            </button>
          </div>
          {proxyResult && (
            <div className="mt-2 p-2 rounded text-xs" style={{
              background: proxyResult.startsWith("✅") ? "#1a2a1a" : "#2a1a1a",
              color: proxyResult.startsWith("✅") ? "#7ecc49" : "#e74c3c",
              border: `1px solid ${proxyResult.startsWith("✅") ? "#3a5a3a" : "#5a3a3a"}`,
            }}>
              {proxyResult}
            </div>
          )}
        </div>

        {/* Lobby / Rank Config */}
        <div className="panel p-3">
          <h3 className="text-xs font-mono mb-3" style={{ color: "#7ecc49" }}>
            🏠 Лобби — Авто-выбор анки/ранга
          </h3>
          {!bot ? (
            <p className="text-xs" style={{ color: "#555" }}>Выберите бота для настройки лобби</p>
          ) : (
            <>
              <label className="flex items-center gap-2 text-xs mb-3 cursor-pointer" style={{ color: lobbyEnabled ? "#7ecc49" : "#888" }}>
                <input type="checkbox" checked={lobbyEnabled}
                  onChange={(e) => setLobbyEnabled(e.target.checked)}
                  style={{ accentColor: "#7ecc49" }} />
                Авто-выбор анки включён
              </label>

              <div className="mb-2">
                <label className="text-xs mb-1 block" style={{ color: "#888" }}>Способ выбора</label>
                <div className="flex gap-1">
                  {["auto", "compass", "npc"].map(m => (
                    <button key={m} className="btn text-xs flex-1"
                      style={{ borderColor: lobbyMode === m ? "#7ecc49" : "#3a3a3a", color: lobbyMode === m ? "#7ecc49" : "#888" }}
                      onClick={() => setLobbyMode(m)}>
                      {m === "auto" ? "🔄 Авто" : m === "compass" ? "🧭 Компас" : "🗣 NPC"}
                    </button>
                  ))}
                </div>
              </div>

              <label className="flex items-center gap-2 text-xs mb-2 cursor-pointer" style={{ color: "#888" }}>
                <input type="checkbox" checked={npcMode}
                  onChange={(e) => setNpcMode(e.target.checked)}
                  style={{ accentColor: "#7ecc49" }} />
                Также искать NPC по имени
              </label>

              <div className="mb-2">
                <label className="text-xs mb-1 block" style={{ color: "#888" }}>
                  Слот в GUI для анки (0 = первый)
                </label>
                <input className="input text-xs w-full" type="number" min="0" max="53"
                  value={rankSlot} onChange={(e) => setRankSlot(e.target.value)} placeholder="0" />
              </div>

              <div className="mb-2">
                <label className="text-xs mb-1 block" style={{ color: "#888" }}>
                  Название анки (поиск по тексту, опционально)
                </label>
                <input className="input text-xs w-full" value={rankName}
                  onChange={(e) => setRankName(e.target.value)} placeholder="Например: Выживание, Анархия..." />
              </div>

              <div className="mb-3">
                <label className="text-xs mb-1 block" style={{ color: "#888" }}>
                  Заголовок окна выбора анки (опционально)
                </label>
                <input className="input text-xs w-full" value={rankWindowTitle}
                  onChange={(e) => setRankWindowTitle(e.target.value)} placeholder="Например: Выбор ранга" />
              </div>

              <div className="flex gap-1">
                <button className="btn btn-primary text-xs flex-1" onClick={handleSaveLobby}>
                  💾 Сохранить настройки лобби
                </button>
                <button className="btn text-xs" onClick={handleTriggerLobby}
                  disabled={bot.status !== "online"}
                  title="Вручную запустить выбор анки прямо сейчас">
                  🏠 Выбрать сейчас
                </button>
              </div>
              <p className="text-xs mt-1" style={{ color: "#555" }}>
                Кнопка "🏠 Анка" в правой панели чата тоже запускает выбор вручную
              </p>
            </>
          )}
        </div>

        {/* Ollama */}
        <div className="panel p-3">
          <h3 className="text-xs font-mono mb-3" style={{ color: "#7ecc49" }}>🤖 Ollama</h3>
          <button className="btn text-xs w-full mb-2" onClick={() => window.electronAPI.shell.openExternal("https://ollama.com")}>
            🌐 Сайт Ollama
          </button>
          <div className="text-xs" style={{ color: "#555" }}>
            <p>Ollama запускается автоматически на localhost:11434</p>
            <p className="mt-1">Модели: вкладка "Модели ИИ"</p>
          </div>
        </div>

        {/* About */}
        <div className="panel p-3">
          <h3 className="text-xs font-mono mb-2" style={{ color: "#7ecc49" }}>📋 О приложении</h3>
          <div className="text-xs" style={{ color: "#666", lineHeight: 1.6 }}>
            <p>Minecraft Bot v4.0</p>
            <p>Новинки v4: LobbyHandler, двойной чат, улучш. авто-логин</p>
            <p>ИИ: Ollama (локально) + API (OpenAI/Claude)</p>
            <p>Движок: Mineflayer (Java Edition)</p>
          </div>
        </div>
      </div>
    </div>
  );
}
