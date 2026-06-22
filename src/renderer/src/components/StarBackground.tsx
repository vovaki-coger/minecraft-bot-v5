import React, { useMemo } from "react";

export default function StarBackground() {
  const stars = useMemo(() => Array.from({ length: 130 }, (_, i) => ({
    id: i,
    left: Math.random() * 100,
    top: Math.random() * 100,
    size: Math.random() < 0.06 ? 2.5 : Math.random() < 0.25 ? 1.5 : 1,
    dur: 2 + Math.random() * 4,
    delay: Math.random() * 6,
    opacity: 0.25 + Math.random() * 0.45,
  })), []);

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 0, pointerEvents: "none", overflow: "hidden",
    }}>
      {stars.map((s) => (
        <div key={s.id} style={{
          position: "absolute",
          left: s.left + "%", top: s.top + "%",
          width: s.size, height: s.size,
          borderRadius: "50%", background: "#fff",
          animation: `twinkle ${s.dur}s ${s.delay}s ease-in-out infinite alternate`,
          opacity: s.opacity,
        }} />
      ))}
    </div>
  );
}
