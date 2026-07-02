// Seed world cities into the cities collection from GeoNames — the dataset
// behind the map's Cities overlay. Thin CLI wrapper over the shared seed core
// (worker/src/jobs/cities.ts#seedCities), the same code the admin "Reseed
// cities" button runs. Tier via env (default cities15000 ≈ 27k ≥15k population):
//
//   cd worker && yarn seed:cities                        # ≥15k (default)
//   CITIES_GEONAMES=cities5000  yarn seed:cities         # ≈55k, towns ≥5k
//   CITIES_GEONAMES=cities1000  yarn seed:cities         # ≈140k, small towns ≥1k
//   CITIES_GEONAMES=cities500   yarn seed:cities         # ≈200k, everything ≥500
import { loadWorkerEnv } from "../loadEnv";
loadWorkerEnv();

import { getAppDb } from "@photonsurge/shared/db/index";
import { DEFAULT_CITIES_TIER } from "@photonsurge/shared/cities/geonames";
import { seedCities } from "../jobs/cities";

(async () => {
  const tier = process.env.CITIES_GEONAMES || DEFAULT_CITIES_TIER;
  const result = await seedCities(tier);
  console.log(`[seedCities] inserted ${result.inserted} cities from ${tier}`);
  await (await getAppDb()).conn.close();
  process.exit(0);
})().catch((err) => {
  console.error("[seedCities]", err);
  process.exit(1);
});
