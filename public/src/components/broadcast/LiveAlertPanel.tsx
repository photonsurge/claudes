"use client";

/**
 * Top-centre "NEW ALERTS" panel: cycles through only the JUST-ISSUED warnings
 * (issued within the last ~hour — see freshAlerts), de-duped and most-severe
 * first, one at a time in a pulsing hazard-tinted card. A warning surfaces when
 * it's issued, holds for about an hour, then drops off on its own even if the
 * hazard is still active, so the panel reads as breaking news rather than a
 * standing list (the always-on World Watch panel is the comprehensive view).
 * Renders nothing when nothing has been issued recently.
 */
import { useEffect, useState } from "react";
import type { AlertFeature } from "../../lib/alerts";
import { SEVERITY_COLORS } from "@photonsurge/shared/alerts/severity";
import { sortedAlerts, freshAlerts, issuedAgoLabel, FRESH_ALERT_WINDOW_MIN, alertBannerText } from "../../lib/broadcast";
import type { City } from "../../lib/cities";
import { accentBorder, DEFAULT_THEME, type BroadcastTheme } from "./config";

/** Seconds each alert holds on screen before advancing to the next. */
const HOLD_MS = 5000;

export default function LiveAlertPanel({
  alerts,
  cities = [],
  theme = DEFAULT_THEME,
  compact = false,
  windowMinutes = FRESH_ALERT_WINDOW_MIN,
}: {
  alerts: AlertFeature[];
  /** For the areaDesc-missing fallback (nearest notable city) — mirrors WorldWatchPanel. */
  cities?: City[];
  theme?: BroadcastTheme;
  compact?: boolean;
  /** How long a just-issued alert keeps showing before it ages off (minutes). */
  windowMinutes?: number;
}) {
  // Live clock, so alerts age out of the window on their own and the "Xm ago"
  // label stays honest. Starts at 0 (SSR-safe: identical on server + first
  // client render — no timestamp is fresh yet); the effect sets the real time on
  // mount and every 30s after.
  const [now, setNow] = useState(0);
  useEffect(() => {
    setNow(Date.now());
    const iv = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(iv);
  }, []);

  const list = sortedAlerts(freshAlerts(alerts, windowMinutes, now));
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
  const ago = issuedAgoLabel(top.properties.sent ?? top.properties.since, now);

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
          fontSize: 8.8,
          fontWeight: 800,
          letterSpacing: 2,
          writingMode: "vertical-rl",
          textShadow: "0 1px 1px rgba(0,0,0,0.5)",
        }}
      >
        NEW
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "flex-end",
          gap: 8,
          fontSize: 9.9,
          fontWeight: 800,
          letterSpacing: 1.4,
          color: theme.mutedColor,
          marginBottom: 3,
        }}
      >
        <span>NEW ALERTS</span>
        {ago ? <span style={{ color, letterSpacing: 1, fontWeight: 700 }}>ISSUED {ago.toUpperCase()}</span> : null}
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
          fontSize: compact ? 13.2 : 15.4,
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
            fontSize: compact ? 11 : 12.1,
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
