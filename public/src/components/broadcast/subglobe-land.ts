// One-shot, module-cached land silhouettes for the SUB-GLOBE locator slide:
// the SAME Natural Earth 50m /data/land.geojson the basemap already serves,
// simplified once (Douglas–Peucker, coarse — it paints a ~360px planet) to a
// few thousand vertices. Mirrors the countryGlow module cache: every panel
// instance shares one fetch + one simplify pass for the life of the tab.

import { simplifyRing, type Point } from "@photonsurge/shared/geo/simplify";
// data-urls, not basemap: this module also runs inside the sub-globe's Web
// Worker, and basemap.ts would drag deck.gl into that bundle.
import { LAND_URL } from "../layers/data-urls";

/** Coarse for a locator globe: ~0.6° is invisible at 360px and cuts the 50m
 *  land set roughly 20×. */
const TOLERANCE_DEG = 0.6;

interface LandGeoJson {
  features?: Array<{
    geometry?: { type?: string; coordinates?: unknown } | null;
  }>;
}

async function fetchLand(): Promise<Point[][]> {
  // No fetch (SSR edge cases, jsdom) → graticule-only globe, never a throw.
  if (typeof fetch !== "function") return [];
  const res = await fetch(LAND_URL);
  if (!res.ok) return [];
  const gj = (await res.json()) as LandGeoJson;
  const rings: Point[][] = [];
  const add = (ring: unknown) => {
    if (!Array.isArray(ring) || ring.length < 4) return;
    const s = simplifyRing(ring as Point[], TOLERANCE_DEG);
    if (s.length >= 4) rings.push(s);
  };
  for (const f of gj.features ?? []) {
    const geom = f.geometry;
    if (!geom?.coordinates) continue;
    // Outer rings only — lake holes are sub-pixel at locator size.
    if (geom.type === "Polygon") add((geom.coordinates as unknown[])[0]);
    else if (geom.type === "MultiPolygon") {
      for (const poly of geom.coordinates as unknown[][]) add(poly[0]);
    }
  }
  return rings;
}

let cache: Promise<Point[][]> | null = null;

export function loadSubGlobeLand(): Promise<Point[][]> {
  if (!cache) cache = fetchLand().catch(() => []);
  return cache;
}
