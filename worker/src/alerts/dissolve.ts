import polygonClipping, { type MultiPolygon } from "polygon-clipping";
import type { AlertGeometry, iAlert, SeverityRank } from "@photonsurge/shared/db/alert-model";
import { windGeometry } from "@photonsurge/shared/alerts/rings";
import { simplifyGeometry } from "@photonsurge/shared/geo/simplify";

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
  /**
   * `[w, s, e, n]` bounds of the shape.
   *
   * Kept because readers ask "which shapes are in this camera view", and the
   * answer must not require loading the geometry to find out — the polygons are
   * the one thing we're trying not to hand out.
   */
  bbox: [number, number, number, number];
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
 * Could two areas touch? A CANDIDATE filter only — bounding boxes overlap across
 * open sea (Sicily's box overlaps the mainland's), so this can only rule pairs
 * OUT cheaply. Whether they actually join is decided by the union, which is the
 * only thing that really knows.
 */
const near = (
  a: [number, number, number, number],
  b: [number, number, number, number],
  tol: number,
): boolean =>
  !(a[2] + tol < b[0] || b[2] + tol < a[0] || a[3] + tol < b[1] || b[3] + tol < a[1]);

/** Cheap identity for an area, without stringifying a 40k-vertex polygon. */
function areaKey(ar: { areaDesc?: string; geocodes?: { valueName: string; value: string }[]; geometry?: AlertGeometry | null }): string {
  const emma = ar.geocodes?.find((g) => g.valueName?.toUpperCase() === "EMMA_ID")?.value;
  if (emma) return `emma:${emma}`;
  if (ar.areaDesc) return `desc:${ar.areaDesc}`;
  // No code, no name: fall back to the shape itself — type, size and first point
  // are enough to tell two areas of one alert apart.
  const c = ar.geometry?.coordinates as unknown[] | undefined;
  return `geom:${ar.geometry?.type}:${countVertices(c)}:${JSON.stringify((c?.[0] as unknown[])?.[0] ?? null)}`;
}

/**
 * The distinct areas an alert covers, each with a stable identity.
 *
 * MeteoAlarm emits one `info` block per LANGUAGE — Italy ships en-GB and it-IT,
 * each repeating the same areas with byte-identical polygons — so an alert hands
 * us the same geography twice. The languages are content, not geography.
 */
const areasOf = (a: iAlert): { key: string; geometry: AlertGeometry }[] => {
  const seen = new Map<string, AlertGeometry>();
  for (const i of a.info ?? []) {
    for (const ar of i.area ?? []) {
      if (!ar?.geometry) continue;
      const key = areaKey(ar);
      if (!seen.has(key)) seen.set(key, ar.geometry);
    }
  }
  return [...seen.entries()].map(([key, geometry]) => ({ key, geometry }));
};

/**
 * Every distinct area in a bucket, each remembering which alerts cover it.
 *
 * The duplication is not just per-language, it's per-ALERT: a region routinely
 * has two live warnings for the same hazard (an original and its update), and
 * both resolve their polygon from the same EMMA cache — so they are byte
 * identical. Handing both to the union asks polygon-clipping to fuse a polygon
 * with an exact copy of itself, which is coincident edges everywhere and exactly
 * what it throws "Loop is not valid" on. That throw was swallowed as a union
 * failure and the copy then became its OWN blob: Puglia sat in two blobs with an
 * identical bbox, drawn twice on the globe, 33 alerts double-counted.
 *
 * Identical geography is ONE area covered by several alerts, so collapse it here
 * and let the members ride along. Fewer areas is also less clipping.
 */
function distinctAreas(members: iAlert[]): { geometry: AlertGeometry; ids: Set<string> }[] {
  const byArea = new Map<string, { geometry: AlertGeometry; ids: Set<string> }>();
  for (const a of members) {
    for (const { key, geometry } of areasOf(a)) {
      const hit = byArea.get(key);
      if (hit) hit.ids.add(a.id!);
      else byArea.set(key, { geometry, ids: new Set([a.id!]) });
    }
  }
  return [...byArea.values()];
}

export interface DissolveOpts {
  /** Degrees of slack when deciding two areas touch. */
  tolerance?: number;
  /** Hazard classifier — injected so this stays pure and testable. */
  hazardOf: (a: iAlert) => string;
  /**
   * Hand the event loop back every N areas. Injected so tests run synchronously
   * instead of waiting on real timers.
   */
  yield?: () => Promise<void>;
  /** Areas to union between yields. */
  yieldEvery?: number;
  /**
   * Thin each area to this tolerance (degrees) BEFORE clipping. 0 keeps the
   * source exactly.
   *
   * This is the difference between a job that fits on the server and one that
   * doesn't. Source boundaries carry survey-grade detail — the worst hazard alone
   * is ~1.15M vertices — and clipping at that precision is where both the time
   * and the memory go, to produce a shape the overlay then simplifies to ~0.05°
   * (~5km) anyway before drawing it. So the detail was being clipped and thrown
   * away. Measured on that bucket at 0.01° (~1km): 91% fewer vertices, dissolve
   * 40s → 3s, peak heap 711MB → 289MB, and FEWER union failures (less coincident
   * -edge pathology for polygon-clipping to choke on).
   */
  simplifyDeg?: number;
}

