import React from "react";
import { useAppStore } from "../store/appStore";
import LeftPanel from "./panels/LeftPanel";
import CenterPanel from "./panels/CenterPanel";
import RightPanel from "./panels/RightPanel";
import BotTabs from "./BotTabs";
import TopBar from "./TopBar";
import StarBackground from "./StarBackground";

export default function MainLayout() {
  const { bots, selectedBotId } = useAppStore();
  const selectedBot = bots.find((b) => b.id === selectedBotId) || null;

  return (
    <div className="flex flex-col w-full h-full" style={{ position: "relative", background: "#0d1117" }}>
      <StarBackground />
      <div style={{ position: "relative", zIndex: 1, display: "flex", flexDirection: "column", width: "100%", height: "100%" }}>
        <TopBar />
        <BotTabs />
        <div className="flex flex-1 gap-1 overflow-hidden p-1">
          <LeftPanel />
          <CenterPanel bot={selectedBot} />
          <RightPanel bot={selectedBot} />
        </div>
      </div>
    </div>
  );
}
