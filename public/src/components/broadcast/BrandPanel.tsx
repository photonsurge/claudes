"use client";

/**
 * Top-left identity block: a small monogram mark, the channel name + tagline, a
 * pulsing LIVE badge and a live clock. Purely decorative (pointer-inert).
 */
import { useEffect, useState } from "react";
import { DEFAULT_THEME, LIVE_RED, type BroadcastTheme } from "./config";

/** "18:16:39" UTC, ticking each second — a global broadcast reads one clock for
 *  every viewer regardless of timezone. Starts empty so server and client
 *  first-render match (no hydration mismatch); fills in on mount. */
function useClock(): string {
  const [clock, setClock] = useState("");
  useEffect(() => {
    const tick = () =>
      setClock(
        new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "UTC" }),
      );
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, []);
  return clock;
}

/** Globe + satellite-ring monogram used by themes with iconVariant "orbit". */
function OrbitMark({ size, accent }: { size: number; accent: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden>
      <defs>
        <radialGradient id="gods-globe" cx="35%" cy="30%" r="75%">
          <stop offset="0%" stopColor="#bfe6ff" />
          <stop offset="45%" stopColor={accent} />
          <stop offset="100%" stopColor="#08182c" />
        </radialGradient>
      </defs>
      <g transform="rotate(-18 20 21)">
        <ellipse
          cx="20"
          cy="21"
          rx="16"
          ry="5.5"
          fill="none"
          stroke="#a8c6e0"
          strokeWidth="1.6"
          strokeDasharray="36 36"
          strokeDashoffset="18"
          opacity="0.5"
        />
      </g>
      <circle cx="20" cy="20" r="11" fill="url(#gods-globe)" stroke="#7fd0ff" strokeWidth="0.6" />
      <path d="M9.5 20a10.5 4 0 0 0 21 0" fill="none" stroke="#123a5c" strokeWidth="0.6" opacity="0.6" />
      <g transform="rotate(-18 20 21)">
        <ellipse
          cx="20"
          cy="21"
          rx="16"
          ry="5.5"
          fill="none"
          stroke="#dff1ff"
          strokeWidth="1.6"
          strokeDasharray="36 36"
          strokeDashoffset="0"
        />
        <rect x="27.4" y="8.6" width="2.6" height="2.6" rx="0.6" fill="#e8f4ff" />
      </g>
    </svg>
  );
}

export default function BrandPanel({
  theme = DEFAULT_THEME,
  compact = false,
  live = false,
}: {
  theme?: BroadcastTheme;
  compact?: boolean;
  /** Show the pulsing LIVE badge — true only while the auto-director is
   *  actively driving the broadcast; an idle/off director isn't "on air". */
  live?: boolean;
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
        {theme.iconVariant === "orbit" ? (
          <OrbitMark size={compact ? 26 : 34} accent={theme.accent} />
        ) : (
          <svg width={compact ? 26 : 34} height={compact ? 26 : 34} viewBox="0 0 40 40" aria-hidden>
            <circle cx="20" cy="20" r="18" fill="none" stroke={theme.accent} strokeWidth="2" />
            <circle cx="20" cy="20" r="18" fill="rgba(120,190,255,0.06)" />
            <path d="M13 12h9a6 6 0 0 1 0 12h-9z M22 24l6 5" fill="none" stroke="#cfe2ff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
        <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.15 }}>
          <span
            style={{
              fontSize: compact ? 15 : 19,
              fontWeight: 800,
              letterSpacing: 1.3,
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
          {theme.strapline && !compact && (
            <span
              style={{
                fontSize: 8,
                fontWeight: 600,
                letterSpacing: 1.4,
                color: "#5f87ad",
                opacity: 0.85,
                marginTop: 1,
                fontFamily: "system-ui, sans-serif",
              }}
            >
              {theme.strapline}
            </span>
          )}
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        {live && (
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "4px 10px 4px 8px",
              clipPath: "polygon(6px 0, 100% 0, 100% calc(100% - 6px), calc(100% - 6px) 100%, 0 100%, 0 6px)",
              background: "linear-gradient(180deg, rgba(40,6,6,0.95), rgba(20,3,3,0.95))",
              border: `1px solid ${LIVE_RED}8c`,
              fontFamily: "system-ui, sans-serif",
              fontSize: 11,
              fontWeight: 800,
              letterSpacing: 1.5,
              color: "#fff",
              textShadow: `0 0 8px ${LIVE_RED}cc`,
              boxShadow: `0 0 14px ${LIVE_RED}73, inset 0 0 8px ${LIVE_RED}33`,
            }}
          >
            <span
              style={{
                width: 7,
                height: 7,
                borderRadius: "50%",
                background: "#fff",
                boxShadow: `0 0 6px ${LIVE_RED}`,
                animation: "bcast-livepulse 1.4s ease-in-out infinite",
              }}
            />
            LIVE
          </div>
        )}
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
          {clock} <span style={{ opacity: 0.6, fontWeight: 500 }}>UTC</span>
        </span>
      </div>
    </div>
  );
}
