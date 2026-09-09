"use client";

/**
 * Right-column "NEW ALERTS" panel: cycles through only the JUST-ISSUED warnings
 * (issued within the last ~hour — see freshAlerts), de-duped and most-severe
 * first, one at a time in a hazard-tinted card. The card sizes to what the
 * warning actually carries: it used to hold a fixed 214px open, so any alert
 * whose source ships no advice text (most of them) went to air as a title
 * floating above a third of a card of empty fill. A warning surfaces when
 * it's issued, holds for about an hour, then drops off on its own even if the
 * hazard is still active, so the panel reads as breaking news rather than a
 * standing list (the always-on World Watch panel is the comprehensive view).
 * Renders nothing when nothing has been issued recently.
 */
import { useEffect, useState } from "react";
import type { AlertFeature } from "../../lib/alerts";
import { SEVERITY_COLORS, SEVERITY_LABELS } from "@photonsurge/shared/alerts/severity";
import {
  sortedAlerts, freshAlerts, issuedAgoLabel, expiresInLabel, alertDetail,
  FRESH_ALERT_WINDOW_MIN, alertLabel, alertAreaLabel,
} from "../../lib/broadcast";
import type { City } from "../../lib/cities";
import { GODS_FILL, INK, INK_DIM, MONO, SANS, chamfer } from "./GodsPanel";
import { DEFAULT_THEME, type BroadcastTheme } from "./config";

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
  const ago = issuedAgoLabel(top.properties.sent ?? top.properties.since, now);
  const runsFor = expiresInLabel(top.properties.expires, now);

  const area = alertAreaLabel(top, cities);
  const severity = top.properties.level ?? SEVERITY_LABELS[top.properties.severityRank];
  // Advice if the source gave any, else a headline that earns its space (see
  // alertDetail) — and nothing at all rather than an empty section.
  const detail = alertDetail(top.properties, area);
  // The overlay draws DISSOLVED shapes, so one card can stand for dozens of
  // county warnings; say so instead of implying it's a single county's.
  const members = top.properties.memberCount ?? 0;
  const timing = [ago && `Issued ${ago}`, runsFor && `runs ${runsFor} more`].filter(Boolean).join(" · ");

  return (
    <section aria-label="New weather alert" style={{
      position: "relative", zIndex: 1, isolation: "isolate",
      width: compact ? 280 : 400, maxWidth: "100%", boxSizing: "border-box",
      // Height follows the content. No cap is needed: every text block below is
      // line-clamped, so the card tops out around the old fixed 214 — and a
      // cap would clip the footer off the tallest cards instead.
      // The floor only catches the sparsest card (no area line); a card with a
      // title and an area already measures past it, so nothing is padded out.
      minHeight: compact ? 132 : 124, flexShrink: 0,
      padding: compact ? "12px 16px" : "14px 24px",
      backgroundColor: "#081420", backgroundImage: GODS_FILL,
      border: `1px solid ${color}66`, borderTop: `3px solid ${color}`,
      clipPath: chamfer(8, 14),
      pointerEvents: "none", fontFamily: SANS, textAlign: "left",
      display: "flex", flexDirection: "column", gap: 6,
      overflowWrap: "break-word", minWidth: 0, overflow: "hidden",
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, fontFamily: MONO, fontSize: 10 }}>
        <span style={{ fontWeight: 700, letterSpacing: 1.5, color }}>NEW ALERT</span>
        <span style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          {members > 1 && <span style={{ color: INK_DIM, letterSpacing: 0.8 }}>{members} WARNINGS</span>}
          {severity && <span aria-label={`Severity: ${severity}`} style={{ color, fontWeight: 700, letterSpacing: 0.8, textTransform: "uppercase" }}>{severity}</span>}
        </span>
      </div>
      <div style={{ fontSize: compact ? 19 : 22, fontWeight: 700, lineHeight: 1.2, color: INK,
        display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden", flexShrink: 0 }}>
        {alertLabel(top.properties)}
      </div>
      {area && <div style={{ color: INK, fontSize: 14, lineHeight: 1.35, flexShrink: 0,
        display: "-webkit-box", WebkitLineClamp: 1, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{area}</div>}
      {detail && (
        <div style={{ borderTop: `1px solid ${color}44`, paddingTop: 7, minHeight: 0 }}>
          <div style={{ color, fontSize: 9, fontWeight: 700, letterSpacing: 1, marginBottom: 3 }}>{detail.label}</div>
          <div style={{ color: INK, fontSize: 12, lineHeight: 1.4,
            display: "-webkit-box", WebkitLineClamp: 3,
            WebkitBoxOrient: "vertical", overflow: "hidden", whiteSpace: "normal" }}>
            {detail.text}
          </div>
        </div>
      )}
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginTop: "auto", paddingTop: 6, flexShrink: 0, fontFamily: MONO, fontSize: 10, color: INK_DIM }}>
        <span>{timing || "Latest warning"}</span>
        {list.length > 1 && <span>Alert {pos + 1} of {list.length}</span>}
      </div>
    </section>
  );
}
