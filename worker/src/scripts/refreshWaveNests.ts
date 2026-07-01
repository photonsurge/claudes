/**
 * Manual one-shot GFS-Wave basin nests ingest — `yarn refresh:wave-nests`.
 * Thin wrapper around `ingestWaveNests()` (worker/src/weather/waveNests.ts), the
 * same function the scheduled BullMQ job calls. Downloads each finer 0.16° basin
 * grid (atlocn/epacif/wcoast/ecg), subsets/bakes it on its own regional grid, and
 * publishes one run per basin (model="gfswave-<basin>"). Needs network + `wgrib2`.
 */
import { loadWorkerEnv } from "../loadEnv";
loadWorkerEnv();

import { ingestWaveNests } from "../weather/waveNests";

(async () => {
  console.log("refresh:wave-nests —", await ingestWaveNests());
  process.exit(0);
})().catch((err) => {
  console.error("refreshWaveNests fatal:", err);
  process.exit(1);
});
