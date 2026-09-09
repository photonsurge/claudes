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
import { SEVERITY_COLORS, SEVERITY_LABELS } from "@photonsurge/shared/alerts/severity";
import { sortedAlerts, freshAlerts, issuedAgoLabel, FRESH_ALERT_WINDOW_MIN, alertLabel, alertAreaLabel } from "../../lib/broadcast";
import type { City } from "../../lib/cities";
import { GODS_FILL, INK, INK_DIM, MONO, SANS } from "./GodsPanel";
import { accentBorder, DEFAULT_THEME, type BroadcastTheme } from "./config";

/** Seconds each alert holds on screen before advancing to the next. */
const HOLD_MS = 10000;

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

  const area = alertAreaLabel(top, cities);
  const severity = top.properties.level ?? SEVERITY_LABELS[top.properties.severityRank];

  return (
    <section aria-label="New weather alert" style={{
      position: "relative", zIndex: 1, isolation: "isolate",
      width: compact ? 280 : 400, maxWidth: "100%", boxSizing: "border-box",
      padding: compact ? 12 : 16,
      backgroundColor: "#081420", backgroundImage: GODS_FILL,
      ...accentBorder(`1px solid ${color}66`, `3px solid ${color}`),
      borderRadius: 8, boxShadow: "0 8px 26px rgba(0,0,0,0.45)",
      pointerEvents: "none", fontFamily: SANS, textAlign: "left",
      display: "flex", flexDirection: "column", gap: 8,
      overflowWrap: "anywhere", minWidth: 0,
    }}>
      <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: "4px 12px", fontFamily: MONO, fontSize: 10, color: INK_DIM }}>
        <span style={{ fontWeight: 700, letterSpacing: 1 }}>NEW ALERT</span>
        {list.length > 1 && <span>Alert {pos + 1} of {list.length}</span>}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: "6px 10px" }}>
        <div style={{ flex: "1 1 180px", fontSize: compact ? 17 : 20, fontWeight: 700, lineHeight: 1.25, color: INK }}>
          {alertLabel(top.properties)}
        </div>
        {severity && <span style={{ color, border: `1px solid ${color}88`, borderRadius: 4, padding: "2px 6px", fontSize: 11, fontWeight: 700 }}>Severity: {severity}</span>}
      </div>
      {area && <div style={{ color: INK, fontSize: 14, lineHeight: 1.4 }}>Area: {area}</div>}
      {ago && <div style={{ color: INK_DIM, fontSize: 11 }}>Issued {ago}</div>}
      {instruction && (
        <div style={{ borderTop: `1px solid ${color}44`, paddingTop: 8 }}>
          <div style={{ color, fontSize: 10, fontWeight: 700, letterSpacing: 1, marginBottom: 4 }}>OFFICIAL ADVICE</div>
          <div style={{ color: INK, fontSize: compact ? 12 : 13, lineHeight: 1.5,
            display: "-webkit-box", WebkitLineClamp: compact ? 3 : 4,
            WebkitBoxOrient: "vertical", overflow: "hidden", whiteSpace: "pre-line" }}>
            {instruction}
          </div>
        </div>
      )}
    </section>
  );
}
