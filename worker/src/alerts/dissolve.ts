import polygonClipping, { type MultiPolygon } from "polygon-clipping";
import type { AlertGeometry, iAlert, SeverityRank } from "@photonsurge/shared/db/alert-model";
import { windGeometry } from "@photonsurge/shared/alerts/rings";

/**
 * Dissolve neighbouring warning areas of the same hazard into one shape.
 *
 * MeteoAlarm issues ONE ALERT PER COUNTY — Poland alone runs to ~550 live —
 * so the globe draws hundreds of little squares where a viewer should see a few
 * weather blobs. Unioning the touching ones turns confetti back into weather.
 *
 * This is also a memory win, not just a look: `public` ends up reading and
 * drawing far fewer vertices per cut. It runs in the WORKER precisely so the
 * clipping library and the CPU stay off the broadcast surface — public only ever
 * reads the cached shape.
 */

/** A dissolved blob: one geometry covering every member area. */
export interface AlertBlobInput {
  hazard: string;
  severityRank: SeverityRank;
  geometry: AlertGeometry;
  /** Alerts whose areas went into this shape — the panel still lists them all. */
  memberIds: string[];
  /** Rings before and after, so the saving is visible in the job log. */
  verticesBefore: number;
  verticesAfter: number;
}

export interface DissolveStats {
  blobs: AlertBlobInput[];
  /** Unions polygon-clipping refused; those areas stayed separate. */
  unionFailures: number;
}

/**
 * Union two shapes, or return null if the library can't.
 *
 * polygon-clipping is numerically fragile on real-world borders — it throws
 * "Unable to complete output ring" on certain coincident edges, and the first run
 * against live alerts hit exactly that. A failed union must degrade to "these two
 * stay separate", never take the whole rebuild down: an undissolved area still
 * draws correctly, it's just not merged.
 */
function tryUnion(a: MultiPolygon, b: MultiPolygon): MultiPolygon | null {
  try {
    return polygonClipping.union(a, b) as MultiPolygon;
  } catch {
    return null;
  }
}

const countVertices = (coords: unknown): number => {
  if (!Array.isArray(coords)) return 0;
  if (typeof coords[0] === "number") return 1;
  return (coords as unknown[]).reduce<number>((n, c) => n + countVertices(c), 0);
};

/** GeoJSON Polygon/MultiPolygon → polygon-clipping's MultiPolygon (always multi). */
function toGeom(g: AlertGeometry | null | undefined): MultiPolygon | null {
  if (!g?.coordinates) return null;
  if (g.type === "Polygon") return [g.coordinates] as MultiPolygon;
  if (g.type === "MultiPolygon") return g.coordinates as MultiPolygon;
  return null; // Points can't be dissolved — they pass through untouched.
}

/**
 * polygon-clipping's MultiPolygon → GeoJSON, collapsing a single part to Polygon.
 *
 * Wound on the way out, because the union's ring order is the library's business,
 * not RFC 7946's, and Mongo reads a clockwise outer ring as the region's
 * COMPLEMENT. That is not a subtle failure: "cities in this blob" would answer
 * with every city on Earth except Poland, and the 2dsphere would reject the shape
 * for being bigger than a hemisphere. Winding here means every stored blob is
 * queryable and drawable by construction.
 */
function toGeoJson(geom: MultiPolygon): AlertGeometry | null {
  if (!geom?.length) return null;
  const g: AlertGeometry =
    geom.length === 1
      ? { type: "Polygon", coordinates: geom[0] }
      : { type: "MultiPolygon", coordinates: geom };
  return windGeometry(g);
}

/** Axis-aligned bounds, for the cheap adjacency pre-filter. */
function bounds(geom: MultiPolygon): [number, number, number, number] {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const poly of geom) {
    for (const ring of poly) {
      for (const [x, y] of ring) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }
  return [minX, minY, maxX, maxY];
}

/**
 * Do two areas touch (or nearly)? County polygons that share a border have
 * coincident edges, but sources round coordinates differently, so a hair of
 * tolerance stops two halves of one border failing to merge. Bounds-only — the
 * real test is whether the union actually fuses, which `union` decides.
 */
const near = (
  a: [number, number, number, number],
  b: [number, number, number, number],
  tol: number,
): boolean =>
  !(a[2] + tol < b[0] || b[2] + tol < a[0] || a[3] + tol < b[1] || b[3] + tol < a[1]);

/** Every area geometry an alert carries. */
const geomsOf = (a: iAlert): AlertGeometry[] =>
  (a.info ?? []).flatMap((i) => (i.area ?? []).map((ar) => ar.geometry).filter(Boolean) as AlertGeometry[]);

export interface DissolveOpts {
  /** Degrees of slack when deciding two areas touch. */
  tolerance?: number;
  /** Hazard classifier — injected so this stays pure and testable. */
  hazardOf: (a: iAlert) => string;
}

/**
 * Cluster alerts by (hazard, severity) and union each cluster's touching areas.
 *
 * Adjacency is transitive: a chain of counties across a country becomes ONE blob,
 * which is the whole point. We union greedily into open blobs rather than doing a
 * full pairwise pass — with hundreds of areas per hazard, all-pairs polygon
 * clipping is the cost we're trying to avoid.
 */
export function dissolveAlerts(alerts: iAlert[], opts: DissolveOpts): DissolveStats {
  const tol = opts.tolerance ?? 0.02;
  let unionFailures = 0;

  // Same hazard AND same severity: a red and an amber warning must never fuse
  // into one shape, or the globe would paint the milder area at the worse colour.
  const buckets = new Map<string, iAlert[]>();
  for (const a of alerts) {
    const key = `${opts.hazardOf(a)}|${a.maxSeverityRank}`;
    const arr = buckets.get(key);
    if (arr) arr.push(a);
    else buckets.set(key, [a]);
  }

  const out: AlertBlobInput[] = [];
  for (const [key, members] of buckets) {
    const [hazard, rank] = key.split("|");
    type Blob = { geom: MultiPolygon; box: [number, number, number, number]; ids: Set<string>; before: number };
    const blobs: Blob[] = [];

    for (const a of members) {
      for (const g of geomsOf(a)) {
        const geom = toGeom(g);
        if (!geom) continue;
        const before = countVertices(g.coordinates);
        const box = bounds(geom);

        // Fuse into every blob this area touches — joining two previously
        // separate blobs is normal (an area can bridge them).
        const hits = blobs.filter((b) => near(b.box, box, tol));
        if (!hits.length) {
          blobs.push({ geom, box, ids: new Set([a.id!]), before });
          continue;
        }
        let merged = geom;
        const ids = new Set<string>([a.id!]);
        let beforeSum = before;
        const fused: Blob[] = [];
        for (const b of hits) {
          const u = tryUnion(merged, b.geom);
          if (!u) {
            // This pair won't fuse — leave that blob alone and carry on.
            unionFailures++;
            continue;
          }
          merged = u;
          for (const id of b.ids) ids.add(id);
          beforeSum += b.before;
          fused.push(b);
        }
        for (const b of fused) blobs.splice(blobs.indexOf(b), 1);
        blobs.push({ geom: merged, box: bounds(merged), ids, before: beforeSum });
      }
    }

    for (const b of blobs) {
      const geometry = toGeoJson(b.geom);
      if (!geometry) continue;
      out.push({
        hazard,
        severityRank: Number(rank) as SeverityRank,
        geometry,
        memberIds: [...b.ids],
        verticesBefore: b.before,
        verticesAfter: countVertices(geometry.coordinates),
      });
    }
  }
  return { blobs: out, unionFailures };
}
