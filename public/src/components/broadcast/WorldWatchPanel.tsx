"use client";

/**
 * Top-right "ACTIVE FEED": a live list that constantly scrolls through every
 * broadcast-worthy active warning and recent earthquake, most-serious first.
 * A separate, smaller card that sits below WorldSituationPanel (the hero
 * tally) — split apart so the "how much" headline and the "which ones" detail
 * each read as their own block instead of one crowded panel. Unlike the
 * single-event LiveAlertPanel it never hides and doesn't follow the
 * operator's show-alerts/seismic toggles: it pulls its own global feed (see
 * useWorldWatch) so the broadcast always carries a rolling state-of-the-world
 * readout. Pointer-inert like the rest of the chrome.
 *
 * Takes the shared tally as a prop rather than calling useWorldWatch itself —
 * BroadcastFrame fetches it once (already flavoured with the nearest-city flag
 * via its own `cities` argument) and hands the same result to this AND
 * WorldSituationPanel, so the (potentially 5000-row) global fetch never
 * doubles up.
 */
import type { WorldWatchState } from "../../lib/world-watch";
import { DEFAULT_THEME, GLASS_BG, type BroadcastTheme } from "./config";
import WorldFeed from "./WorldFeed";

export default function WorldWatchPanel({
  worldWatch,
  theme = DEFAULT_THEME,
}: {
  worldWatch: WorldWatchState;
  theme?: BroadcastTheme;
}) {
  return (
    <div
      style={{
        position: "relative",
        width: 400,
        padding: "14px 20px 18px",
        background: GLASS_BG,
        border: theme.panelBorder,
        borderRadius: 14,
        boxShadow: "0 10px 32px rgba(0,0,0,0.45)",
        backdropFilter: "blur(11px)",
        WebkitBackdropFilter: "blur(11px)",
        pointerEvents: "none",
        fontFamily: "system-ui, sans-serif",
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      <div
        style={{
          fontSize: 12.1,
          fontWeight: 800,
          letterSpacing: 1.6,
          color: theme.accent,
          borderBottom: `2px solid ${theme.accent}55`,
          paddingBottom: 4,
        }}
      >
        ACTIVE FEED
      </div>

      <WorldFeed items={worldWatch.feed} />
    </div>
  );
}
