"use client";

/**
 * Top-centre "LIVE ALERT PANEL": constantly cycles through EVERY active alert
 * (de-duped, most-severe first), one at a time in a pulsing hazard-tinted card,
 * so the broadcast rolls through the whole warning list instead of freezing on
 * the single worst one. Renders nothing when nothing is active.
 */
import { useEffect, useState } from "react";
import type { AlertFeature } from "../../lib/alerts";
import { SEVERITY_COLORS } from "@photonsurge/shared/alerts/severity";
import { sortedAlerts, alertBannerText } from "../../lib/broadcast";
import type { City } from "../../lib/cities";
import { accentBorder, DEFAULT_THEME, type BroadcastTheme } from "./config";

/** Seconds each alert holds on screen before advancing to the next. */
const HOLD_MS = 5000;

export default function LiveAlertPanel({
  alerts,
  cities = [],
  theme = DEFAULT_THEME,
  compact = false,
}: {
  alerts: AlertFeature[];
  /** For the areaDesc-missing fallback (nearest notable city) — mirrors WorldWatchPanel. */
  cities?: City[];
  theme?: BroadcastTheme;
  compact?: boolean;
}) {
  const list = sortedAlerts(alerts);
  const [idx, setIdx] = useState(0);

  // Advance on a timer; the modulo keeps us in range as the list grows/shrinks.
  useEffect(() => {
    if (list.length <= 1) return;
    const iv = setInterval(() => setIdx((n) => n + 1), HOLD_MS);
    return () => clearInterval(iv);
  }, [list.length]);

  if (list.length === 0) return null;
  const pos = idx % list.length;
  const top = list[pos];
  const color = SEVERITY_COLORS[top.properties.severityRank] ?? theme.accent;
  const instruction = top.properties.translatedInstruction || top.properties.instruction;

  return (
    <div
      style={{
        position: "relative",
        maxWidth: compact ? 240 : 340,
        padding: compact ? "8px 26px 8px 11px" : "10px 30px 10px 14px",
        background: theme.panelBg,
        ...accentBorder(`1px solid ${color}66`, `3px solid ${color}`),
        borderRadius: 10,
        boxShadow: `0 8px 26px rgba(0,0,0,0.45), 0 0 14px ${color}33`,
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
        pointerEvents: "none",
        fontFamily: "system-ui, sans-serif",
        textAlign: "right",
      }}
    >
      <style>{"@keyframes bcast-alertpulse{0%,100%{opacity:1}50%{opacity:0.5}}"}</style>
      {/* Right-edge vertical status tab (reference "[ISSUED]" flag). */}
      <div
        style={{
          position: "absolute",
          top: 0,
          bottom: 0,
          right: 0,
          width: 18,
          background: color,
          borderRadius: "0 9px 9px 0",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#fff",
          fontSize: 8,
          fontWeight: 800,
          letterSpacing: 2,
          writingMode: "vertical-rl",
          textShadow: "0 1px 1px rgba(0,0,0,0.5)",
        }}
      >
        ISSUED
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "flex-end",
          gap: 8,
          fontSize: 9,
          fontWeight: 800,
          letterSpacing: 1.4,
          color: "#9fb0c8",
          marginBottom: 3,
        }}
      >
        <span>LIVE ALERT PANEL</span>
        {list.length > 1 ? (
          <span style={{ color, letterSpacing: 1 }}>
            {pos + 1}/{list.length}
          </span>
        ) : null}
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "flex-end",
          gap: 7,
          fontSize: compact ? 12 : 14,
          fontWeight: 700,
          color,
          textShadow: "0 1px 2px rgba(0,0,0,0.8)",
        }}
      >
        <span>{alertBannerText(top, cities)}</span>
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: color,
            boxShadow: `0 0 8px ${color}`,
            animation: "bcast-alertpulse 1.2s ease-in-out infinite",
            flex: "0 0 auto",
          }}
        />
      </div>
      {instruction && (
        <div
          style={{
            marginTop: 4,
            fontSize: compact ? 10 : 11,
            fontWeight: 500,
            color: "#c9d3e3",
            textShadow: "0 1px 2px rgba(0,0,0,0.8)",
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          {instruction}
        </div>
      )}
    </div>
  );
}
