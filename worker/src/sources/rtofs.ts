// sources/rtofs.ts
// NOAA Global RTOFS ocean source (HYCOM 1/12°).
//
// ⚠️ Verified against live NOMADS (2026): there is NO global RTOFS GRIB2 file.
//   - GRIB2 exists only as 11 REGIONAL windows (rtofs_glo.t00z.fNNN_<region>_std.grb2,
//     regular 0.08° lat-lon) that DON'T tile the globe — unusable for a global globe.
//   - The GLOBAL 2-D surface data is netCDF only (rtofs_glo_2ds_fNNN_prog.nc), on the
//     native TRIPOLAR 1/12° curvilinear grid (2-D lon/lat coord arrays). It must be
//     regridded to a regular lat-lon grid (see worker/src/regrid/curvilinear.ts).
//
// One 00z run/day; ~8h latency (poll, don't trust a fixed time). `.nc` files carry
// multiple forecast hours per file (fNNN = daily rollup).

/** RTOFS regrid target: global 1/12° regular lat-lon (−180..180, −90..90). */
export const RTOFS_TARGET_GRID = { width: 4320, height: 2160, res: 1 / 12 } as const;
export const RTOFS_TARGET_BOUNDS: [number, number, number, number] = [-180, -90, 180, 90];

/** The three global 2-D surface netCDF bundles and the fields each carries. */
export type RtofsBundle = "prog" | "diag" | "ice";

const NOMADS_PROD = "https://nomads.ncep.noaa.gov/pub/data/nccf/com/rtofs/prod";

/** Zero-pad an RTOFS hour to 3 digits. */
export function padRtofsHour(hour: number): string {
  return String(hour).padStart(3, "0");
}

export interface BuildRtofsUrlArgs {
  /** Run date as YYYYMMDD (UTC). */
  date: string;
  /** Forecast (f) / nowcast (n) hour; files are daily rollups (f024, f048…). */
  hour: number;
  kind?: "n" | "f";
  /** Which surface bundle. `prog` has SST/salinity/currents. */
  bundle?: RtofsBundle;
}

/**
 * Build the NOMADS URL for a GLOBAL RTOFS 2-D surface netCDF file.
 *
 * Example (prog, forecast +24h):
 *   https://nomads.ncep.noaa.gov/pub/data/nccf/com/rtofs/prod/rtofs.20260628/
 *     rtofs_glo_2ds_f024_prog.nc
 */
export function buildRtofsUrl({ date, hour, kind = "f", bundle = "prog" }: BuildRtofsUrlArgs): string {
  const hhh = padRtofsHour(hour);
  return `${NOMADS_PROD}/rtofs.${date}/rtofs_glo_2ds_${kind}${hhh}_${bundle}.nc`;
}

/**
 * netCDF variable names per app variable, and which bundle holds them. SST,
 * salinity and surface currents are all in `prog`.
 *
 * ⚠️ VERIFY the exact netCDF variable + coordinate names against an `ncdump -h`
 * of a real file — the tripolar prog file commonly uses `sst`, `sss`,
 * `u_velocity`, `v_velocity` with 2-D `Latitude`/`Longitude` coord arrays, but
 * confirm at ingest (the research could not dump the header remotely).
 */
export const RTOFS_NETCDF_VARS: Record<
  string,
  { bundle: RtofsBundle; vars: string[]; encoding: "scalar" | "uv" }
> = {
  sst: { bundle: "prog", vars: ["sst"], encoding: "scalar" },
  salinity: { bundle: "prog", vars: ["sss"], encoding: "scalar" },
  current: { bundle: "prog", vars: ["u_velocity", "v_velocity"], encoding: "uv" },
};

/** 2-D coordinate array names in the tripolar netCDF (VERIFY per §above). */
export const RTOFS_COORD_VARS = { lat: "Latitude", lon: "Longitude" } as const;

/**
 * Regional GRIB2 windows — the ONLY GRIB2 RTOFS output. Kept documented for a
 * possible future high-res regional overlay; NOT used for the global product
 * (they leave large open-ocean gaps). Files: rtofs_glo.t00z.fNNN_<region>_std.grb2,
 * regular 0.08° lat-lon, tokens WTMP/SALTY/UOGRD/VOGRD at "0 m below sea level".
 */
export const RTOFS_GRIB2_REGIONS = [
  "alaska", "arctic", "bering", "guam", "gulf_alaska", "honolulu",
  "hudson_baffin", "samoa", "trop_paci_lowres", "west_atl", "west_conus",
] as const;
export const RTOFS_GRIB2_MATCH: Record<string, string> = {
  sst: ":WTMP:0 m below sea level:",
  salinity: ":SALTY:0 m below sea level:",
};

export interface RtofsRun {
  date: string;
  runDate: Date;
}

/** RTOFS latency (~8h to publish the 00z run; poll rather than hard-code). */
export const RTOFS_LATENCY_HOURS = 8;

function ymd(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

/**
 * Candidate RTOFS runs (one 00z run/day) newest-first, respecting latency.
 * NOMADS keeps only ~today+yesterday, so 2 candidates is plenty.
 */
export function rtofsCandidateRuns(now: Date, count = 2): RtofsRun[] {
  const out: RtofsRun[] = [];
  const latencyMs = RTOFS_LATENCY_HOURS * 3600 * 1000;
  const base = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));
  for (let i = 0; i < count + 2 && out.length < count; i++) {
    const runDate = new Date(base.getTime() - i * 24 * 3600 * 1000);
    if (now.getTime() - runDate.getTime() >= latencyMs) {
      out.push({ date: ymd(runDate), runDate });
    }
  }
  return out;
}

/** Signature for an injected availability probe (HEAD/GET). */
export type FetchHead = (url: string) => Promise<boolean>;

/** Latest available RTOFS run: probe each candidate's prog file newest-first. */
export async function rtofsLatestAvailableRun(now: Date, fetchHead: FetchHead): Promise<RtofsRun> {
  const candidates = rtofsCandidateRuns(now);
  for (const cand of candidates) {
    const url = buildRtofsUrl({ date: cand.date, hour: 24, kind: "f", bundle: "prog" });
    try {
      if (await fetchHead(url)) return cand;
    } catch {
      // try next-oldest
    }
  }
  return candidates[0];
}
