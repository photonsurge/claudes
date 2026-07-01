/**
 * Manual one-shot GFS-Wave mosaic ingest — `yarn refresh:waves`.
 * Thin wrapper around `ingestWaveMosaic()` (worker/src/weather/multiSource.ts),
 * which the scheduled BullMQ job also calls: fetch the regional wave tiles, regrid
 * each to a common global grid, composite by priority, bake, publish
 * model="gfswave-mosaic". Needs network to NOMADS + wgrib2 (-new_grid).
 */
import { loadWorkerEnv } from "../loadEnv";
loadWorkerEnv();

import { ingestWaveMosaic } from "../weather/multiSource";

(async () => {
  console.log("refresh:waves —", await ingestWaveMosaic());
  process.exit(0);
})().catch((err) => {
  console.error("refreshWaveMosaic fatal:", err);
  process.exit(1);
});
