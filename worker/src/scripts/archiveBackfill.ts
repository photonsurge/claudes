/**
 * Manual one-shot archive backfill — `yarn archive:backfill`. Walks every
 * published WeatherRun still in Mongo and copies its archive-eligible steps
 * (default f000/f003) into the long-term WeatherFrame collection. Idempotent:
 * frames upsert on (model, variable, validTime), so re-running is safe. Use it
 * once to seed history from the runs retention hasn't pruned yet.
 */
import { loadWorkerEnv } from "../loadEnv";
loadWorkerEnv();

import { getAppDb } from "@photonsurge/shared/db/index";
import { archiveRun } from "../weather/archive";

(async () => {
  const db = await getAppDb();
  const runs = await db.weatherRuns.getAll({ published: true }, { sort: { run: 1 } });
  const rows = runs.success && runs.data ? runs.data : [];
  console.log(`backfilling from ${rows.length} published run(s)…`);

  let total = 0;
  for (const run of rows) {
    const { written } = await archiveRun(db as any, run as any);
    total += written;
    console.log(`  ${run.model} ${new Date(run.run).toISOString()} → ${written} frame(s)`);
  }

  console.log(`done: ${total} frame(s) written; archive now holds ${await db.weatherFrames.count()}`);
  await db.conn.close();
  process.exit(0);
})().catch((err) => {
  console.error("archiveBackfill fatal:", err);
  process.exit(1);
});
