// scripts/resetWeather.ts — `yarn reset:weather`
// Wipe every baked WeatherRun + WeatherTexture and re-kick the WHOLE ingest fleet
// so it re-bakes from scratch onto the CURRENT grids. Use after a descriptor/grid
// change (e.g. an ICON-D2 bbox correction) or when runs look stale/misaligned — a
// normal poll would skip them as "already published".
//
// Enqueues the GFS base (weather.check) + one job per ENABLED source in the shared
// fleet list (weather/sourceSchedule.ts — same list index.ts schedules), so this
// repopulates WITHOUT needing a restart. It's also safe to just restart the worker
// instead: the boot-kick does the same. The worker must be running (or started
// right after) with `wgrib2`/`cdo` on PATH for the re-bake.
//
//   cd worker && yarn reset:weather   # then watch the worker logs re-bake
import { loadWorkerEnv } from "../loadEnv";
loadWorkerEnv();

import { getAppDb } from "@photonsurge/shared/db/index";
import { getSource } from "@photonsurge/shared/sources";
import { sendToQueue } from "@photonsurge/shared/bull/bull-queue";
import { WEATHER_SOURCE_JOBS } from "../weather/sourceSchedule";

(async () => {
  const db = await getAppDb();

  const tex = await db.weatherTextures.deleteMany({});
  const runs = await db.weatherRuns.deleteMany({});
  console.log(`[reset:weather] cleared ${runs.data?.count ?? 0} run(s) + ${tex.data?.count ?? 0} texture(s)`);

  const domain = process.env.APP_DOMAIN || "default";

  // GFS base (rain/pressure/cape/… — the non-nest globals).
  const check = await sendToQueue(domain, "weather", "check", {});
  console.log(`[reset:weather] enqueued weather.check (GFS base) id=${check.id}`);

  // Every enabled source ingest (nests + multi-supplier), the same set index.ts
  // schedules. Each is idempotent, so re-kicking now + a restart's boot-kick can't
  // double-bake (the second run skips).
  const enabled = WEATHER_SOURCE_JOBS.filter((j) => getSource(j.sourceId)?.enabled);
  for (const { event } of enabled) {
    const job = await sendToQueue(domain, "weather", event, {});
    console.log(`[reset:weather] enqueued weather.${event} id=${job.id}`);
  }

  console.log(
    `[reset:weather] done — ${enabled.length + 1} ingest job(s) queued. Watch the worker logs; ` +
      `the globe repopulates as each run publishes (or just restart the worker instead).`,
  );
  setTimeout(() => process.exit(0), 250);
})().catch((err) => {
  console.error("[reset:weather] failed:", err);
  process.exit(1);
});
