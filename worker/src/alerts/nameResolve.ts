import type { AlertGeometry } from "@photonsurge/shared/db/alert-model";
import type { AdminAreaCandidate } from "@photonsurge/shared/db/admin-area-geom-repo";
import { gadmNameKey } from "./gadmNameKey";

/**
 * Resolve a China-style alert's areas — named, uncoded, polygon-less — against a
 * name-keyed boundary cache, WITHOUT ever drawing the wrong shape.
 *
 * CMA (China) warnings carry only an English county name, and a county name can
 * belong to several counties in different provinces ("Pingxiang" is in three). A
 * bare name-join would draw one of them at random — plausible and wrong, the exact
 * trap NUTS taught us. So the resolver only fills an area when the answer is
 * unambiguous or the alert's OTHER drawable areas pin the region:
 *
 *   Pass A — unique names. A name that maps to exactly one county is safe; fill it,
 *     and remember its centroid as an anchor.
 *   Pass B — ambiguous names. Only resolved when the alert already has anchors
 *     (sibling polygons from the feed, or Pass-A fills): pick the candidate nearest
 *     the anchor centre. With no anchor there is nothing to disambiguate against, so
 *     the area is left undrawn rather than guessed.
 *
 * Pure and side-effect-free: it reads the areas and returns decisions by index. The
 * caller applies them (ingest mutates in place; the reconcile writes them back).
 */

export interface NameArea {
  areaDesc?: string;
  // Untyped on purpose: it may arrive as a stored Mongo `Mixed` (unknown) or a
  // parsed AlertGeometry. Only ever read (for the "already drawable?" test + anchor).
  geometry?: unknown;
}

export interface NameResolution {
  /** Index into the areas array the decision applies to. */
  index: number;
  geometry: AlertGeometry;
  /** The boundary's own code (GID_3), for logging/debug. */
  code: string;
  /** True when a shared name was disambiguated by anchor rather than being unique. */
  disambiguated: boolean;
}

const hasGeometry = (g?: unknown): boolean => !!(g as { coordinates?: unknown } | null)?.coordinates;

/**
 * A representative [lng, lat] for a geometry — the mean of the first ring's
 * vertices. Coarse on purpose: it only has to name the right province, not the
 * exact centre, and cheapness matters (called per sibling area).
 */
export function geomAnchor(g?: unknown): [number, number] | null {
  const c = (g as { type?: string; coordinates?: any } | null)?.coordinates;
  if (!c) return null;
  const t = (g as { type?: string }).type;
  // Drill to the first linear ring regardless of Polygon vs MultiPolygon nesting.
  const ring: any[] = t === "MultiPolygon" ? c?.[0]?.[0] : t === "Polygon" ? c?.[0] : null;
  if (!Array.isArray(ring) || !ring.length) return null;
  // A closed ring repeats its first vertex last; count it once so it doesn't skew
  // the mean toward that corner.
  const first = ring[0];
  const last = ring[ring.length - 1];
  const closed =
    ring.length > 1 && Array.isArray(first) && Array.isArray(last) && first[0] === last[0] && first[1] === last[1];
  const end = closed ? ring.length - 1 : ring.length;
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (let i = 0; i < end; i++) {
    const pt = ring[i];
    if (!Array.isArray(pt) || pt.length < 2) continue;
    sx += pt[0];
    sy += pt[1];
    n++;
  }
  return n ? [sx / n, sy / n] : null;
}

/** Squared planar distance — we only ever compare distances, so skip the sqrt and the great-circle. */
const dist2 = (a: [number, number], b: [number, number]): number => {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  return dx * dx + dy * dy;
};

const meanPoint = (pts: [number, number][]): [number, number] => {
  let sx = 0;
  let sy = 0;
  for (const p of pts) {
    sx += p[0];
    sy += p[1];
  }
  return [sx / pts.length, sy / pts.length];
};

export function resolveAreaNames(areas: NameArea[], cache: Map<string, AdminAreaCandidate[]>): NameResolution[] {
  const out: NameResolution[] = [];
  if (!cache.size) return out;

  // Anchors that pin the alert's region: every area that already has a polygon
  // (from the feed, or an EMMA/admin fill earlier in the same tick).
  const anchors: [number, number][] = [];
  for (const a of areas) {
    if (!hasGeometry(a.geometry)) continue;
    const p = geomAnchor(a.geometry);
    if (p) anchors.push(p);
  }

  // Pass A: unique names. Safe to draw, and each becomes another anchor for Pass B.
  const ambiguous: { index: number; cands: AdminAreaCandidate[] }[] = [];
  areas.forEach((a, index) => {
    if (hasGeometry(a.geometry)) return;
    const cands = cache.get(gadmNameKey(a.areaDesc));
    if (!cands || !cands.length) return;
    if (cands.length === 1) {
      out.push({ index, geometry: cands[0].geometry, code: cands[0].code, disambiguated: false });
      if (cands[0].centroid) anchors.push(cands[0].centroid);
      return;
    }
    ambiguous.push({ index, cands });
  });

  // Pass B: ambiguous names. Never guess without an anchor.
  if (ambiguous.length && anchors.length) {
    const centre = meanPoint(anchors);
    for (const { index, cands } of ambiguous) {
      let best: AdminAreaCandidate | null = null;
      let bestD = Infinity;
      for (const c of cands) {
        if (!c.centroid) continue;
        const d = dist2(centre, c.centroid);
        if (d < bestD) {
          bestD = d;
          best = c;
        }
      }
      if (best) out.push({ index, geometry: best.geometry, code: best.code, disambiguated: true });
    }
  }

  return out;
}
