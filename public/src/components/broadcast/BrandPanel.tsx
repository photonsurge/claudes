"use client";

/**
 * Top-left identity block: a small monogram mark, the channel name + tagline, a
 * pulsing LIVE badge and a live clock. Purely decorative (pointer-inert).
 */
import { useEffect, useState } from "react";
import { DEFAULT_THEME, type BroadcastTheme } from "./config";

/** "5:06:12 PM" — locale time, ticking each second. Starts empty so server and
 *  client first-render match (no hydration mismatch); fills in on mount. */
function useClock(): string {
  const [clock, setClock] = useState("");
  useEffect(() => {
    const tick = () =>
      setClock(new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" }));
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, []);
  return clock;
}

export default function BrandPanel({
  theme = DEFAULT_THEME,
  compact = false,
}: {
  theme?: BroadcastTheme;
  compact?: boolean;
}) {
  const clock = useClock();
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, pointerEvents: "none" }}>
      <style>{"@keyframes bcast-livepulse{0%,100%{opacity:1}50%{opacity:0.35}}"}</style>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: compact ? 8 : 11,
          padding: compact ? "7px 11px" : "9px 14px",
          background: theme.panelBg,
          border: theme.panelBorder,
          borderRadius: 12,
          boxShadow: "0 8px 26px rgba(0,0,0,0.45)",
          backdropFilter: "blur(8px)",
          WebkitBackdropFilter: "blur(8px)",
        }}
      >
        {/* Monogram mark */}
        <svg width={compact ? 26 : 34} height={compact ? 26 : 34} viewBox="0 0 40 40" aria-hidden>
          <circle cx="20" cy="20" r="18" fill="none" stroke={theme.accent} strokeWidth="2" />
          <circle cx="20" cy="20" r="18" fill="rgba(120,190,255,0.06)" />
          <path d="M13 12h9a6 6 0 0 1 0 12h-9z M22 24l6 5" fill="none" stroke="#cfe2ff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.1 }}>
          <span
            style={{
              fontSize: compact ? 15 : 19,
              fontWeight: 800,
              letterSpacing: 1,
              color: "#fff",
              fontFamily: "system-ui, sans-serif",
            }}
          >
            {theme.name}
          </span>
          <span
            style={{
              fontSize: compact ? 8.5 : 10,
              fontWeight: 700,
              letterSpacing: 1.2,
              color: "#8fb6e6",
              opacity: 0.8,
              fontFamily: "system-ui, sans-serif",
            }}
          >
            {theme.tagline}
          </span>
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "3px 9px",
            borderRadius: 6,
            background: theme.accent,
            fontFamily: "system-ui, sans-serif",
            fontSize: 11,
            fontWeight: 800,
            letterSpacing: 1.5,
            color: "#fff",
            boxShadow: `0 0 12px ${theme.accent}88`,
          }}
        >
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: "50%",
              background: "#fff",
              animation: "bcast-livepulse 1.4s ease-in-out infinite",
            }}
          />
          LIVE
        </div>
        <span
          style={{
            fontFamily: "system-ui, sans-serif",
            fontSize: 12,
            fontWeight: 600,
            letterSpacing: 0.5,
            color: "#cfe0f5",
            fontVariantNumeric: "tabular-nums",
            textShadow: "0 1px 2px rgba(0,0,0,0.8)",
          }}
        >
          {clock}
        </span>
      </div>
    </div>
  );
}
