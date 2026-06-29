import type { Quake } from "./types";

/**
 * USGS earthquake feeds (GeoJSON). Keyless and public. The feed name encodes a
 * magnitude floor + lookback window, e.g. "2.5_day" = M2.5+ in the past day,
 * "all_hour" = everything in the past hour. The worker polls one feed into Mongo;
 * the public app only ever reads the cached copy.
 * Docs: https://earthquake.usgs.gov/earthquakes/feed/v1.0/geojson.php
 */
const FEED_BASE = "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary";

/** Valid USGS summary feed ids (magnitude floor × period). */
export const USGS_FEEDS = [
  "significant_hour", "all_hour", "4.5_hour", "2.5_hour", "1.0_hour",
  "significant_day", "all_day", "4.5_day", "2.5_day", "1.0_day",
  "significant_week", "all_week", "4.5_week", "2.5_week", "1.0_week",
  "significant_month", "all_month", "4.5_month", "2.5_month", "1.0_month",
] as const;

export type UsgsFeed = (typeof USGS_FEEDS)[number];

export const DEFAULT_USGS_FEED: UsgsFeed = "2.5_day";

export const isValidFeed = (feed: string): feed is UsgsFeed =>
  (USGS_FEEDS as readonly string[]).includes(feed);

interface UsgsFeature {
  id?: string;
  properties?: {
    mag?: number | null;
    place?: string | null;
    time?: number | null;
    url?: string | null;
    tsunami?: number | null;
  } | null;
  geometry?: { type?: string; coordinates?: number[] } | null;
}

/** Parse a USGS GeoJSON FeatureCollection into `Quake[]`. */
export function parseUsgs(json: unknown): Quake[] {
  const features = (json as { features?: unknown[] } | null)?.features;
  if (!Array.isArray(features)) return [];

  const out: Quake[] = [];
  for (const f of features as UsgsFeature[]) {
    const coords = f.geometry?.coordinates;
    const id = String(f.id ?? "").trim();
    if (!id || !Array.isArray(coords) || coords.length < 2) continue;
    const [lng, lat, depthKm] = coords;
    if (typeof lng !== "number" || typeof lat !== "number") continue;
    const p = f.properties ?? {};
    if (typeof p.mag !== "number") continue;
    out.push({
      id,
      mag: p.mag,
      place: p.place ?? undefined,
      time: typeof p.time === "number" ? p.time : 0,
      lng,
      lat,
      depthKm: typeof depthKm === "number" ? depthKm : 0,
      url: p.url ?? undefined,
      tsunami: p.tsunami ? true : undefined,
    });
  }
  return out;
}

/** Fetch and parse a USGS summary feed. Defaults to M2.5+ over the past day. */
export async function fetchQuakes(feed: string = DEFAULT_USGS_FEED): Promise<Quake[]> {
  const f = isValidFeed(feed) ? feed : DEFAULT_USGS_FEED;
  const res = await fetch(`${FEED_BASE}/${f}.geojson`, {
    headers: { "User-Agent": "LiveWeatherGlobe/0.1 (personal weather globe)" },
  });
  if (!res.ok) throw new Error(`usgs fetch failed: ${res.status} ${res.statusText}`);
  return parseUsgs(await res.json());
}
