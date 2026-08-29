/**
 * Advertisement domain types, shared by the public app (admin CRUD + serving)
 * and — later — the broadcast display + director. An ad is a piece of sponsor
 * creative (an image now; small video today, large video via GridFS later) plus
 * lightweight metadata. The media bytes live in Mongo and are streamed through a
 * dedicated route, so the wire `Ad` carries only metadata + enough to build the
 * media URL, never the bytes themselves.
 */

export type AdStatus = "active" | "inactive";

/**
 * Which broadcast surfaces an ad runs on. `break` = the auto-director's
 * commercial-break interstitial (the creative on screen); `ticker` = a
 * "Sponsored by …" text mention woven through the bottom crawl (name only —
 * the media never airs there); `billboard` = the always-on bottom-left corner
 * card rotating through the placed IMAGE creatives (video never airs there —
 * it stays on `break`). One ad can run on several; a doc stored before this
 * field existed reads as break-only, so the interstitial-era catalog never
 * leaks into the crawl or the corner.
 */
export type AdPlacement = "break" | "ticker" | "billboard";

export const AD_PLACEMENTS: AdPlacement[] = ["break", "ticker", "billboard"];

/** Operator-facing names for each placement (admin UI). */
export const AD_PLACEMENT_LABELS: Record<AdPlacement, string> = {
  break: "Ad break",
  ticker: "Ticker mention",
  billboard: "Bottom-left billboard",
};

/** Which kind of creative the bytes are. Drives how the viewer renders it. */
export type AdMediaType = "image" | "video";

/**
 * Where the media bytes live. `inline` = on the ad doc (Mongo Buffer, fine for
 * images and short clips well under the 16 MB doc limit). `gridfs` is reserved
 * for large video: same metadata shape, bytes streamed from a GridFS bucket.
 * Storing the discriminator now means the video path is purely additive later.
 */
export type AdStorage = "inline" | "gridfs";

/** Image types accepted for upload. */
export const AD_IMAGE_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
] as const;

/** Video types accepted for upload (inline while under the size cap). */
export const AD_VIDEO_TYPES = ["video/mp4", "video/webm"] as const;

/**
 * Ceiling for inline (on-doc) media. Mongo caps a document at 16 MB; we keep a
 * margin for metadata. Anything larger is rejected until GridFS video lands.
 */
export const MAX_INLINE_AD_BYTES = 12 * 1024 * 1024;

/**
 * The serve URL for an ad's stored media, cache-busted by its last edit. Shared
 * so the worker (building a director segment) and the public client build the
 * exact same URL. `v` should be the ad's `updatedAt` (epoch ms).
 */
export function adMediaPath(adId: string, v?: number): string {
  return `/api/ads/${encodeURIComponent(adId)}/media?v=${v ?? 0}`;
}

/** Map an upload's content-type to a media kind, or null if unsupported. */
export function adMediaTypeFor(contentType: string): AdMediaType | null {
  const ct = contentType.toLowerCase().split(";")[0].trim();
  if ((AD_IMAGE_TYPES as readonly string[]).includes(ct)) return "image";
  if ((AD_VIDEO_TYPES as readonly string[]).includes(ct)) return "video";
  return null;
}

/** Editable metadata for an ad (everything except identity + the bytes). */
export interface AdMeta {
  title: string;
  status: AdStatus;
  /** Sponsor / advertiser display name. */
  advertiser?: string;
  /** Where the ad points (for reference now; click-through later). */
  clickUrl?: string;
  /** Tiebreaker when multiple ads are equally due in the rotation — higher wins. */
  weight: number;
  /** Broadcast surfaces this ad runs on (never empty — defaults to ["break"]). */
  placements: AdPlacement[];
  tags?: string[];
  notes?: string;
}

/** The canonical wire shape returned by the admin/serve APIs. No bytes. */
export interface Ad extends AdMeta {
  /** Stable id (the upsert/edit key), generated on create. */
  adId: string;
  mediaType: AdMediaType;
  /** MIME type of the stored media, e.g. "image/png", "video/mp4". */
  contentType: string;
  byteSize: number;
  width?: number;
  height?: number;
  storage: AdStorage;
  /** Epoch ms. */
  createdAt?: number;
  /** Epoch ms — also the media-URL cache-buster. */
  updatedAt?: number;
  /** Epoch ms this ad was last aired by the director, or undefined if never. */
  lastShownAt?: number;
  /** How many times this ad has aired (durable, across restarts). */
  timesShown?: number;
  /** Cumulative milliseconds this ad has actually been on screen (durable). */
  totalDisplayMs?: number;
}
