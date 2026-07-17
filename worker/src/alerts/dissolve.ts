import polygonClipping, { type MultiPolygon } from "polygon-clipping";
import type { AlertGeometry, iAlert, SeverityRank } from "@photonsurge/shared/db/alert-model";
import { windGeometry } from "@photonsurge/shared/alerts/rings";
import { alertCountryCode } from "@photonsurge/shared/alerts/country";
import { simplifyGeometry } from "@photonsurge/shared/geo/simplify";
import { snapGeometry } from "./snap";
import { dropSliverHoles, MIN_HOLE_AREA_DEG2, type SliverStats } from "./slivers";

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
  /**
   * ISO-3166 alpha-2 the members share; undefined for feeds with no country in
   * the identifier (GDACS). Every member has it by construction — it's part of
   * the bucket key — so a card can say "Spain: amber heat" and be right.
   */
  country?: string;
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
  /**
   * Stamped by the REBUILD, not here: which bucket produced this shape and the
   * fingerprint of the member set it saw — what lets the next run skip the
   * bucket when nothing in it changed.
   */
  bucketKey?: string;
  fingerprint?: string;
}

export interface DissolveStats {
  blobs: AlertBlobInput[];
  /** Unions polygon-clipping refused; those areas stayed separate. */
  unionFailures: number;
  /** Sliver holes stripped from the fused shapes, and the vertices they cost. */
  slivers: SliverStats;
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
   * Thin each finished blob to this tolerance (degrees). 0 stores the union
   * exactly.
   *
   * AFTER the clip, never before — the order is the whole point and it was wrong
   * once. Douglas-Peucker picks which points to keep from each ring's OWN shape,
   * so two neighbours thin their shared border DIFFERENTLY and it stops being a
   * shared border at all. Thinning the inputs at 0.002° pulled real borders apart
   * by up to 200m and polygon-clipping then answered the union of Flevoland and
   * Friesland with FIVE disjoint parts instead of one merged shape — the pair
   * fuses perfectly at full precision. Measured: 63 pairs of genuinely-touching
   * regions (Dutch provinces, Veneto/Friuli, the Graz districts) silently stopped
   * fusing and drew with a seam between them.
   *
   * By the time a blob is built the shared borders are gone — they're interior to
   * one fused shape — so thinning here can only cheapen the OUTLINE, and the
   * saving is the same. It's the safe half of the trade.
   */
  simplifyDeg?: number;
  /**
   * Round every coordinate onto a shared grid (degrees) before clipping. 0 off.
   *
   * The topology-safe answer to the problem above IN THEORY: snapping is a
   * function of the coordinate rather than the ring, so both sides of a shared
   * border round to identical points. Measured WORSE on live data — it introduces
   * its own degenerate rings — so it's off. See snap.ts before trying again.
   *
   * Re-measured cleanly after the input-thinning bug was fixed (the first
   * benchmark was confounded by it) and it is still worse, monotonically: blobs
   * 563 with no snapping, 599 at 0.0005°, 648 at 0.001°, 727 at 0.002°. It makes
   * the failure COUNT look good while fusing less — the wrong metric.
   */
  snapDeg?: number;
  /**
   * Drop interior holes smaller than this (deg²). 0 keeps every hole.
   *
   * The hairline gaps left where two counties' borders don't match to the micron.
   * They are interior to the fused shape, so they come back as holes and the
   * globe draws an outline round each one — the streaks across Poland and Texas.
   * See slivers.ts: 18% of every vertex we stored was inside one.
   */
  minHoleAreaDeg2?: number;
}

/** No country in the identifier (GDACS' global feed) — bucket them together. */
export const UNKNOWN_COUNTRY = "??";

