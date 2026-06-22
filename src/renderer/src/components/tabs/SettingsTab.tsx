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
  const [autoCollect, setAutoCollect] = useState(true);
  const [blacklist, setBlacklist] = useState<string[]>([]);
  const [blacklistInput, setBlacklistInput] = useState("");
  const [blacklistSaved, setBlacklistSaved] = useState(false);

  // Teammate nicks (won't be attacked in PvP)
  const [teammates, setTeammates] = useState<string[]>([]);
  const [teammateInput, setTeammateInput] = useState("");
  const [teammateSaved, setTeammateSaved] = useState(false);

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
      setTeammates(cfg.teammates || []);
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
    if (bot?.config.teammates) {
      setTeammates(bot.config.teammates);
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
    flash(setSaved);
  }

  async function handleSaveBlacklist() {
    await window.electronAPI.config.set("pickupBlacklist", blacklist);
    await window.electronAPI.config.set("autoCollect", autoCollect);
    flash(setBlacklistSaved);
  }

  async function handleSaveTeammates() {
    await window.electronAPI.config.set("teammates", teammates);
    // Also update all connected bots
    if (bot) await window.electronAPI.bot.updateConfig(bot.id, { teammates });
    flash(setTeammateSaved);
  }

  function addBlacklistItem() {
    const item = blacklistInput.trim().toLowerCase().replace(/\s+/g, "_");
    if (!item || blacklist.includes(item)) { setBlacklistInput(""); return; }
    setBlacklist(prev => [...prev, item]);
    setBlacklistInput("");
  }

  function addTeammate() {
    const nick = teammateInput.trim();
    if (!nick || teammates.includes(nick)) { setTeammateInput(""); return; }
    setTeammates(prev => [...prev, nick]);
    setTeammateInput("");
  }

  async function handleTriggerLobby() {
    if (!bot) return;
    await window.electronAPI.bot.triggerLobby(bot.id);
  }

  const sectionStyle: React.CSSProperties = {
    background: "rgba(14,18,26,0.82)", border: "1px solid rgba(55,65,88,0.55)",
    borderRadius: 6, padding: 12, backdropFilter: "blur(6px)",
  };
  const labelStyle: React.CSSProperties = { color: "#7ecc49", fontSize: 11.5, fontFamily: "monospace", fontWeight: "bold", marginBottom: 10 };
  const hintStyle: React.CSSProperties = { color: "#555", fontSize: 10.5, marginBottom: 8 };
  const tagStyle: React.CSSProperties = {
    display: "inline-flex", alignItems: "center", gap: 5,
    background: "rgba(30,36,50,0.9)", border: "1px solid #2a3040",
    borderRadius: 3, padding: "2px 8px", fontSize: 10.5, color: "#aaa",
    fontFamily: "monospace",
  };

  return (
    <div className="flex flex-col h-full overflow-hidden" style={{ background: "transparent" }}>
      <div className="px-3 py-2 border-b text-xs font-mono" style={{ borderColor: "rgba(55,65,88,0.5)", color: "#7ecc49", background: "rgba(10,12,18,0.7)" }}>
        ⚙️ Глобальные настройки
      </div>

      <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-3">

        {/* ── TEAMMATES ─────────────────────────────────────────────────── */}
        <div style={sectionStyle}>
          <div style={labelStyle}>🤝 Тимейты (не атаковать)</div>
          <p style={hintStyle}>Никнеймы игроков, которых бот никогда не атакует в PvP-режиме</p>
          <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
            <input className="input text-xs flex-1" value={teammateInput}
              onChange={(e) => setTeammateInput(e.target.value)}
              placeholder="Никнейм игрока..."
              onKeyDown={(e) => e.key === "Enter" && addTeammate()} />
            <button className="btn btn-primary text-xs" onClick={addTeammate}>+ Добавить</button>
          </div>
          {teammates.length > 0 ? (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginBottom: 8 }}>
              {teammates.map(nick => (
                <div key={nick} style={tagStyle}>
                  <span style={{ color: "#7ecc49" }}>👤</span>
                  <span>{nick}</span>
                  <button onClick={() => setTeammates(p => p.filter(x => x !== nick))}
                    style={{ background: "none", border: "none", color: "#555", cursor: "pointer", fontSize: 12, padding: 0, lineHeight: 1 }}>
                    ✕
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ color: "#444", fontSize: 10.5, marginBottom: 8, fontStyle: "italic" }}>
              Список пуст — бот атакует всех игроков
            </div>
          )}
          <button className="btn btn-primary text-xs w-full" onClick={handleSaveTeammates}>
            {teammateSaved ? "✅ Тимейты сохранены!" : "💾 Сохранить тимейтов"}
          </button>
        </div>

        {/* ── PASSWORD ──────────────────────────────────────────────────── */}
        <div style={sectionStyle}>
          <div style={labelStyle}>🔑 Общий пароль</div>
          <p style={hintStyle}>Используется для /register и /login на всех серверах</p>
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

        {/* ── PROXY ─────────────────────────────────────────────────────── */}
        <div style={sectionStyle}>
          <div style={labelStyle}>🔒 Глобальный прокси</div>
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
            <div style={{ marginTop: 6, fontSize: 10.5, color: proxyResult.startsWith("✅") ? "#7ecc49" : "#e74c3c", fontFamily: "monospace" }}>
              {proxyResult}
            </div>
          )}
        </div>

        {/* ── PICKUP BLACKLIST ──────────────────────────────────────────── */}
        <div style={sectionStyle}>
          <div style={labelStyle}>🚫 Чёрный список подбора</div>
          <div className="flex items-center gap-2 mb-2">
            <input type="checkbox" checked={autoCollect} onChange={e => setAutoCollect(e.target.checked)} id="autoCollect" />
            <label htmlFor="autoCollect" style={{ color: "#aaa", fontSize: 11, cursor: "pointer" }}>
              Авто-подбор предметов
            </label>
          </div>
          <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
            <input className="input text-xs flex-1" value={blacklistInput}
              onChange={(e) => setBlacklistInput(e.target.value)}
              placeholder="Название предмета (snake_case)..."
              onKeyDown={(e) => e.key === "Enter" && addBlacklistItem()} />
            <button className="btn text-xs" onClick={addBlacklistItem}>+</button>
          </div>
          {blacklist.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginBottom: 8 }}>
              {blacklist.map(item => (
                <div key={item} style={tagStyle}>
                  <span>{item}</span>
                  <button onClick={() => setBlacklist(p => p.filter(x => x !== item))}
                    style={{ background: "none", border: "none", color: "#555", cursor: "pointer", fontSize: 12, padding: 0, lineHeight: 1 }}>✕</button>
                </div>
              ))}
            </div>
          )}
          <button className="btn btn-primary text-xs w-full" onClick={handleSaveBlacklist}>
            {blacklistSaved ? "✅ Сохранено!" : "💾 Сохранить"}
          </button>
        </div>

        {/* ── LOBBY CONFIG ──────────────────────────────────────────────── */}
        {bot && (
          <div style={sectionStyle}>
            <div style={labelStyle}>🏰 Настройки лобби</div>
            <div className="flex items-center gap-2 mb-2">
              <input type="checkbox" checked={lobbyEnabled} onChange={e => setLobbyEnabled(e.target.checked)} id="lobbyEnabled" />
              <label htmlFor="lobbyEnabled" style={{ color: "#aaa", fontSize: 11, cursor: "pointer" }}>Авто-лобби включено</label>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <div>
                <div style={{ color: "#666", fontSize: 10, marginBottom: 3 }}>Режим:</div>
                <select className="input text-xs" value={lobbyMode} onChange={e => setLobbyMode(e.target.value)}
                  style={{ background: "rgba(8,10,16,0.9)", color: "#ccc", border: "1px solid #2a3040" }}>
                  <option value="auto">auto</option>
                  <option value="compass">compass</option>
                  <option value="npc">npc</option>
                  <option value="manual">manual</option>
                </select>
              </div>
              <div>
                <div style={{ color: "#666", fontSize: 10, marginBottom: 3 }}>Слот компаса (0-8):</div>
                <input className="input text-xs" value={rankSlot}
                  onChange={e => setRankSlot(e.target.value)} placeholder="0" type="number" min="0" max="8" />
              </div>
              <div>
                <div style={{ color: "#666", fontSize: 10, marginBottom: 3 }}>Название ранга:</div>
                <input className="input text-xs" value={rankName}
                  onChange={e => setRankName(e.target.value)} placeholder="VIP, MVP+ ..." />
              </div>
              <div>
                <div style={{ color: "#666", fontSize: 10, marginBottom: 3 }}>Заголовок окна ранга:</div>
                <input className="input text-xs" value={rankWindowTitle}
                  onChange={e => setRankWindowTitle(e.target.value)} placeholder="Rank Selection" />
              </div>
              <div className="flex items-center gap-2">
                <input type="checkbox" checked={npcMode} onChange={e => setNpcMode(e.target.checked)} id="npcMode" />
                <label htmlFor="npcMode" style={{ color: "#aaa", fontSize: 11, cursor: "pointer" }}>NPC-режим</label>
              </div>
            </div>
            <div className="flex gap-2 mt-3">
              <button className="btn btn-primary text-xs flex-1" onClick={handleSaveLobby}>
                {saved ? "✅ Сохранено!" : "💾 Сохранить"}
              </button>
              <button className="btn text-xs" onClick={handleTriggerLobby}>
                🚀 Запустить лобби
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
