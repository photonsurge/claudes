/**
 * Pure helpers for cleaning/validating a webcam record before it hits the DB.
 * Shared by manual admin entry and (later) the Windy catalog ingest, so both
 * paths produce the same canonical `Cam`. No I/O here — easy to unit test.
 */
import type {
  Cam,
  CamProvider,
  CamStatus,
  CamStreamKind,
  CamLiveStream,
  CamAttribution,
} from "./types";

const PROVIDERS: CamProvider[] = [
  "windy",
  "tfl",
  "national_highways",
  "youtube",
  "manual",
  "other",
];
const STATUSES: CamStatus[] = ["active", "inactive", "unknown"];
const STREAM_KINDS: CamStreamKind[] = ["hls", "youtube", "mp4", "iframe"];

export const isValidLat = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v) && v >= -90 && v <= 90;

export const isValidLng = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v) && v >= -180 && v <= 180;

const trimOrUndef = (v: unknown): string | undefined => {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t.length ? t : undefined;
};

const oneOf = <T extends string>(v: unknown, allowed: T[], fallback: T): T =>
  typeof v === "string" && (allowed as string[]).includes(v) ? (v as T) : fallback;

/**
 * YouTube live cams are pasted in many shapes (watch URL, youtu.be, bare id).
 * Pull out the 11-char video id so the viewer can build a stable embed URL.
 */
export function youtubeId(input: string): string | undefined {
  const s = input.trim();
  const idRe = /^[A-Za-z0-9_-]{11}$/;
  if (idRe.test(s)) return s;
  const m =
    s.match(/[?&]v=([A-Za-z0-9_-]{11})/) ||
    s.match(/youtu\.be\/([A-Za-z0-9_-]{11})/) ||
    s.match(/youtube\.com\/(?:embed|live|shorts)\/([A-Za-z0-9_-]{11})/);
  return m ? m[1] : undefined;
}

/** Build a normalised live-stream descriptor, inferring `kind` when omitted. */
export function normaliseLive(
  input: { kind?: unknown; url?: unknown } | undefined | null,
): CamLiveStream | undefined {
  if (!input) return undefined;
  const url = trimOrUndef(input.url);
  if (!url) return undefined;
  let kind = oneOf<CamStreamKind>(input.kind, STREAM_KINDS, "" as CamStreamKind);
  if (!kind) {
    if (youtubeId(url)) kind = "youtube";
    else if (/\.m3u8(\?|$)/i.test(url)) kind = "hls";
    else if (/\.mp4(\?|$)/i.test(url)) kind = "mp4";
    else kind = "iframe";
  }
  if (kind === "youtube") {
    const id = youtubeId(url);
    return { kind, url: id ?? url };
  }
  return { kind, url };
}

/** Build a clean attribution block, dropping it entirely if there's no provider. */
export function normaliseAttribution(
  input: { provider?: unknown; requiredText?: unknown; linkUrl?: unknown } | undefined | null,
): CamAttribution | undefined {
  if (!input) return undefined;
  const provider = trimOrUndef(input.provider);
  if (!provider) return undefined;
  return {
    provider,
    requiredText: trimOrUndef(input.requiredText),
    linkUrl: trimOrUndef(input.linkUrl),
  };
}

/**
 * Validate + canonicalise an arbitrary input into a `Cam`. Returns null when
 * the record is unusable (missing id/title or an out-of-range coordinate) so
 * callers can reject rather than persist junk. A cam with neither an image,
 * timelapse, player nor live stream is allowed (status just stays "unknown"):
 * we may catalog its location before media is wired up.
 */
export function normaliseCam(input: Record<string, unknown>): Cam | null {
  const camId = trimOrUndef(input.camId) ?? trimOrUndef(input.id);
  const title = trimOrUndef(input.title) ?? trimOrUndef(input.name);
  if (!camId || !title) return null;
  if (!isValidLat(input.lat) || !isValidLng(input.lng)) return null;

  const live = normaliseLive(input.live as { kind?: unknown; url?: unknown });
  const tags = Array.isArray(input.tags)
    ? Array.from(
        new Set(
          input.tags
            .map((t) => trimOrUndef(t))
            .filter((t): t is string => Boolean(t)),
        ),
      )
    : undefined;

  const fetchedAtRaw = input.fetchedAt;
  const fetchedAt =
    typeof fetchedAtRaw === "number" && Number.isFinite(fetchedAtRaw)
      ? fetchedAtRaw
      : undefined;

  return {
    camId,
    provider: oneOf<CamProvider>(input.provider, PROVIDERS, "manual"),
    title,
    lat: input.lat as number,
    lng: input.lng as number,
    status: oneOf<CamStatus>(input.status, STATUSES, "unknown"),
    place: trimOrUndef(input.place),
    country: trimOrUndef(input.country),
    imageUrl: trimOrUndef(input.imageUrl),
    timelapseUrl: trimOrUndef(input.timelapseUrl),
    playerUrl: trimOrUndef(input.playerUrl),
    live,
    tags: tags && tags.length ? tags : undefined,
    attribution: normaliseAttribution(
      input.attribution as { provider?: unknown; requiredText?: unknown; linkUrl?: unknown },
    ),
    fetchedAt,
  };
}
