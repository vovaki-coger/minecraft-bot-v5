import React, { useState } from "react";
import { useAppStore } from "../store/appStore";
import BotCreateModal from "./BotCreateModal";

export default function BotTabs() {
  const { bots, selectedBotId, setSelectedBot, activeTab, setActiveTab } = useAppStore();
  const [showCreate, setShowCreate] = useState(false);

  const tabs = [
    { id: "bots",        label: "Боты",         color: "#7ecc49" },
    { id: "farm",        label: "🌾 Ферма",      color: "#7ecc49" },
    { id: "pvp",         label: "⚔️ PVP",        color: "#e74c3c" },
    { id: "models",      label: "Модели ИИ",     color: "#7ecc49" },
    { id: "anarchy",     label: "🏴‍☠️ Анархия",  color: "#e74c3c" },
    { id: "coordinator", label: "Координатор",   color: "#7ecc49" },
    { id: "logs",        label: "📋 Логи",         color: "#9b59b6" },
    { id: "settings",    label: "Настройки",     color: "#7ecc49" },
  ] as const;

  return (
    <div
      className="flex items-center border-b overflow-x-auto"
      style={{ borderColor: "rgba(40,55,80,0.5)", background: "rgba(8,12,18,0.95)", minHeight: 34 }}
    >
      {tabs.map((tab) => {
        const isActive = activeTab === tab.id;
        return (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as any)}
            className="px-4 py-1.5 text-xs font-mono whitespace-nowrap transition-colors"
            style={{
              color: isActive ? tab.color : "#444",
              borderBottom: isActive
                ? `2px solid ${tab.color}`
                : "2px solid transparent",
              background: "none",
              cursor: "pointer",
              textShadow: isActive ? `0 0 8px ${tab.color}80` : "none",
              transition: "all 0.15s",
            }}
          >
            {tab.label}
          </button>
        );
      })}

      <div className="flex-1" />

      {activeTab === "bots" && (
        <>
          <div className="flex items-center gap-1 px-2 overflow-x-auto max-w-lg">
            {bots.map((bot) => (
              <button
                key={bot.id}
                onClick={() => setSelectedBot(bot.id)}
                className="flex items-center gap-1.5 px-2 py-1 text-xs font-mono rounded whitespace-nowrap"
                style={{
                  background: selectedBotId === bot.id ? "rgba(126,204,73,0.08)" : "transparent",
                  color: selectedBotId === bot.id ? "#7ecc49" : "#555",
                  border: `1px solid ${selectedBotId === bot.id ? "rgba(126,204,73,0.4)" : "transparent"}`,
                  cursor: "pointer",
                  boxShadow: selectedBotId === bot.id ? "0 0 8px rgba(126,204,73,0.1)" : "none",
                  transition: "all 0.15s",
                }}
              >
                <span
                  className="w-1.5 h-1.5 rounded-full"
                  style={{
                    background:
                      bot.status === "online" ? "#7ecc49"
                      : bot.status === "connecting" ? "#f39c12"
                      : "#333",
                    boxShadow: bot.status === "online" ? "0 0 6px rgba(126,204,73,0.6)" : "none",
                  }}
                />
                {bot.config.nick}
              </button>
            ))}
          </div>
          <button
            className="btn btn-primary text-xs mx-2 flex-shrink-0"
            style={{ padding: "3px 10px", fontSize: 11 }}
            onClick={() => setShowCreate(true)}
          >
            + Добавить бота
          </button>
        </>
      )}

      {showCreate && <BotCreateModal onClose={() => setShowCreate(false)} />}
    </div>
  );
}
