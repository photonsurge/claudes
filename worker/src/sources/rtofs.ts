// sources/rtofs.ts
// Pure helpers for the NOAA Global RTOFS ocean source (HYCOM 1/12°). The 2-D
// surface fields are published as GRIB2 on NOMADS on a REGULAR 0.08° lat-lon
// grid (≈72°S–84°N — poles are nodata), so they are drop-in: no regrid, same
// wgrib2 → bake path as GFS, just a different grid size.
//
// This replaces the "fake" SST (GFS surface air temp masked to sea) with a real
// ocean model and adds the headline currents (vector) + salinity layers.
//
// ⚠️ VERIFY the exact NOMADS filenames/dir and that you pull the LAT-LON GRIB2
// surface file (not the native curvilinear grid) against:
//   https://www.nco.ncep.noaa.gov/pmb/products/rtofs/
//   https://polar.ncep.noaa.gov/global/about/grib_description.shtml
// Enumerate the run directory rather than trusting these strings long-term.

/** RTOFS 0.08° lat-lon surface grid (84°N..72°S). */
export const RTOFS_GRID = { width: 4500, height: 1951, res: 0.08 } as const;
/** [west, south, east, north] — note the polar gap; bake nodata beyond. */
export const RTOFS_BOUNDS: [number, number, number, number] = [-180, -72, 180, 84];

export interface BuildRtofsUrlArgs {
  /** Run date as YYYYMMDD (UTC). */
  date: string;
  /**
   * Forecast/nowcast hour. RTOFS names nowcast files n003..n024 and forecast
   * files f003..f192; `kind` selects the prefix.
   */
  hour: number;
  kind?: "n" | "f";
}

const RTOFS_ROOT = "https://nomads.ncep.noaa.gov/pub/data/nccf/com/rtofs/prod";

/** Zero-pad an RTOFS hour to 3 digits. */
export function padRtofsHour(hour: number): string {
  return String(hour).padStart(3, "0");
}

/**
 * Build the direct NOMADS URL for an RTOFS 2-D surface "prog" GRIB2 file — the
 * prognostic surface bundle carrying SST, salinity and surface currents.
 *
 * Example:
 *   https://nomads.ncep.noaa.gov/pub/data/nccf/com/rtofs/prod/rtofs.20260628/
 *     rtofs_glo_2ds_f024_prog.grib2
 */
export function buildRtofsUrl({ date, hour, kind = "f" }: BuildRtofsUrlArgs): string {
  const hhh = padRtofsHour(hour);
  return `${RTOFS_ROOT}/rtofs.${date}/rtofs_glo_2ds_${kind}${hhh}_prog.grib2`;
}

/**
 * wgrib2 -match tokens per variable in the RTOFS 2-D prog GRIB2.
 *
 * ⚠️ VERIFY against `wgrib2 -inv` on a real file. RTOFS GRIB2 commonly uses
 * WTMP (water temp), UOGRD/VOGRD (ocean current u/v) and a salinity param that
 * may show as SALIN/SALTY/"Salinity" depending on the wgrib2 table — confirm.
 */
export const RTOFS_VAR_MATCH: Record<string, { match: string; level: string }[]> = {
  sst: [{ match: ":WTMP:", level: "surface" }],
  current: [
    { match: ":UOGRD:", level: "surface" },
    { match: ":VOGRD:", level: "surface" },
  ],
  salinity: [{ match: ":SALIN:", level: "surface" }],
};

/** RTOFS bake-unit conversions (worker, once, before baking). */
// SST arrives in K → °C (reuse shared kelvinToCelsius in the bake path).
// Currents arrive in m/s (identity). Salinity arrives in PSU (identity).

export interface RtofsRun {
  date: string;
  runDate: Date;
}

/** RTOFS latency (~16h to the ~16z publish of the 00z run). */
export const RTOFS_LATENCY_HOURS = 16;

function ymd(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

/**
 * Candidate RTOFS runs (one 00z run/day) newest-first, respecting latency. Each
 * day has a single nominal 00z run that publishes ~16z.
 */
export function rtofsCandidateRuns(now: Date, count = 4): RtofsRun[] {
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

/**
 * Latest available RTOFS run: probe each candidate's f000 prog file newest-first.
 */
export async function rtofsLatestAvailableRun(now: Date, fetchHead: FetchHead): Promise<RtofsRun> {
  const candidates = rtofsCandidateRuns(now);
  for (const cand of candidates) {
    const url = buildRtofsUrl({ date: cand.date, hour: 0, kind: "n" });
    try {
      if (await fetchHead(url)) return cand;
    } catch {
      // try next-oldest
    }
  }
  return candidates[0];
}
