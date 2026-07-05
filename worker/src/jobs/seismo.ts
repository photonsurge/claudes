import type { Job } from "bullmq";
import { getAppDb } from "@photonsurge/shared/db/index";
import { fetchStations } from "@photonsurge/shared/seismo/fdsn";
import { log } from "@photonsurge/shared/utill/logger";
import { summarizeForLog } from "../utils";
import { blogInfo, blogErr } from "../blog";

const TAG = "job:seismo";

/**
 * Dispatched as type "seismo", event "refreshStations". Rebuilds the global
 * GSN broadband-station catalog in Mongo. Near-static reference data (runs
 * daily); the live SeedLink loop (`../seismo/loop.ts`) reads it to pick which
 * stations are near what's on air. The live streaming itself is NOT a BullMQ
 * job — it's a persistent connection started once at worker boot.
 */
export async function refreshStations(_job: Job) {
  const db = await getAppDb();
  try {
    const stations = await fetchStations();
    const r = await db.seismoStations.replace(stations);
    const result = { stations: r.stations };
    log(TAG, `seismo stations refresh done`, result);
    blogInfo(TAG, `seismo stations: ${r.stations} stations`, result, "seismo", "refreshStations");
    return result;
  } catch (err) {
    log(TAG, `seismo stations refresh failed`, summarizeForLog(err));
    blogErr(TAG, `seismo stations refresh failed`, err, "seismo", "refreshStations");
    throw err;
  }
}
