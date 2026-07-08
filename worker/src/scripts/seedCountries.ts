/**
 * Manual one-shot country catalog seed — `yarn seed:countries`. Parses the
 * bundled Natural Earth admin-0 GeoJSON into the `Country` collection
 * (name/iso codes/continent/subregion/bbox/simplified boundary geometry).
 * Requires `public/public/data/countries.geojson` — run `./fetch-assets.sh`
 * first if it's missing.
 */
import { loadWorkerEnv } from "../loadEnv";
loadWorkerEnv();

import { getAppDb } from "@photonsurge/shared/db/index";
import { runCountrySeed } from "../jobs/countries";

(async () => {
  const res = await runCountrySeed();
  console.log("countries seed:", res);
  await (await getAppDb()).conn.close();
  process.exit(0);
})().catch((err) => {
  console.error("seedCountries fatal:", err);
  process.exit(1);
});
