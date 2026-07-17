/**
 * The alert-blob rebuild, run as its OWN process (forked by the `alertBlobs` job).
 *
 * The dissolve is heavy synchronous CPU — one polygon-clipping union on the worst
 * hazard can hold the event loop long enough that the worker stops answering
 * `/healthz` and BullMQ drops the locks on its other jobs. A single union can't be
 * yielded mid-flight, so the whole rebuild is moved off the main worker here.
 *
 * It does its OWN Mongo I/O — the parent hands it nothing but the go-ahead, and it
 * hands back only a small result summary over IPC. That is deliberate: the source
 * geometry is ~240MB for the worst hazard, and structured-cloning that across the
 * process boundary is exactly the OOM this design avoids. A separate process (not a
 * worker thread) also means a rebuild that blows its heap kills only this child —
 * the worker carries on, and BullMQ retries the job.
 */
import { loadWorkerEnv } from "../loadEnv";
loadWorkerEnv();

import { getAppDb } from "@photonsurge/shared/db/index";
import { log } from "@photonsurge/shared/utill/logger";
import { rebuildAlertBlobs } from "./rebuildBlobs";

const TAG = "alert-blobs:child";

const send = (msg: { ok: true; result: unknown } | { ok: false; error: string }) => {
  if (process.send) process.send(msg);
  else console.log(JSON.stringify(msg)); // stand-alone run (no IPC channel)
};

(async () => {
  const db = await getAppDb();
  try {
    // Set by the parent when the job carried the admin button's `force` flag —
    // re-dissolve everything, ignoring the per-bucket fingerprints.
    const result = await rebuildAlertBlobs(db, { force: process.env.ALERT_DISSOLVE_FORCE === "1" });
    send({ ok: true, result });
    await db.conn.close();
    process.exit(0);
  } catch (err) {
    const error = String((err as Error)?.message ?? err);
    log(TAG, `rebuild failed`, { error });
    send({ ok: false, error });
    try {
      await db.conn.close();
    } catch {
      /* closing after a failure is best-effort */
    }
    process.exit(1);
  }
})().catch((err) => {
  send({ ok: false, error: String((err as Error)?.message ?? err) });
  process.exit(1);
});
