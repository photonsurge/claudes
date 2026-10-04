"use client";

/**
 * The on-air credit for a viewer's chat pick: "VIEWER PICK · Deep · @rich ·
 * 5 min" for a few seconds when a pick lands, then a compact countdown while
 * it holds. A flat plate in the theme's tokens (no drop shadow), bottom-centre
 * above the crawl. The channel's "on-air chip" switch on its Chat commands card
 * hides it.
 */
import { useEffect, useState } from "react";
import type { ViewerRequest } from "@photonsurge/shared/viewer";
import type { BroadcastTheme } from "./config";
import { UI_SANS } from "../../lib/fonts";

/** How long a new pick is announced in full before shrinking to a countdown. */
export const ANNOUNCE_MS = 6000;

const SLOT_WORD: Record<ViewerRequest["slot"], string> = { audioMode: "Music", theme: "Palette" };

export function remainingLabel(until: number, now: number): string {
  const s = Math.max(0, Math.round((until - now) / 1000));
  return s >= 60 ? `${Math.ceil(s / 60)} min` : `${s}s`;
}

export default function ViewerPickChip({
  picks,
  theme,
}: {
  picks: ViewerRequest[];
  theme: BroadcastTheme;
}) {
  const [now, setNow] = useState(() => Date.now());
  const active = picks.length > 0;
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  if (!active) return null;

  return (
    <div
      aria-label="Viewer picks"
      style={{
        position: "absolute",
        left: "50%",
        bottom: 96,
        transform: "translateX(-50%)",
        display: "flex",
        gap: 10,
        pointerEvents: "none",
        fontFamily: UI_SANS,
        zIndex: 5,
      }}
    >
      {picks.map((p) => {
        const fresh = now - p.requestedAt < ANNOUNCE_MS && p.until - p.holdMs + ANNOUNCE_MS > now;
        return (
          <div
            key={p.slot}
            style={{
              padding: "6px 14px",
              borderRadius: 999,
              background: theme.panelBg,
              border: theme.panelBorder,
              color: theme.titleColor,
              fontSize: 15,
              fontWeight: 700,
              letterSpacing: 0.6,
              whiteSpace: "nowrap",
            }}
          >
            <span style={{ color: theme.accent, fontWeight: 900, letterSpacing: 1.6 }}>VIEWER PICK</span>
            {fresh
              ? ` · ${SLOT_WORD[p.slot]}: ${p.label} · @${p.by.author} · ${remainingLabel(p.until, now)}`
              : ` · ${p.label} · ${remainingLabel(p.until, now)}`}
          </div>
        );
      })}
    </div>
  );
}
