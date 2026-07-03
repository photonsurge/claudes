/**
 * Manual one-shot satellite-imagery refresh — `yarn refresh:satimg [satId]`.
 * Spawns the satpy sidecar, bakes one full-disk into Mongo, and prints the totals.
 * Use this to seed / smoke-test the bake without waiting out the worker cron.
 *
 * Requires the satpy venv (see WORKER.md) and SATIMG_PYTHON pointing at it, e.g.:
 *   SATIMG_PYTHON=worker/.venv-satimg/bin/python yarn refresh:satimg
 */
import { loadWorkerEnv } from "../loadEnv";
loadWorkerEnv();

import type { Job } from "bullmq";
import { getAppDb } from "@photonsurge/shared/db/index";
import { refresh } from "../jobs/satimg";

(async () => {
  const satId = process.argv[2] || "himawari9";
  const res = await refresh({ id: "manual", data: { data: { satellite: satId } } } as unknown as Job);
  console.log("satimg refresh:", res);
  const db = await getAppDb();
  console.log("frames in Mongo:", await db.satimg.count());
  await db.conn.close();
  process.exit(0);
})().catch((err) => {
  console.error("refreshSatimg fatal:", err);
  process.exit(1);
});