/**
 * The bucket an alert dissolves within: same hazard, same severity, same COUNTRY.
 *
 * The country is not cosmetic. Adjacency is transitive, warnings don't stop at
 * borders, and a continent's worth of met services issue the same hazard on the
 * same day — so without it the chain ran clean across Europe: one thunderstorm
 * blob of 206 alerts spanning THIRTEEN countries from Spain to Kosovo, one heat
 * blob from Spain to the Netherlands, one storm blob across 100° of longitude
 * from Kazakhstan to the Pacific. Those shapes are technically correct and
 * useless: a blob gets ONE representative alert card, so clicking a third of
 * Europe showed one country's headline for all of it.
 *
 * A warning is issued BY a country, so the country is the honest seam — it's
 * where the underlying editorial actually changes. Within one, the dissolve still
 * does its job and Poland's ~550 county alerts still become a few shapes.
 *
 * Exported so a caller can group WITHOUT the geometry loaded and then pull one
 * bucket's shapes at a time. Only the small fields are touched, so it works on a
 * projection that leaves the polygons in the database — which is the whole point:
 * holding every active alert's geometry at once is ~5M vertices and it OOMs the
 * worker. `source`/`identifier` must be in that projection for the country to
 * resolve; miss them and every alert silently buckets as UNKNOWN_COUNTRY and the
 * continent-wide blobs come straight back.
 */
export const bucketKeyOf = (a: iAlert, hazardOf: (a: iAlert) => string): string =>
  `${hazardOf(a)}|${a.maxSeverityRank}|${alertCountryCode(a) ?? UNKNOWN_COUNTRY}`;

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
 *
 * NOT offloaded to a worker thread (unlike the GRIB bake — see grib/bakePool).
 * This function's input is the raw source geometry, ~240MB for the worst hazard
 * (alertBlobs.ts). A worker boundary structured-CLONES that — it isn't a
 * transferable ArrayBuffer like a Float32Array grid — so the copy alone would
 * transiently DOUBLE the memory on the one job whose defining constraint is
 * already OOM (alertBlobs.ts pass 2 holds one bucket and nothing else on purpose).
 * That trades a lock miss for a crash. The `breathe()` yields below plus the
 * raised WORKER_LOCK_DURATION_MS (index.ts) cover this without moving the data.
 * The only case they don't cover is a SINGLE union exceeding the lock window, and
 * a thread copy would make that case's memory worse, not its CPU better. If that
 * case ever bites, the fix is to bound the per-union size, not to offload.
 */
