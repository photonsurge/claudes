import type { Job } from "bullmq";
import { getAppDb } from "@photonsurge/shared/db/index";
import { fetchStations } from "@photonsurge/shared/seismo/fdsn";
import { log } from "@photonsurge/shared/utill/logger";
import { summarizeForLog } from "../utils";
import { blogInfo, blogErr } from "../blog";
import { snapshotSeismo } from "../seismo/snapshot";

const TAG = "job:seismo";

/**
 * Dispatched as type "seismo", event "refreshStations". Rebuilds the global
 * GSN broadband-station catalog in Mongo. Near-static reference data (runs
 * daily); the snapshot job (`../seismo/snapshot.ts`) reads it to pick which
 * stations are near what's on air.
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

/**
 * Dispatched as type "seismo", event "snapshot". Takes one short seismograph
 * snapshot (open SeedLink → gather a window of waveform for the in-focus
 * stations → close → cache to Mongo). Registered as a repeatable job so the
 * worker does no seismic work between snapshots; replaces the old always-on
 * SeedLink stream. See `../seismo/snapshot.ts`.
 */
export async function snapshot(_job: Job) {
  try {
    const result = await snapshotSeismo();
    blogInfo(TAG, `seismo snapshot: ${result.cached} station(s)`, result, "seismo", "snapshot");
    return result;
  } catch (err) {
    log(TAG, `seismo snapshot failed`, summarizeForLog(err));
    blogErr(TAG, `seismo snapshot failed`, err, "seismo", "snapshot");
    throw err;
  }
}
