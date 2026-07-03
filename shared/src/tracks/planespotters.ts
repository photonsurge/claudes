/**
 * planespotters.net public photo lookup — ICAO24 hex → a representative photo of
 * that exact airframe (thumbnail URL + photographer credit + a link back to the
 * photo page). Keyless (the `/pub/` API), community-sourced. One airframe per
 * call, so callers MUST cache results and rate-limit; photos change rarely.
 * Network is injectable for tests.
 *
 * planespotters' terms require crediting the photographer and linking back — we
 * carry both so the on-air card can attribute the shot.
 */

export interface AircraftPhoto {
  /** Best thumbnail URL for the card (thumbnail_large, else thumbnail). */
  photoUrl: string;
  /** Photographer name, for attribution. */
  photoCredit?: string;
  /** Link back to the photo page (planespotters requires attribution + link). */
  photoLink?: string;
}

const PLANESPOTTERS_URL = "https://api.planespotters.net/pub/photos/hex/";

const clean = (v: unknown): string | undefined => {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t ? t : undefined;
};

/**
 * Look up one airframe's photo by ICAO24 hex. Returns null on a bad hex, network
 * error, non-OK response, or when no photo exists (so the caller can throttle
 * retries the same way it caches hits).
 */
export async function fetchAircraftPhoto(
  icao24: string,
  fetchImpl: typeof fetch = fetch,
): Promise<AircraftPhoto | null> {
  const hex = (icao24 ?? "").trim().toLowerCase();
  if (!/^[0-9a-f]{6}$/.test(hex)) return null;

  let res: Response;
  try {
    res = await fetchImpl(`${PLANESPOTTERS_URL}${hex}`, { headers: { Accept: "application/json" } });
  } catch {
    return null;
  }
  if (!res.ok) return null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const j = (await res.json().catch(() => null)) as any;
  const photo = Array.isArray(j?.photos) ? j.photos[0] : undefined;
  if (!photo || typeof photo !== "object") return null;

  // Prefer the larger thumbnail; both nest the URL under `.src`.
  const url = clean(photo.thumbnail_large?.src) ?? clean(photo.thumbnail?.src);
  if (!url) return null;

  return {
    photoUrl: url,
    photoCredit: clean(photo.photographer),
    photoLink: clean(photo.link),
  };
}
