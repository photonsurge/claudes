import type { AppDb } from "@photonsurge/shared/db/index";
import { log } from "@photonsurge/shared/utill/logger";
import { classifyHazard } from "@photonsurge/shared/alerts/hazard";
import type { iAlert } from "@photonsurge/shared/db/alert-model";
import { summarizeForLog } from "../utils";
import { blogInfo, blogErr } from "../blog";
import { dissolveAlerts, bucketKeyOf } from "./dissolve";
import { attachCities, type BlobCityStats } from "./blob-cities";

const TAG = "job:alert-blobs";

/**
 * The alert-blob rebuild — dissolves touching warning areas of the same
 * hazard+severity+country into single cached shapes.
 *
 * THIS RUNS IN A CHILD PROCESS (see dissolveChild.ts / the `alertBlobs` job). The
 * clip is heavy synchronous CPU — a single polygon-clipping union on the worst
 * hazard can hold the event loop long enough that the worker stops answering
 * `/healthz` and BullMQ drops the locks on its other jobs. No amount of yielding
 * fixes a single uninterruptible union, so the work is forked off the main worker
 * entirely. Kept as a plain `(db) => result` function so the child entry and the
 * unit tests both drive it directly; the parent job only forks and waits.
 */

const hazardOf = (a: iAlert) =>
  classifyHazard({ event: a.info?.[0]?.event, parameters: a.info?.[0]?.parameters });

/**
 * Hand the event loop back between hazards.
 *
 * A backstop, not the fix: yielding only here was tried and was NOT enough —
 * `heat|3` alone is ~750 alerts and blocked for far longer than BullMQ's
 * lock-renewal interval. The real yielding happens inside the dissolve, between
 * areas — and, decisively, this whole routine now runs in its own process.
 */
const breathe = () => new Promise<void>((r) => setImmediate(r));

/**
 * Thin each finished blob to ~200m. AFTER the clip — see `DissolveOpts.simplifyDeg`.
 *
 * Thinning the INPUTS was cheaper but broke the shared borders this job exists to
 * dissolve: Douglas-Peucker thins each ring along its OWN shape, so two neighbours'
 * shared border stopped matching and they stopped fusing. Measured on one live
 * snapshot, thinning the output gives FEWER blobs (more areas fused = fewer seams)
 * at ~3.5% more stored size and 4× the CPU — worth it. 200m is well under the ~5km
 * the globe draws.
 */
const DISSOLVE_SIMPLIFY_DEG = Number(process.env.ALERT_DISSOLVE_SIMPLIFY_DEG || 0.002);

export interface AlertBlobRebuildResult {
  alerts: number;
  blobs: number;
  verticesBefore: number;
  verticesAfter: number;
  saved: string;
  unionFailures: number;
  staleRemoved: number;
  sliverHolesDropped: number;
  sliverVerticesFreed: number;
  cities: number;
  blobsWithNoCities: number;
  citiesRepaired: number;
  cityFailures: number;
}

