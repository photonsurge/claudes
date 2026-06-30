/**
 * Geometry helpers shared by the alert overlay (map badge placement) and the
 * auto-director (camera framing). Both must agree on a single "where is this
 * alert" point so the on-air pulse reticle lands exactly where the hazard badge
 * sits — otherwise the director frames empty terrain next to the polygon.
 */

type Geometry = { type?: string; coordinates?: unknown } | null | undefined;

/**
 * A representative [lng,lat] for an alert geometry — where the hazard badge sits
 * and where the director points its camera.
 *
 * Point geometries use their coordinate; polygons use the centroid of the outer
 * ring of the FIRST part only. We deliberately ignore interior rings (holes) and
 * the remaining parts of a MultiPolygon: averaging the whole coordinate tree
 * pulls the point off the visible blob (a hole or a small far-flung second part
 * drags the mean away), which is exactly the "reticle on empty ground next to
 * the alert" bug. Cheap and good enough for an on-screen marker.
 */
export function alertRepPoint(geometry: Geometry): [number, number] | null {
  const co = geometry?.coordinates as unknown;
  if (!co) return null;
  if (geometry?.type === "Point") {
    const p = co as number[];
    return p.length >= 2 ? [p[0], p[1]] : null;
  }
  // Polygon → coords[0] is the outer ring; MultiPolygon → coords[0][0].
  const ring: unknown =
    geometry?.type === "MultiPolygon" ? (co as unknown[][][])[0]?.[0] : (co as unknown[][])[0];
  if (!Array.isArray(ring) || ring.length === 0) return null;
  let sx = 0;
  let sy = 0;
  let k = 0;
  for (const pt of ring as [number, number][]) {
    if (Array.isArray(pt) && pt.length >= 2) {
      sx += pt[0];
      sy += pt[1];
      k++;
    }
  }
  return k ? [sx / k, sy / k] : null;
}

/** Coarse continental "Area" labels — the only values continentOf can return. */
export type Continent =
  | "North America"
  | "South America"
  | "Europe"
  | "Africa"
  | "Asia"
  | "Oceania"
  | "Antarctica";

/**
 * Best-effort continent for a [lng,lat] — a broadcast "Area" label (Europe,
 * North America…) so every alert reads *what part of the world* it's in even
 * when no country code can be parsed from the feed. Deliberately coarse: an
 * ordered set of lon/lat boxes with the usual divides (Mediterranean ~37°N
 * splits Europe/Africa, the Urals ~60°E split Europe/Asia, the Red Sea ~43°E
 * splits Africa/Asia). Good enough for an on-screen tag, not for geocoding.
 */
export function continentOf(lng: number, lat: number): Continent | undefined {
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return undefined;
  // Normalise longitude to −180..180.
  const x = ((((lng + 180) % 360) + 360) % 360) - 180;
  const y = lat;

  if (y <= -60) return "Antarctica";

  // Americas (western-hemisphere block, excluding the far-east Pacific dateline).
  if (x >= -170 && x <= -30) {
    return y >= 13 ? "North America" : "South America";
  }

  // Oceania — Australia/NZ and the Pacific island arc.
  if (x >= 110 && y <= 0) return "Oceania";
  if ((x >= 160 || x <= -130) && y <= 12) return "Oceania";

  // Africa box (north edge at the Mediterranean; east edge at the Red Sea).
  if (x >= -20 && x <= 52 && y <= 37) {
    // The Arabian peninsula (east of ~Suez, north of the Horn) leans Asia.
    if (x >= 43 && y >= 12) return "Asia";
    return "Africa";
  }

  // Northern Old World: Europe west of the Urals, Asia east of them.
  if (y >= 37) return x <= 60 ? "Europe" : "Asia";

  // Everything else (South/SE Asia, Middle East) → Asia.
  return "Asia";
}
