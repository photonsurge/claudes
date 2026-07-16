import type { Job } from "bullmq";
import { getAppDb } from "@photonsurge/shared/db/index";
import { log } from "@photonsurge/shared/utill/logger";
import { classifyHazard } from "@photonsurge/shared/alerts/hazard";
import type { iAlert } from "@photonsurge/shared/db/alert-model";
import { summarizeForLog } from "../utils";
import { blogInfo, blogErr } from "../blog";
import { dissolveAlerts, bucketKeyOf, type AlertBlobInput } from "../alerts/dissolve";
import { attachCities, type BlobCityStats } from "../alerts/blob-cities";

const TAG = "job:alert-blobs";

/**
 * Dispatched as type "alertBlobs", event "refresh". Dissolves touching warning
 * areas of the same hazard+severity into single shapes and caches them.
 *
 * MeteoAlarm issues one alert per county (~550 live for Poland alone), so the
 * globe drew confetti instead of weather. All the clipping happens HERE — public
 * only reads the cached shape and draws far fewer vertices for it.
 */
const hazardOf = (a: iAlert) =>
  classifyHazard({ event: a.info?.[0]?.event, parameters: a.info?.[0]?.parameters });

/**
 * Hand the event loop back between hazards.
 *
 * A backstop, not the fix: yielding only here was tried and was NOT enough —
 * `heat|3` alone is ~750 alerts and blocked for far longer than BullMQ's
 * lock-renewal interval, so the worker still dropped the locks on its other jobs.
 * The real yielding happens inside the dissolve, between areas.
 */
const breathe = () => new Promise<void>((r) => setImmediate(r));

/**
 * Thin each area to ~200m before clipping.
 *
 * The source boundaries are survey-grade — the worst hazard alone is ~1.15M
 * vertices — and clipping at that precision is where the time and the memory go,
 * to produce a shape `/api/alerts/blobs` then simplifies to ~0.05° (~5km) before
 * drawing it anyway. The detail was being clipped and thrown away.
 *
 * The VALUE is measured, not guessed, and there is a cliff. Whole job, same live
 * data, back to back:
 *
 *     tolerance | blobs | union failures | wall
 *     ----------|-------|----------------|------
 *     0 (exact) |  588  |       34       | 108s
 *     0.002     |  599  |       14       |  37s   <- here
 *     0.005     |  612  |      122       |  27s
 *     0.01      |  604  |      123       |  20s
 *
 * 200m has FEWER union failures than full precision: the near-coincident edges
 * polygon-clipping chokes on get cleaned up rather than mangled. Past that the
 * cliff is sharp — at 500m+ each area thins along its OWN shape, so neighbours'
 * shared borders drift apart, they stop fusing, and failures jump 9×. That is
 * the same mechanism that leaves white seams between provinces in the raw
 * overlay, so don't "optimise" this number upward: it buys seconds and costs
 * correctness.
 *
 * Grid-SNAPPING was tried as the topology-safe alternative (snap.ts) and
 * measured worse on every axis — it introduces its own degenerate rings (blobs
 * 68 -> 81, failures 33 -> 41 on the worst bucket). Kept for reference; not used.
 *
 * 200m is well under the ~5km the globe draws, and under what "which cities are
 * inside this warning" can meaningfully resolve.
 */
const DISSOLVE_SIMPLIFY_DEG = Number(process.env.ALERT_DISSOLVE_SIMPLIFY_DEG || 0.002);

export async function refresh(_job: Job) {
  const db = await getAppDb();
  try {
    // Pass 1: group WITHOUT the geometry. Loading every active alert's polygons
    // at once was ~5M vertices in one array — several GB of JS objects before
    // clipping allocates a thing, and it OOM'd the worker at its 4GB heap while
    // blocking the loop long enough to drop job locks. The bucket an alert lands
    // in depends only on its hazard + severity, so work that out cheaply first
    // and let each bucket fetch its own shapes.
    //
    // `source` and `identifier` are here because the country is decoded from them
    // and the country is part of the bucket key. Drop them from this projection
    // and every alert quietly buckets as "unknown", which is not an error anyone
    // sees — it's just Europe fusing into one shape again.
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

    // Pass 2: one hazard at a time, WRITTEN as we go.
    //
    // Peak memory is the bucket being clipped and nothing else. Accumulating the
    // finished shapes instead (~1.9M vertices) meant carrying the whole output on
    // top of the live clip, and this worker shares a 4GB heap with ten other
    // jobs — it OOM'd mid-rebuild alongside a weather refresh. Each hazard's
    // shapes go to Mongo tagged with this generation; the previous generation is
    // retired only at the very end, so a reader mid-rebuild still sees a complete
    // globe.
    const builtAt = new Date();
    const cityStats: BlobCityStats = { cities: 0, empty: 0, repaired: 0, failures: 0 };
    let unionFailures = 0;
    let written = 0;
    let verticesBefore = 0;
    let verticesAfter = 0;

    for (const [key, ids] of buckets) {
      let members: iAlert[] | null = (await db.alerts.model
        .find(
          { id: { $in: ids } },
          { _id: 0, id: 1, maxSeverityRank: 1, "info.event": 1, "info.parameters": 1, "info.area.geometry": 1 },
        )
        .lean()
        .exec()) as unknown as iAlert[];

      const r = await dissolveAlerts(members, { hazardOf, simplifyDeg: DISSOLVE_SIMPLIFY_DEG });
      // The source geometry is the biggest thing here (~240MB for the worst
      // hazard) and the dissolve has taken what it needs — let it go before the
      // city lookups, rather than holding it to the end of the iteration.
      members = null;
      unionFailures += r.unionFailures;

      // Record who's inside the shapes while this bucket is still the only one
      // in memory. Doing it here — once, against the geo index — is what stops
      // every downstream reader running its own point-in-polygon.
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

    // Only now retire the old generation — never before the new one is complete.
    await db.alertBlobs.dropOlderThan(builtAt);

    const before = verticesBefore;
    const after = verticesAfter;
    const result = {
      alerts: alertCount,
      blobs: written,
      verticesBefore: before,
      verticesAfter: after,
      saved: before ? `${Math.round((1 - after / before) * 100)}%` : "0%",
      // polygon-clipping refuses some real-world borders; those areas simply
      // stayed separate rather than taking the rebuild down.
      unionFailures,
      cities: cityStats.cities,
      // Blobs over open sea or empty ground legitimately hold nobody; a spike
      // here would mean the shapes stopped matching the city index.
      blobsWithNoCities: cityStats.empty,
      // Shapes S2 refused, answered from their member counties instead. These are
      // the BIG fused blobs — the more areas union, the likelier a bad ring — so
      // this climbing is expected, not alarming; `cityFailures` is the alarm.
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
