/**
 * Pure helpers for cleaning/validating a sea-point record before it hits the
 * DB. Shared by the admin add/edit form and the seed script, so both paths
 * produce the same canonical `SeaPoint`. No I/O here — easy to unit test.
 */
import type { SeaPoint } from "./types";

export const isValidLat = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v) && v >= -90 && v <= 90;

export const isValidLng = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v) && v >= -180 && v <= 180;

const trimOrUndef = (v: unknown): string | undefined => {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t.length ? t : undefined;
};

const DIACRITICS_RE = new RegExp("[̀-ͯ]", "g");

const slugify = (s: string): string =>
  s
    .normalize("NFD")
    .replace(DIACRITICS_RE, "") // strip diacritics, e.g. "Nino" (from "Niño")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

/**
 * Validate + canonicalise an arbitrary input into a `SeaPoint`. Returns null
 * when the record is unusable (missing name or an out-of-range coordinate) so
 * callers can reject rather than persist junk. `pointId` is derived from the
 * name when not supplied.
 */
export function normaliseSeaPoint(input: Record<string, unknown>): SeaPoint | null {
  const name = trimOrUndef(input.name);
  if (!name) return null;
  const pointId = trimOrUndef(input.pointId) ?? slugify(name);
  if (!pointId) return null;
  if (!isValidLat(input.lat) || !isValidLng(input.lng)) return null;

  const zoomRaw = Number(input.zoom);
  const zoom = Number.isFinite(zoomRaw) && zoomRaw > 0 ? zoomRaw : 4;

  return {
    pointId,
    name,
    blurb: trimOrUndef(input.blurb) ?? "",
    lat: input.lat as number,
    lng: input.lng as number,
    zoom,
    depthCycle: Boolean(input.depthCycle),
    enabled: input.enabled === undefined ? true : Boolean(input.enabled),
  };
}
