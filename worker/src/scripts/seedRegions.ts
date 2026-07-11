/**
 * Manual one-shot region catalog seed — `yarn seed:regions`. Upserts the
 * curated `REGION_PRESETS` (oceans/continents/sub-regions) into the
 * `Region` collection. Prunes regions dropped from the presets on each run.
 */
import { loadWorkerEnv } from "../loadEnv";
loadWorkerEnv();

import { getAppDb } from "@photonsurge/shared/db/index";
import { runRegionSeed } from "../jobs/regions";

(async () => {
  const res = await runRegionSeed();
  console.log("regions seed:", res);
  await (await getAppDb()).conn.close();
  process.exit(0);
})().catch((err) => {
  console.error("seedRegions fatal:", err);
  process.exit(1);
});
