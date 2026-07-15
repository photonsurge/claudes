import type { Job } from "bullmq";
import { getAppDb } from "@photonsurge/shared/db/index";
import { log } from "@photonsurge/shared/utill/logger";
import { classifyHazard } from "@photonsurge/shared/alerts/hazard";
import type { iAlert } from "@photonsurge/shared/db/alert-model";
import { summarizeForLog } from "../utils";
import { blogInfo, blogErr } from "../blog";
import { dissolveAlerts } from "../alerts/dissolve";
import { attachCities } from "../alerts/blob-cities";

const TAG = "job:alert-blobs";

/**
 * Dispatched as type "alertBlobs", event "refresh". Dissolves touching warning
 * areas of the same hazard+severity into single shapes and caches them.
 *
 * MeteoAlarm issues one alert per county (~550 live for Poland alone), so the
 * globe drew confetti instead of weather. All the clipping happens HERE — public
 * only reads the cached shape and draws far fewer vertices for it.
 */
export async function refresh(_job: Job) {
  const db = await getAppDb();
  try {
    const alerts = (await db.alerts.model
      .find({ active: true }, { id: 1, maxSeverityRank: 1, "info.event": 1, "info.parameters": 1, "info.area.geometry": 1 })
      .lean()
      .exec()) as unknown as iAlert[];

    const { blobs, unionFailures } = dissolveAlerts(alerts, {
      hazardOf: (a) =>
        classifyHazard({ event: a.info?.[0]?.event, parameters: a.info?.[0]?.parameters }),
    });

    // Now that the shapes are final, record who's inside them. Doing it here —
    // once, against the geo index — is what stops every downstream reader
    // running its own point-in-polygon against a multi-country polygon.
    const cityStats = await attachCities(db.cities.model, blobs);

    const r = await db.alertBlobs.replace(blobs);
    const before = blobs.reduce((n, b) => n + b.verticesBefore, 0);
    const after = blobs.reduce((n, b) => n + b.verticesAfter, 0);
    const result = {
      alerts: alerts.length,
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
      cityFailures: cityStats.failures,
    };
    log(TAG, `alert blobs rebuilt`, result);
    blogInfo(
      TAG,
      `alert blobs: ${alerts.length} alerts → ${r.blobs} shapes ` +
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
