// sources/rtofsDepth.ts
// NOAA Global RTOFS ocean temperature-at-depth source (HYCOM 1/12°).
//
// Sibling to `rtofs.ts` (surface SST/salinity/current), targeting the GLOBAL
// 3-D temperature cube instead of the 2-D surface bundle:
//   rtofs_glo_3dz_{n|f}NNN_daily_3ztio.nc
// Verified live against NOMADS (2026): same tripolar 1/12° curvilinear grid as
// the 2ds surface product, netCDF var `temperature` (degC, already display
// units), on a fixed 33-level `Depth` dimension (metres):
//   0,10,20,30,50,75,100,125,150,200,250,300,400,500,600,700,800,900,1000,
//   1100,1200,1300,1400,1500,1750,2000,2500,3000,3500,4000,4500,5000,5500
// Each file is ~816MB (~5x the 2ds file), so only the daily nowcast (n024) is
// pulled — RTOFS itself only updates once/day, so forecast horizons add
// nothing for a "what does the ocean look like now" globe.

import { rtofsCandidateRuns, type FetchHead, type RtofsRun } from "./rtofs";

const NOMADS_PROD = "https://nomads.ncep.noaa.gov/pub/data/nccf/com/rtofs/prod";

/** The 4 sub-surface depth chapters shown on the globe (metres). Surface (0m)
 *  reuses the existing `sst` variable — no separate ingest needed for it. */
export const RTOFS_DEPTH_LEVELS_M = [100, 500, 2000, 5000] as const;
export type RtofsDepthLevel = (typeof RTOFS_DEPTH_LEVELS_M)[number];

/** Depth (m) -> app variable id, registered in shared/src/variables.ts. */
export const RTOFS_DEPTH_VARIABLE_IDS: Record<RtofsDepthLevel, string> = {
  100: "sst100",
  500: "sst500",
  2000: "sst2000",
  5000: "sst5000",
};

/** Zero-pad an RTOFS hour to 3 digits (mirrors rtofs.ts). */
function padRtofsHour(hour: number): string {
  return String(hour).padStart(3, "0");
}

export interface BuildRtofsDepthUrlArgs {
  /** Run date as YYYYMMDD (UTC). */
  date: string;
  /** Forecast (f) / nowcast (n) hour. Only n024 is used in practice. */
  hour?: number;
  kind?: "n" | "f";
}

/**
 * Build the NOMADS URL for the GLOBAL RTOFS 3-D temperature-at-depth netCDF.
 *
 * Example (nowcast, +24h):
 *   https://nomads.ncep.noaa.gov/pub/data/nccf/com/rtofs/prod/rtofs.20260705/
 *     rtofs_glo_3dz_n024_daily_3ztio.nc
 */
export function buildRtofsDepthUrl({ date, hour = 24, kind = "n" }: BuildRtofsDepthUrlArgs): string {
  const hhh = padRtofsHour(hour);
  return `${NOMADS_PROD}/rtofs.${date}/rtofs_glo_3dz_${kind}${hhh}_daily_3ztio.nc`;
}

/**
 * Latest available RTOFS depth run: probe the actual n024 3dz file (not a
 * proxy from the surface pipeline), newest-first. Candidate dates (and their
 * ~8h publish latency) come from `rtofsCandidateRuns` in rtofs.ts — same
 * daily 00z run the surface product comes from.
 */
export async function rtofsDepthLatestAvailableRun(now: Date, fetchHead: FetchHead): Promise<RtofsRun> {
  const candidates = rtofsCandidateRuns(now);
  for (const cand of candidates) {
    const url = buildRtofsDepthUrl({ date: cand.date, hour: 24, kind: "n" });
    try {
      if (await fetchHead(url)) return cand;
    } catch {
      // try next-oldest
    }
  }
  return candidates[0];
}
