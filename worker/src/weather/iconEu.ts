// weather/iconEu.ts
// Ingest core for the DWD ICON-EU (all-Europe 6.5 km) regional NEST. Worker-only:
// download the bzip2-compressed regular-lat-lon GRIB2 (one file per DWD field per
// step), bunzip2 → wgrib2-resample onto the descriptor's exact regular grid over
// the icon-eu bbox → bake (scalar for temp/gust/humidity, uv vector for wind) →
// publish a per-model run tagged as a nest (sourceId/resolutionDeg/bbox/priority).
//
// Mirrors ingestIconD2 exactly: all the shared machinery (bunzip2, descriptor
// `-new_grid`, the wind-fixed per-component regrid, the per-step/per-variable
// bake loop, idempotency, throttle, temp cleanup) lives in iconCommon.ts. This
// file only supplies ICON-EU's per-source knobs.

import { getSource } from "@photonsurge/shared/sources";

import { ingestIconNest, type IngestResult } from "./iconCommon";
import {
  buildIconEuUrl,
  iconEuLatestAvailableRun,
  ICON_EU_VAR_TOKENS,
  ICON_EU_FIELD_MATCH,
  padIconEuStep,
} from "../sources/iconEu";

export type { IngestResult } from "./iconCommon";

/**
 * ICON-EU forecast steps. Live nest → keep it light: f0..f6 hourly by default
 * (env `ICON_EU_FORECAST_HOURS`), enough for the dead-reckoning window without
 * hammering DWD for the full 120 h.
 */
export function iconEuForecastSteps(): number[] {
  const max = Number(process.env.ICON_EU_FORECAST_HOURS || 6);
  const out: number[] = [];
  for (let h = 0; h <= max; h++) out.push(h);
  return out;
}

/**
 * Ingest the latest ICON-EU run and publish it as the "icon-eu" nest.
 * Idempotent + throttled; temp files cleaned in `finally`.
 */
export async function ingestIconEu(now = new Date()): Promise<IngestResult> {
  const source = getSource("icon-eu")!;
  return ingestIconNest(
    {
      sourceId: source.id,
      varTokens: ICON_EU_VAR_TOKENS,
      fieldMatch: ICON_EU_FIELD_MATCH,
      buildUrl: buildIconEuUrl,
      latestRun: iconEuLatestAvailableRun,
      steps: iconEuForecastSteps(),
      padStep: padIconEuStep,
    },
    now,
  );
}
