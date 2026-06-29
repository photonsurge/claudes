// Force a clean re-bake of the weather data.
//
// Deletes every WeatherRun + WeatherTexture, then enqueues `weather.check` so
// the worker re-ingests the latest GFS cycle from scratch. Use this after a
// pipeline change (e.g. a new/changed variable) so the published run picks it
// up — a normal `yarn pull` would skip the current cycle as "already published".
//
// The worker must be running (`yarn dev`) AND `wgrib2` on PATH for the re-bake.
//
//   cd worker && yarn reingest
import { loadWorkerEnv } from "../loadEnv";
loadWorkerEnv();

import { getAppDb } from "@photonsurge/shared/db/index";
import { sendToQueue } from "@photonsurge/shared/bull/bull-queue";

(async () => {
  const db = await getAppDb();

  const runs = await db.weatherTextures.deleteMany({});
  const docs = await db.weatherRuns.deleteMany({});
  console.log(
    `[reingest] cleared ${docs.data?.count ?? 0} run(s) + ${runs.data?.count ?? 0} texture(s)`,
  );

  const domain = process.env.APP_DOMAIN || "default";
  const job = await sendToQueue(domain, "weather", "check", {});
  console.log(`[reingest] enqueued weather.check job id=${job.id} — re-baking latest cycle`);

  setTimeout(() => process.exit(0), 250);
})().catch((err) => {
  console.error("[reingest] failed:", err);
  process.exit(1);
});