export async function rebuildAlertBlobs(db: AppDb): Promise<AlertBlobRebuildResult> {
  try {
    // Pass 1: group WITHOUT the geometry. Loading every active alert's polygons
    // at once was ~5M vertices in one array — several GB of JS objects before
    // clipping allocates a thing. The bucket an alert lands in depends only on its
    // hazard + severity + country, so work that out cheaply first and let each
    // bucket fetch its own shapes.
    //
    // `source` and `identifier` are here because the country is decoded from them
    // and the country is part of the bucket key. Drop them and every alert quietly
    // buckets as "unknown" — Europe fusing into one shape again.
    const index = (await db.alerts.model
      .find(
        { active: true },
        { _id: 0, id: 1, source: 1, identifier: 1, maxSeverityRank: 1, "info.event": 1, "info.parameters": 1 },
      )
      .lean()
      .exec()) as unknown as iAlert[];

    const buckets = new Map<string, string[]>();
    for (const a of index) {
      const key = bucketKeyOf(a, hazardOf);
      const ids = buckets.get(key);
      if (ids) ids.push(a.id!);
      else buckets.set(key, [a.id!]);
    }
    const alertCount = index.length;
    index.length = 0; // the ids are all we still need

    // Pass 2: one hazard at a time, WRITTEN as we go. Peak memory is the bucket
    // being clipped and nothing else; the previous generation is retired only at
    // the very end, so a reader mid-rebuild still sees a complete globe.
    const builtAt = new Date();
    const cityStats: BlobCityStats = { cities: 0, empty: 0, repaired: 0, failures: 0 };
    let unionFailures = 0;
    const slivers = { dropped: 0, vertices: 0 };
    let written = 0;
    let verticesBefore = 0;
    let verticesAfter = 0;

    for (const [key, ids] of buckets) {
      // `source`/`identifier` again, NOT redundant with pass 1: `dissolveAlerts`
      // re-buckets what it's handed and decodes the country from THESE documents.
      let members: iAlert[] | null = (await db.alerts.model
        .find(
          { id: { $in: ids } },
          {
            _id: 0,
            id: 1,
            source: 1,
            identifier: 1,
            maxSeverityRank: 1,
            "info.event": 1,
            "info.parameters": 1,
            "info.area.geometry": 1,
          },
        )
        .lean()
        .exec()) as unknown as iAlert[];

      const r = await dissolveAlerts(members, { hazardOf, simplifyDeg: DISSOLVE_SIMPLIFY_DEG });
      // The source geometry is the biggest thing here (~240MB for the worst
      // hazard) and the dissolve has taken what it needs — let it go before the
      // city lookups.
      members = null;
      unionFailures += r.unionFailures;
      slivers.dropped += r.slivers.dropped;
      slivers.vertices += r.slivers.vertices;

      // Record who's inside the shapes while this bucket is still the only one in
      // memory — once, against the geo index, so no downstream reader re-runs
      // point-in-polygon.
      const cs = await attachCities({ cities: db.cities.model, alerts: db.alerts.model }, r.blobs);
      cityStats.cities += cs.cities;
      cityStats.empty += cs.empty;
      cityStats.repaired += cs.repaired;
      cityStats.failures += cs.failures;

      for (const b of r.blobs) {
        verticesBefore += b.verticesBefore;
        verticesAfter += b.verticesAfter;
      }
      written += await db.alertBlobs.addGeneration(r.blobs, builtAt);

      log(TAG, `dissolved ${key}`, { alerts: ids.length, blobs: r.blobs.length, cities: cs.cities });
      await breathe();
    }

    // THE COMMIT. Everything written above is `live: false` and invisible until
    // this line: it flips the new generation on air and retires every older one,
    // in that order, so a reader sees the previous globe whole right up until it
    // sees the new one whole. A rebuild that dies before here changes nothing on air.
    const committed = await db.alertBlobs.commitGeneration(builtAt);

    const before = verticesBefore;
    const after = verticesAfter;
    const result: AlertBlobRebuildResult = {
      alerts: alertCount,
      blobs: written,
      verticesBefore: before,
      verticesAfter: after,
      saved: before ? `${Math.round((1 - after / before) * 100)}%` : "0%",
      unionFailures,
      staleRemoved: committed.removed,
      sliverHolesDropped: slivers.dropped,
      sliverVerticesFreed: slivers.vertices,
      cities: cityStats.cities,
      blobsWithNoCities: cityStats.empty,
      citiesRepaired: cityStats.repaired,
      cityFailures: cityStats.failures,
    };
    log(TAG, `alert blobs rebuilt`, result);
    blogInfo(
      TAG,
      `alert blobs: ${alertCount} alerts → ${written} shapes ` +
        `(${result.saved} fewer vertices to draw, ${cityStats.cities} cities covered)`,
      result,
      "alertBlobs",
      "refresh",
    );
    return result;
  } catch (err) {
    log(TAG, `alert blob rebuild failed`, summarizeForLog(err));
    blogErr(TAG, `alert blob rebuild failed`, err, "alertBlobs", "refresh");
    throw err;
  }
}
