import { loadWorkerEnv } from "../loadEnv";
loadWorkerEnv();

import type { Job } from "bullmq";
import { getAppDb } from "@photonsurge/shared/db/index";
import {
  snapshotSatellite,
  snapshotCompare,
  snapshotCameras,
  cameraSnapshotsEnabled,
} from "../jobs/alerts";

/**
 * One-shot: run the full alert-snapshot pipeline for the current interesting
 * active alerts — satellite frames → side-by-side comparisons → nearby-camera
 * stills (only when ALERT_CAMERA_SNAPSHOT_ENABLED=true). `yarn refresh:alert-snapshots`.
 * Needs Mongo (+ BLOB_DIR for on-disk bytes) and ALERT_SNAPSHOT_ENABLED not "false".
 */
const fakeJob = { id: "manual", data: { data: {} } } as unknown as Job;

(async () => {
  console.log("satellite:", await snapshotSatellite(fakeJob));
  console.log("compare:", await snapshotCompare(fakeJob));
  if (cameraSnapshotsEnabled()) console.log("cameras:", await snapshotCameras(fakeJob));
  const db = await getAppDb();
  console.log("total snapshots in Mongo:", await db.alertSnapshots.count());
  await db.conn.close();
  process.exit(0);
})().catch((err) => {
  console.error("refreshAlertSnapshots fatal:", err);
  process.exit(1);
});
