"use client";

/**
 * A sponsor's turn in the top-right NEW ALERTS slot — the same chamfered plate
 * as the warning card, tagged SPONSORED, carrying one "New alerts card"-placed
 * image creative (see shared/ads/alert-slot). It is its own card in the
 * rotation, never a strap on a warning: the brand and the hazard are on air
 * one after the other, not together. Sized to about a warning card's height
 * so the column below doesn't jump between turns. Pointer-inert like the
 * rest of /watch.
 */
import type { AlertSlotAd } from "@photonsurge/shared/ads/alert-slot";
import {
  GODS_FILL, GODS_TILE, GODS_TILE_BORDER, INK_DIM, INK_FAINT, MONO, SANS, accentRule, chamfer,
} from "./GodsPanel";

/** Media tile height (design px) — about what a warning with advice stands. */
const MEDIA_H = 132;
const MEDIA_H_COMPACT = 96;

export default function AlertSlotSponsorCard({
  ad,
  accent,
  compact = false,
}: {
  ad: AlertSlotAd;
  accent: string;
  compact?: boolean;
}) {
  const sponsor = (ad.advertiser?.trim() || ad.title).toUpperCase();
  return (
    <section aria-label="Sponsor message" data-testid="alert-slot-sponsor" style={{
      position: "relative", zIndex: 1, isolation: "isolate",
      width: compact ? 280 : 400, maxWidth: "100%", boxSizing: "border-box",
      flexShrink: 0,
      padding: compact ? "12px 16px" : "14px 24px",
      backgroundColor: "#081420", backgroundImage: GODS_FILL,
      border: `1px solid ${accent}66`, borderTop: `3px solid ${accent}`,
      clipPath: chamfer(8, 14),
      pointerEvents: "none", fontFamily: SANS, textAlign: "left",
      display: "flex", flexDirection: "column", gap: 8,
      minWidth: 0, overflow: "hidden",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ color: INK_FAINT, fontSize: 11.5, fontWeight: 600, letterSpacing: 3, whiteSpace: "nowrap" }}>
          SPONSORED
        </span>
        <span style={{ flex: 1, height: 1, background: accentRule(accent) }} />
        <span style={{
          color: INK_DIM, fontFamily: MONO, fontSize: 11, letterSpacing: 1.2,
          whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 200,
        }}>
          {sponsor}
        </span>
      </div>
      <div style={{
        position: "relative", height: compact ? MEDIA_H_COMPACT : MEDIA_H,
        background: GODS_TILE, border: `1px solid ${GODS_TILE_BORDER}`, overflow: "hidden",
      }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          key={ad.adId}
          src={ad.mediaUrl}
          alt={ad.title}
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "contain" }}
        />
      </div>
    </section>
  );
}
