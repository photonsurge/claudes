// weather/iconD2.ts
// Ingest core for the DWD ICON-D2 (Europe) regional NEST. Worker-only: download
// the bzip2-compressed regular-lat-lon GRIB2 (one file per DWD field per step),
// bunzip2 → wgrib2-resample onto the descriptor's exact regular grid over the
// icon-d2 bbox → bake (scalar for temp/gust/humidity, uv vector for wind) →
// publish a per-model run tagged as a nest (sourceId/resolutionDeg/bbox/priority).
//
// The heavy lifting (bunzip2, descriptor `-new_grid`, the wind-fixed regrid, the
// per-step/per-variable bake loop) lives in iconCommon.ts and is SHARED with the
// ICON-EU nest; this file only supplies ICON-D2's per-source knobs.
//
// Mirrors ingestRtofs/ingestIfs in multiSource.ts: idempotent (skip if the run
// is already published), throttled (nomadsGate), temp cleanup in finally.

import { getSource } from "@photonsurge/shared/sources";

import { ingestIconNest, type IngestResult } from "./iconCommon";
import {
  buildIconD2Url,
  iconD2LatestAvailableRun,
  ICON_D2_VAR_TOKENS,
  ICON_D2_FIELD_MATCH,
  padIconD2Step,
} from "../sources/iconD2";

export type { IngestResult } from "./iconCommon";
export { bunzip2ToFile } from "./iconCommon";

/**
 * ICON-D2 forecast steps. The descriptor is a live nest, so we keep it light:
 * f0..f6 hourly by default (env `ICON_D2_FORECAST_HOURS`), enough for the
 * dead-reckoning window without hammering DWD for the full 48 h.
 */
export function iconD2ForecastSteps(): number[] {
  const max = Number(process.env.ICON_D2_FORECAST_HOURS || 6);
  const out: number[] = [];
  for (let h = 0; h <= max; h++) out.push(h);
  return out;
}

/**
 * Ingest the latest ICON-D2 run and publish it as the "icon-d2" nest.
 * Idempotent + throttled; temp files cleaned in `finally`.
 */
export async function ingestIconD2(now = new Date()): Promise<IngestResult> {
  const source = getSource("icon-d2")!;
  return ingestIconNest(
    {
      sourceId: source.id,
      varTokens: ICON_D2_VAR_TOKENS,
      fieldMatch: ICON_D2_FIELD_MATCH,
      buildUrl: buildIconD2Url,
      latestRun: iconD2LatestAvailableRun,
      steps: iconD2ForecastSteps(),
      padStep: padIconD2Step,
    },
    now,
  );
}