/**
 * The bucket an alert dissolves within: same hazard AND same severity.
 *
 * Exported so a caller can group WITHOUT the geometry loaded and then pull one
 * bucket's shapes at a time. Only the id/event/severity fields are touched, so
 * it works on a projection that leaves the polygons in the database — which is
 * the whole point: holding every active alert's geometry at once is ~5M vertices
 * and it OOMs the worker.
 */
export const bucketKeyOf = (a: iAlert, hazardOf: (a: iAlert) => string): string =>
  `${hazardOf(a)}|${a.maxSeverityRank}`;

/**
 * Cluster alerts by (hazard, severity) and union each cluster's touching areas.
 *
 * Adjacency is transitive: a chain of counties across a country becomes ONE blob,
 * which is the whole point. We union greedily into open blobs rather than doing a
 * full pairwise pass — with hundreds of areas per hazard, all-pairs polygon
 * clipping is the cost we're trying to avoid.
 *
 * ASYNC for one reason: polygon-clipping is synchronous, and a big hazard (750
 * heat warnings across Europe) is minutes of unbroken CPU. Held in one go, that
 * starves BullMQ's lock-renewal timer and the worker drops the locks on every
 * OTHER job it's running ("could not renew lock for job repeat:…") — the shared
 * worker can't tell a busy job from a dead one. So we surface between areas and
 * let the timers fire. It's the same total CPU, just interruptible.
 */
export async function dissolveAlerts(alerts: iAlert[], opts: DissolveOpts): Promise<DissolveStats> {
  const tol = opts.tolerance ?? 0.02;
  const breathe = opts.yield ?? (() => new Promise<void>((r) => setImmediate(r)));
  const yieldEvery = opts.yieldEvery ?? 25;
  const simplifyDeg = opts.simplifyDeg ?? 0;
  let sinceYield = 0;
  let unionFailures = 0;

  // Same hazard AND same severity: a red and an amber warning must never fuse
  // into one shape, or the globe would paint the milder area at the worse colour.
  const buckets = new Map<string, iAlert[]>();
  for (const a of alerts) {
    const key = bucketKeyOf(a, opts.hazardOf);
    const arr = buckets.get(key);
    if (arr) arr.push(a);
    else buckets.set(key, [a]);
  }

  const out: AlertBlobInput[] = [];
  for (const [key, members] of buckets) {
    const [hazard, rank] = key.split("|");
    type Blob = { geom: MultiPolygon; box: [number, number, number, number]; ids: Set<string>; before: number };
    const blobs: Blob[] = [];

    // Distinct GEOGRAPHY, not distinct alerts: two warnings for the same region
    // are one area with two members, never two identical shapes to union.
    for (const area of distinctAreas(members)) {
      {
        const g = area.geometry;
        // Counted from the SOURCE, before thinning, so the run's reported saving
        // stays honest end-to-end: raw boundary → what the globe finally draws.
        const before = countVertices(g.coordinates);
        const thinned = simplifyDeg ? simplifyGeometry(g as never, simplifyDeg) : g;
        const geom = toGeom((thinned ?? g) as AlertGeometry);
        if (!geom) continue;
        if (++sinceYield >= yieldEvery) {
          sinceYield = 0;
          await breathe();
        }
        const box = bounds(geom);

        // Fuse into every blob this area touches — joining two previously
        // separate blobs is normal (an area can bridge them).
        const hits = blobs.filter((b) => near(b.box, box, tol));
        if (!hits.length) {
          blobs.push({ geom, box, ids: new Set(area.ids), before });
          continue;
        }
        let merged = geom;
        const ids = new Set<string>(area.ids);
        let beforeSum = before;
        const fused: Blob[] = [];
        for (const b of hits) {
          // `near` is only a bbox test, and a bbox is a terrible proxy for "these
          // two touch": Sicily's box overlaps mainland Italy's across 150km of
          // sea. Unioning disjoint shapes still "succeeds" — it just returns both
          // parts — so bbox alone silently collapsed separate weather into one
          // blob. The union itself is the honest test: if the parts didn't drop,
          // nothing actually joined, so leave them apart.
          const partsApart = merged.length + b.geom.length;
          const u = tryUnion(merged, b.geom);
          if (!u) {
            // This pair won't fuse — leave that blob alone and carry on.
            unionFailures++;
            continue;
          }
          if (u.length >= partsApart) continue; // adjacent-looking, but not touching
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
        // Re-measured from the wound output rather than reusing `b.box`, so the
        // stored bounds always describe the stored shape.
        bbox: bounds(toGeom(geometry)!),
        memberIds: [...b.ids],
        verticesBefore: b.before,
        verticesAfter: countVertices(geometry.coordinates),
      });
    }
  }
  return { blobs: out, unionFailures };
}
