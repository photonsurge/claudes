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
 * Thin each finished blob to ~200m. AFTER the clip — see `DissolveOpts.simplifyDeg`.
 *
 * This used to thin the INPUTS, to keep the clipping cheap: source boundaries are
 * survey-grade (the worst hazard alone is ~1.15M vertices) to produce a shape the
 * overlay coarsens to ~5km before drawing it anyway, so the detail looked like
 * pure waste. It wasn't. Douglas-Peucker thins each ring along its OWN shape, so
 * two neighbours' shared border stopped matching and they stopped fusing — the
 * exact seam this job exists to remove.
 *
 * Measured properly: both variants, ONE snapshot of live alerts, bucket by bucket
 * (every earlier comparison here was runs minutes apart against a feed that was
 * still ingesting, which is why the numbers kept moving):
 *
 *     variant       | blobs | union failures | stored verts | wall
 *     --------------|-------|----------------|--------------|------
 *     thin inputs   |  574  |       20       |    294,828   |  33s
 *     thin output   |  565  |      113       |    305,089   | 137s   <- here
 *
 * FEWER BLOBS is the goal — it means more areas fused, which is fewer seams on
 * the globe. Thinning the output wins on the only metric that matters, and the
 * stored size is within 3.5%. It is honestly a narrow win: throws rise, because
 * clipping at full precision meets more coincident-edge pathology, and it costs
 * 4x the CPU. Both are worth it — a throw leaves two areas separate, which is
 * what thinning the inputs was silently doing to 63 pairs of genuinely-touching
 * regions anyway.
 *
 * Peak heap: 257MB. The 711MB this job was designed around was measured BEFORE
 * the two-pass streaming rewrite; RAM is no longer the binding constraint here.
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
    const slivers = { dropped: 0, vertices: 0 };
    let written = 0;
    let verticesBefore = 0;
    let verticesAfter = 0;

    for (const [key, ids] of buckets) {
      // `source`/`identifier` again, and they are NOT redundant with pass 1:
      // `dissolveAlerts` re-buckets what it's handed, so it decodes the country
      // from THESE documents. Without them every blob came back stamped
      // "unknown" while the log line above still printed pass 1's `heat|2|CN`,
      // so the split looked right on the globe and the label was silently empty.
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
      // city lookups, rather than holding it to the end of the iteration.
      members = null;
      unionFailures += r.unionFailures;
      slivers.dropped += r.slivers.dropped;
      slivers.vertices += r.slivers.vertices;

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

    // THE COMMIT. Everything written above is `live: false` and invisible until
    // this line: it flips the new generation on air and retires every older one,
    // in that order, so a reader sees the previous globe whole right up until it
    // sees the new one whole.
    //
    // A rebuild that dies before here therefore changes nothing on air. It used to
    // be the opposite: the shapes went straight to the globe as they landed and
    // the OLD ones were only dropped on this line, so a job killed mid-rebuild
    // left both sets live forever and every shape drew twice, stacked on itself.
    // Live, that was 3,871 stale shapes under 602 new ones — and it read as pairs
    // of identical overlapping warnings, which looks like a geometry bug.
    const committed = await db.alertBlobs.commitGeneration(builtAt);

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
      // Stale shapes swept by the commit. Steady state is 0 — a spike means the
      // previous rebuild died before committing.
      staleRemoved: committed.removed,
      // Hairline gaps left where two counties' borders don't match to the micron.
      // They're interior to the fused shape, so they come back as holes and the
      // globe draws a line round each one — the streaks across Poland. ~90% of all
      // holes, and 11% of every vertex we'd otherwise store. Real voids (a place
      // with no warning over it) are never dropped — see slivers.ts.
      sliverHolesDropped: slivers.dropped,
      sliverVerticesFreed: slivers.vertices,
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
