import React, { useState } from "react";
import { useAppStore } from "../store/appStore";
import BotCreateModal from "./BotCreateModal";

export default function BotTabs() {
  const { bots, selectedBotId, setSelectedBot, activeTab, setActiveTab } = useAppStore();
  const [showCreate, setShowCreate] = useState(false);

  const tabs = [
    { id: "bots",        label: "Боты" },
    { id: "farm",        label: "🌾 Ферма" },
    { id: "models",      label: "Модели ИИ" },
    { id: "anarchy",     label: "🏴‍☠️ Анархия" },
    { id: "coordinator", label: "Координатор" },
    { id: "settings",    label: "Настройки" },
  ] as const;

  return (
    <div
      className="flex items-center border-b overflow-x-auto"
      style={{ borderColor: "#3a3a3a", background: "rgba(20,20,20,0.9)", minHeight: 34 }}
    >
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => setActiveTab(tab.id as any)}
          className="px-4 py-1.5 text-xs font-mono whitespace-nowrap transition-colors"
          style={{
            color: activeTab === tab.id
              ? (tab.id === "anarchy" ? "#e74c3c" : tab.id === "farm" ? "#7ecc49" : "#7ecc49")
              : "#888",
            borderBottom: activeTab === tab.id
              ? `2px solid ${tab.id === "anarchy" ? "#e74c3c" : "#7ecc49"}`
              : "2px solid transparent",
            background: "none", cursor: "pointer",
          }}
        >
          {tab.label}
        </button>
      ))}

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
                  background: selectedBotId === bot.id ? "#2a3a2a" : "transparent",
                  color: selectedBotId === bot.id ? "#7ecc49" : "#888",
                  border: `1px solid ${selectedBotId === bot.id ? "#5b8c3e" : "transparent"}`,
                  cursor: "pointer",
                }}
              >
                <span
                  className="w-1.5 h-1.5 rounded-full"
                  style={{
                    background:
                      bot.status === "online" ? "#7ecc49"
                      : bot.status === "connecting" ? "#f1c40f"
                      : "#555",
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
