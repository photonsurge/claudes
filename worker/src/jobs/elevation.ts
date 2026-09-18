import type { Job } from "bullmq";
import { log } from "@photonsurge/shared/utill/logger";
import { summarizeForLog } from "../utils";
import { blogInfo, blogErr } from "../blog";
import { ingestElevation } from "../weather/elevation";

const TAG = "job:elevation";

/**
 * Dispatched as type "elevation", event "refresh" — the admin "Bake elevation
 * relief" button. Downloads ETOPO 2022 terrain + bathymetry and bakes the static
 * elevation contour texture, publishing it as its own `elevation` run (which
 * emits `weather:run`, so the overlay hot-refreshes). Static reference geography,
 * so this is button/one-shot only — no scheduled cron.
 */
export async function refresh(job: Job) {
  // `force` comes from the preset payload on the "Re-bake elevation relief
  // (force)" button (shared/src/jobs.ts). Without it the bake reuses a published
  // run, which is what you want 99% of the time — but not when the bake needs
  // redoing at a new resolution or from a re-cached DEM.
  const force = job?.data?.data?.force === true;
  try {
    const r = await ingestElevation({ force });
    log(TAG, "elevation bake done", { ...r, force });
    blogInfo(
      TAG,
      `elevation bake: ${r.width}×${r.height} relief texture${force ? " (forced)" : ""}`,
      { ...r, force },
      "elevation",
      "refresh",
    );
    return r;
  } catch (err) {
    log(TAG, "elevation bake failed", summarizeForLog(err));
    blogErr(TAG, "elevation bake failed", err, "elevation", "refresh");
    throw err;
  }
}
