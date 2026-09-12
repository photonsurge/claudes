/**
 * Pure helpers for the "New alerts card" sponsor placement — the top-right
 * NEW ALERTS slot mixing sponsor cards into its just-issued-warnings rotation.
 * The wire shape and the image-only filter are the billboard's (one lean
 * public shape for every placed-image surface); the planner below decides
 * whose turn the slot is. A sponsor always gets its OWN card — the brand and
 * a hazard air one after the other, never on the same plate — and when nothing
 * fresh has been issued the sponsors hold the slot alone, so the area earns
 * its keep on a quiet day instead of standing empty. No I/O — unit-tested.
 */
import { placedImageAds, type BillboardAd } from "./billboard";
import type { Ad } from "./types";

/** What the /watch surface needs to render one sponsor turn. Public. */
export type AlertSlotAd = BillboardAd;

/** Active + alertSlot-placed image creatives, in the shared stable order. */
export function alertSlotAds(ads: Ad[]): AlertSlotAd[] {
  return placedImageAds(ads, "alertSlot");
}

/** Warnings aired between sponsor turns (fewer when fewer are fresh). */
export const ALERT_SLOT_EVERY = 2;

export type AlertSlot =
  | { kind: "alert"; index: number }
  | { kind: "sponsor"; index: number };

/**
 * Whose turn the slot is on tick `idx` — a counter that only ever grows, so the
 * warning and sponsor lists can change underneath it without a reset. With
 * both present the rotation runs `every` DISTINCT warnings then one sponsor
 * (a single fresh warning alternates with the sponsors rather than repeating
 * itself back-to-back); sponsors take turns in order so each gets airtime.
 * Null when there is nothing to show at all.
 */
export function alertSlotAt(
  idx: number,
  alertCount: number,
  sponsorCount: number,
  every = ALERT_SLOT_EVERY,
): AlertSlot | null {
  if (alertCount <= 0 && sponsorCount <= 0) return null;
  if (sponsorCount <= 0) return { kind: "alert", index: idx % alertCount };
  if (alertCount <= 0) return { kind: "sponsor", index: idx % sponsorCount };
  const run = Math.max(1, Math.min(every, alertCount));
  const cycle = run + 1;
  const k = Math.floor(idx / cycle);
  const r = idx % cycle;
  if (r === run) return { kind: "sponsor", index: k % sponsorCount };
  return { kind: "alert", index: (k * run + r) % alertCount };
}
