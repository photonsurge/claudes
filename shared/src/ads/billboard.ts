/**
 * Pure helpers for the bottom-left sponsor billboard — the always-on corner
 * card that rotates through every active `billboard`-placed IMAGE creative.
 * The serve route ships a deliberately lean wire shape (no weight/notes/tags —
 * the catalog's operator metadata never leaves the admin), and every channel
 * derives the SAME creative for a given wall-clock instant, so the rotation
 * needs no server coordination and multiple /watch outputs stay in step.
 * No I/O — unit-tested without a DB.
 */
import { adMediaPath, type Ad } from "./types";

/** How long each creative holds the corner before the rotation advances. */
export const BILLBOARD_HOLD_MS = 25_000;

/** What the /watch surface needs to render one billboard creative. Public. */
export interface BillboardAd {
  adId: string;
  title: string;
  advertiser?: string;
  /** Serve URL for the image bytes, cache-busted on the last edit. */
  mediaUrl: string;
  width?: number;
  height?: number;
}

/**
 * The rotation list: active + billboard-placed + image-only (a video ticked
 * onto the billboard simply never airs there), in a stable order every client
 * agrees on (title, then adId as the tiebreaker) so the shared clock index
 * below lands on the same creative everywhere.
 */
export function billboardAds(ads: Ad[]): BillboardAd[] {
  return ads
    .filter(
      (a) =>
        a.status === "active" &&
        a.placements.includes("billboard") &&
        a.mediaType === "image",
    )
    .sort((a, b) => a.title.localeCompare(b.title) || a.adId.localeCompare(b.adId))
    .map((a) => ({
      adId: a.adId,
      title: a.title,
      advertiser: a.advertiser,
      mediaUrl: adMediaPath(a.adId, a.updatedAt ?? a.createdAt),
      width: a.width,
      height: a.height,
    }));
}

/** Which creative holds the corner at `now` — a shared wall-clock rotation. */
export function billboardIndex(now: number, count: number, holdMs = BILLBOARD_HOLD_MS): number {
  if (count <= 0) return 0;
  return Math.floor(now / holdMs) % count;
}
