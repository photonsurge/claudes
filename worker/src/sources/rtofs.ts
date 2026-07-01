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

/**
 * cdo remap target. The global 2ds netCDF is CURVILINEAR (tripolar), which GRIB2
 * can't encode, so `cdo -remapbil,global_0.08` bilinearly interpolates the 2-D
 * lat/lon coords onto a regular global grid. `global_<res>` is cdo's predefined
 * global lon-lat grid (−180..180, −90..90, cell-centred). We then extract that
 * grid DIRECTLY (no wgrib2 -new_grid — cdo mangles the GRIB2 time, which trips
 * -new_grid into empty output; and a second regrid would just double-interpolate).
 */
export const RTOFS_CDO_REMAP_GRID = "global_0.08";
/** MUST match global_0.08 dims: 360/0.08 = 4500 lon, 180/0.08 = 2250 lat. */
export const RTOFS_TARGET_GRID = { width: 4500, height: 2250, res: 0.08 } as const;
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
 * Per app-variable: the netCDF variable name(s) (for `cdo -selname`) AND the
 * GRIB2 -match token(s) after cdo→grib2 (for `wgrib2 -match`). These are TWO
 * different namespaces — cdo selects by netCDF name, wgrib2 matches by GRIB2
 * shortName — so don't conflate them. All three live in the `prog` bundle.
 *
 * GRIB2 tokens CONFIRMED from a live `wgrib2` inventory of the cdo output:
 * cdo maps sst→WTMP, salinity→PRACTSAL, currents→UOGRD/VOGRD. cdo does NOT convert
 * units, so the values are the netCDF's (RTOFS sst is °C, salinity psu) even though
 * WTMP is nominally a Kelvin param → bake with `skipUnitConvert` (no K→°C).
 */
export const RTOFS_VARS: Record<
  string,
  { bundle: RtofsBundle; encoding: "scalar" | "uv"; ncVars: string[]; gribMatch: string[]; displayUnits: boolean }
> = {
  sst: { bundle: "prog", encoding: "scalar", ncVars: ["sst"], gribMatch: [":WTMP:"], displayUnits: true },
  salinity: { bundle: "prog", encoding: "scalar", ncVars: ["sss"], gribMatch: [":PRACTSAL:"], displayUnits: true },
  current: { bundle: "prog", encoding: "uv", ncVars: ["u_velocity", "v_velocity"], gribMatch: [":UOGRD:", ":VOGRD:"], displayUnits: true },
};

/** 2-D coordinate array names (only needed for the pure-JS regrid fallback). */
export const RTOFS_COORD_VARS = { lat: "Latitude", lon: "Longitude" } as const;

/**
 * Regional GRIB2 windows — the ONLY *native* GRIB2 RTOFS output. NOT used for the
 * global product (they leave large open-ocean gaps: no Indian Ocean, S. Atlantic).
 * Kept for a possible future high-res regional overlay. Files:
 * rtofs_glo.t00z.{n|f}NNN_<region>_std.grb2, regular 0.08° lat-lon; note the native
 * regional tiles use WTMP (K) not WTMPC — different from the cdo-converted global.
 */
export const RTOFS_GRIB2_REGIONS = [
  "alaska", "arctic", "bering", "guam", "gulf_alaska", "honolulu",
  "samoa", "trop_paci_lowres", "west_atl", "west_conus",
] as const;

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
