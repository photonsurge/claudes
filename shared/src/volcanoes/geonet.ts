import { normalizeVolcanoStatus, type NormalizedVolcanoLevel } from "./diff";

/**
 * GeoNet (New Zealand) Volcanic Alert Levels — the official monitoring status for
 * NZ volcanoes (Ruapehu, Whakaari/White Island, Tongariro, Taranaki…). Levels run
 * 0 (no unrest) → 5 (major eruption). This is an OFFICIAL observatory feed, so it
 * outranks the GVP weekly bulletin for these volcanoes (source-priority rule).
 *
 * Its ids are GeoNet slugs (`ruapehu`), NOT GVP numbers, so a caller must
 * crosswalk each entry onto our `gvp:<vnum>` doc (see the worker's snapshotGeonet
 * + volcano_source_links). Verified live shape: FeatureCollection, each feature
 * `properties` = { acc (colour word), activity, hazards, level (0–5), volcanoID,
 * volcanoTitle }, geometry.coordinates = [lng, lat].
 */
export const GEONET_VAL_URL = process.env.GEONET_VAL_URL || "https://api.geonet.org.nz/volcano/val";

export interface GeonetVolcano {
  /** GeoNet slug, e.g. "ruapehu" (the crosswalk key). */
  externalId: string;
  name: string;
  lat: number;
  lng: number;
  /** Raw Volcanic Alert Level 0–5, as a string (preserved verbatim). */
  levelRaw: string;
  /** Colour word ("Green"/"Yellow"/…). */
  colour: string;
  /** Short activity sentence from the feed. */
  activity: string;
  /** Normalised level for scoring/promotion. */
  normalized: NormalizedVolcanoLevel;
  /** Above background (level ≥ 1) — worth crosswalking + tracking. */
  elevated: boolean;
}

/** Pure parse of the GeoNet VAL FeatureCollection (no HTTP). */
export function parseGeonetVal(json: unknown): GeonetVolcano[] {
  const features: any[] = Array.isArray((json as any)?.features) ? (json as any).features : [];
  const out: GeonetVolcano[] = [];
  for (const f of features) {
    const p = f?.properties ?? {};
    const externalId = String(p?.volcanoID ?? "").trim();
    const coords = f?.geometry?.coordinates;
    const lng = Number(coords?.[0]);
    const lat = Number(coords?.[1]);
    if (!externalId || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    // `level` is a number 0–5 in the feed; keep the raw string.
    const levelRaw = String(p?.level ?? "").trim();
    if (levelRaw === "") continue;
    out.push({
      externalId,
      name: String(p?.volcanoTitle ?? "").trim() || externalId,
      lat,
      lng,
      levelRaw,
      colour: String(p?.acc ?? "").trim(),
      activity: String(p?.activity ?? "").trim(),
      normalized: normalizeVolcanoStatus({ scheme: "GEONET_VAL", raw: levelRaw }),
      elevated: Number(levelRaw) >= 1,
    });
  }
  return out;
}

export async function fetchGeonetVal(fetchImpl: typeof fetch = fetch): Promise<GeonetVolcano[]> {
  const res = await fetchImpl(GEONET_VAL_URL, { headers: { Accept: "application/vnd.geo+json;version=2" } });
  if (!res.ok) throw new Error(`geonet val ${res.status}`);
  const json = await res.json();
  return parseGeonetVal(json);
}