export async function dissolveAlerts(alerts: iAlert[], opts: DissolveOpts): Promise<DissolveStats> {
  const tol = opts.tolerance ?? 0.02;
  const breathe = opts.yield ?? (() => new Promise<void>((r) => setImmediate(r)));
  const yieldEvery = opts.yieldEvery ?? 25;
  const simplifyDeg = opts.simplifyDeg ?? 0;
  const snapDeg = opts.snapDeg ?? 0;
  const minHoleArea = opts.minHoleAreaDeg2 ?? MIN_HOLE_AREA_DEG2;
  const slivers: SliverStats = { dropped: 0, vertices: 0 };
  let sinceYield = 0;
  let unionFailures = 0;

  // Same hazard, same severity, same country — see `bucketKeyOf`. A red and an
  // amber warning must never fuse into one shape, or the globe paints the milder
  // area at the worse colour; and a blob must not cross a national border, or its
  // card speaks for countries it has never heard of.
  const buckets = new Map<string, iAlert[]>();
  for (const a of alerts) {
    const key = bucketKeyOf(a, opts.hazardOf);
    const arr = buckets.get(key);
    if (arr) arr.push(a);
    else buckets.set(key, [a]);
  }

  const out: AlertBlobInput[] = [];
  for (const [key, members] of buckets) {
    const [hazard, rank, country] = key.split("|");
    type Blob = { geom: MultiPolygon; box: [number, number, number, number]; ids: Set<string>; before: number };
    const blobs: Blob[] = [];

    // Distinct GEOGRAPHY, not distinct alerts: two warnings for the same region
    // are one area with two members, never two identical shapes to union.
    //
    // Then EXPLODED into parts, which is load-bearing: this used to iterate areas
    // and hand each area's whole geometry to the union as one lump. That merges
    // areas against each other and is a complete NO-OP when there's only one —
    // and WMO routinely ships an entire country as a SINGLE area carrying one
    // multi-part geometry. Moldova arrived as 1 alert / 1 area / 36 county
    // polygons; a US heat advisory as ~30. Nothing to union against, so the parts
    // passed through untouched and the globe drew every county border inside a
    // shape that was supposed to be one place. Every part is its own candidate, so
    // touching counties fuse whether they arrived as separate areas or as parts of
    // one.
    for (const area of distinctAreas(members)) {
      const g = area.geometry;
      // Clip the boundary AS ISSUED. Cheapening it here is what breaks the
      // shared borders this whole function exists to dissolve (see
      // `simplifyDeg`); the thinning happens to the finished blob instead.
      const snapped = snapDeg ? (snapGeometry(g, snapDeg) ?? g) : g;
      const whole = toGeom(snapped as AlertGeometry);
      if (!whole) continue;

      // Vertices are counted from the RAW source, per part, so the run's reported
      // saving stays honest end-to-end: raw boundary → what the globe finally
      // draws. Per part matters now that parts can land in different blobs —
      // charging a 36-part area's whole count to whichever blob got part 0 would
      // make one blob's saving nonsense and the rest's zero. If snapping dropped a
      // part the indices no longer line up, so fall back to charging part 0.
      const src = toGeom(g);
      const aligned = src?.length === whole.length;
      const areaBefore = countVertices(g.coordinates);

      for (let partIdx = 0; partIdx < whole.length; partIdx++) {
        const geom: MultiPolygon = [whole[partIdx]];
        const before = aligned
          ? countVertices(src![partIdx])
          : partIdx === 0
            ? areaBefore
            : 0;
        if (++sinceYield >= yieldEvery) {
          sinceYield = 0;
          await breathe();
        }
        const box = bounds(geom);

        // Fuse into every blob this part touches — joining two previously
        // separate blobs is normal (a part can bridge them).
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

    // Parts of the SAME warning go back together as one multi-part shape.
    //
    // Exploding areas into parts is what makes the dissolve work at all (a
    // country shipped as one 36-part area has nothing to union otherwise), but
    // left alone it also turns one warning into 36 blobs — and every one of them
    // carries a full copy of the card text. Measured: blobs 582 -> 3,871 and the
    // feed's properties 0.3MB -> 1.76MB, more than the geometry, almost all of it
    // the same `areaDesc` ("Ungheni; Floresti; Sangerei; …") stamped 36 times.
    //
    // Identical member set == the same warning, so those shapes are one feature.
    // Shapes whose members DIFFER stay apart, which is the Sicily rule intact:
    // Sicily and Puglia are different alerts and never share a blob.
    const byMembers = new Map<string, Blob>();
    for (const b of blobs) {
      const sig = [...b.ids].sort().join(",");
      const hit = byMembers.get(sig);
      if (hit) {
        hit.geom = [...hit.geom, ...b.geom];
        hit.before += b.before;
      } else {
        byMembers.set(sig, b);
      }
    }

    for (const b of byMembers.values()) {
      const merged = toGeoJson(b.geom);
      if (!merged) continue;
      // NOW thin: every shared border in here is already interior to the fused
      // shape, so there's nothing left to pull apart. A blob that thins away to
      // nothing keeps its exact outline rather than vanishing off the globe.
      const thinned = simplifyDeg
        ? ((simplifyGeometry(merged as never, simplifyDeg) as AlertGeometry) ?? merged)
        : merged;
      // Strip the seams the union couldn't close. LAST, so it also catches holes
      // that thinning degenerated, and so the threshold is applied to the exact
      // rings we're about to store.
      const geometry = (dropSliverHoles(thinned, minHoleArea, slivers) ?? thinned) as AlertGeometry;
      out.push({
        hazard,
        severityRank: Number(rank) as SeverityRank,
        country: country === UNKNOWN_COUNTRY ? undefined : country,
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
  return { blobs: out, unionFailures, slivers };
}
