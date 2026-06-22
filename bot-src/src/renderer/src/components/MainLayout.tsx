import React, { useMemo } from "react";
import { useAppStore } from "../store/appStore";
import LeftPanel from "./panels/LeftPanel";
import CenterPanel from "./panels/CenterPanel";
import RightPanel from "./panels/RightPanel";
import BotTabs from "./BotTabs";
import TopBar from "./TopBar";

function StarField() {
  const stars = useMemo(() => {
    const out: React.CSSProperties[] = [];
    const rng = (seed: number) => {
      let s = seed;
      return () => { s = (s * 1664525 + 1013904223) & 0xffffffff; return (s >>> 0) / 4294967296; };
    };
    const rand = rng(0xdeadbeef);
    for (let i = 0; i < 220; i++) {
      const x  = rand() * 100;
      const y  = rand() * 100;
      const sz = rand() < 0.8 ? 1 : rand() < 0.6 ? 1.5 : 2.5;
      const op = 0.15 + rand() * 0.65;
      const dur = 2.5 + rand() * 4;
      const del = rand() * 6;
      out.push({
        left: `${x.toFixed(2)}%`,
        top: `${y.toFixed(2)}%`,
        width: sz,
        height: sz,
        ["--s-op" as any]: op.toFixed(2),
        ["--s-dur" as any]: `${dur.toFixed(1)}s`,
        ["--s-delay" as any]: `-${del.toFixed(1)}s`,
      });
    }
    return out;
  }, []);

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 0, pointerEvents: "none", overflow: "hidden" }}>
      <div className="nebula" style={{ width: 400, height: 400, background: "radial-gradient(circle, rgba(0,120,255,.7) 0%, transparent 70%)", top: "-100px", left: "-100px" }} />
      <div className="nebula" style={{ width: 350, height: 350, background: "radial-gradient(circle, rgba(80,0,200,.6) 0%, transparent 70%)", bottom: "-80px", right: "20%", animationDelay: "-4s" }} />
      <div className="nebula" style={{ width: 280, height: 280, background: "radial-gradient(circle, rgba(0,200,120,.5) 0%, transparent 70%)", top: "30%", right: "-60px", animationDelay: "-2s" }} />
      {stars.map((s, i) => <div key={i} className="star" style={s} />)}
    </div>
  );
}

export default function MainLayout() {
  const { bots, selectedBotId } = useAppStore();
  const selectedBot = bots.find((b) => b.id === selectedBotId) || null;

  return (
    <div className="flex flex-col w-full h-full" style={{ background: "#05070f", position: "relative" }}>
      <StarField />
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
