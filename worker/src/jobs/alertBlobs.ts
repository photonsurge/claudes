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

export async function refresh(_job: Job) {
  const db = await getAppDb();
  try {
    // Pass 1: group WITHOUT the geometry. Loading every active alert's polygons
    // at once was ~5M vertices in one array — several GB of JS objects before
    // clipping allocates a thing, and it OOM'd the worker at its 4GB heap while
    // blocking the loop long enough to drop job locks. The bucket an alert lands
    // in depends only on its hazard + severity, so work that out cheaply first
    // and let each bucket fetch its own shapes.
    const index = (await db.alerts.model
      .find({ active: true }, { _id: 0, id: 1, maxSeverityRank: 1, "info.event": 1, "info.parameters": 1 })
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

    // Pass 2: one hazard at a time. Peak memory is now the BIGGEST bucket, not
    // the planet, and each bucket's geometry is released before the next loads.
    const blobs: AlertBlobInput[] = [];
    const cityStats: BlobCityStats = { cities: 0, empty: 0, repaired: 0, failures: 0 };
    let unionFailures = 0;

    for (const [key, ids] of buckets) {
      const members = (await db.alerts.model
        .find(
          { id: { $in: ids } },
          { _id: 0, id: 1, maxSeverityRank: 1, "info.event": 1, "info.parameters": 1, "info.area.geometry": 1 },
        )
        .lean()
        .exec()) as unknown as iAlert[];

      const r = await dissolveAlerts(members, { hazardOf });
      unionFailures += r.unionFailures;

      // Record who's inside the shapes while this bucket is still the only one
      // in memory. Doing it here — once, against the geo index — is what stops
      // every downstream reader running its own point-in-polygon.
      const cs = await attachCities({ cities: db.cities.model, alerts: db.alerts.model }, r.blobs);
      cityStats.cities += cs.cities;
      cityStats.empty += cs.empty;
      cityStats.repaired += cs.repaired;
      cityStats.failures += cs.failures;

      blobs.push(...r.blobs);
      log(TAG, `dissolved ${key}`, { alerts: ids.length, blobs: r.blobs.length, cities: cs.cities });
      await breathe();
    }

    const r = await db.alertBlobs.replace(blobs);
    const before = blobs.reduce((n, b) => n + b.verticesBefore, 0);
    const after = blobs.reduce((n, b) => n + b.verticesAfter, 0);
    const result = {
      alerts: alertCount,
      blobs: r.blobs,
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
      `alert blobs: ${alertCount} alerts → ${r.blobs} shapes ` +
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
