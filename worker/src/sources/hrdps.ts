// sources/hrdps.ts
// Pure helpers for the ECCC HRDPS 2.5 km (Canada) regional nest via the KEYLESS
// MSC datamart (dd.weather.gc.ca). Network access is always injected so these
// functions are unit-testable.
//
// HRDPS's NATIVE grid is ROTATED lat-lon (rotated pole), NOT a regular grid, so
// after downloading each per-variable GRIB2 the ingest MUST regrid it to a
// regular lat-lon subset (wgrib2 -new_grid latlon) over the HRDPS bbox before
// baking. And because the native winds are GRID-relative (`winds(grid)`), the
// U/V pair MUST be regridded TOGETHER in one wgrib2 invocation with
// `-new_grid_winds earth` (see worker/src/weather/hrdps.ts).
//
// The descriptor (shared/src/sources.ts → getSource("hrdps")) is the source of
// truth for bbox/dims/resolution; the -new_grid spec here is derived from it so
// the regridded grid EXACTLY matches the descriptor dims {2490,957}.
//
// VERIFIED against a live file (2026-07-01 00Z):
//   path : https://dd.weather.gc.ca/<YYYYMMDD>/WXO-DD/model_hrdps/continental/2.5km/<HH>/<hhh>/
//   file : <YYYYMMDD>T<HH>Z_MSC_HRDPS_<VAR>_RLatLon0.0225_PT<hhh>H.grib2
//   vars : TMP_AGL-2m / UGRD_AGL-10m / VGRD_AGL-10m / GUST_AGL-10m / RH_AGL-2m

import { getSource } from "@photonsurge/shared/sources";

// ── Regrid target: descriptor bbox/dims → wgrib2 -new_grid latlon spec ─────────
const HRDPS_SOURCE = getSource("hrdps")!;

/** HRDPS continental bbox [W,S,E,N] straight from the descriptor. */
export const HRDPS_BBOX = HRDPS_SOURCE.bbox as [number, number, number, number];
/** Regular-latlon regrid grid dims (matches the descriptor `dims` {2490,957}). */
const HRDPS_DIMS = HRDPS_SOURCE.dims ?? { width: 2490, height: 957 };
export const HRDPS_GRID = {
  width: HRDPS_DIMS.width,
  height: HRDPS_DIMS.height,
  res: HRDPS_SOURCE.resolutionDeg,
} as const;

/**
 * Build the wgrib2 `-new_grid latlon lon0:nx:dlon lat0:ny:dlat` spec that
 * projects HRDPS's rotated grid onto the regular lat-lon subset over the bbox.
 * lon0/lat0 are the SW corner (row 0 = south; extractField reorders to we:ns).
 * The step is the descriptor resolutionDeg so `origin + (n−1)·step` EXACTLY
 * lands on the descriptor bbox E/N (dims·res == bbox — see the shared file).
 *
 * VERIFY: wgrib2 accepts negative lon0 (−153) for a bounded regional (non-
 * global-wrapping) latlon grid — verified on the live file: it emits the grid in
 * we:ns order and reports the extent back as 207..319.005 (== −153..−40.995).
 */
export function buildHrdpsNewGrid(): string {
  const lon0 = HRDPS_BBOX[0];
  const lat0 = HRDPS_BBOX[1];
  const res = HRDPS_GRID.res;
  return `latlon ${lon0}:${HRDPS_GRID.width}:${res} ${lat0}:${HRDPS_GRID.height}:${res}`;
}

/** Cached spec string (dims/bbox are static per-descriptor). */
export const HRDPS_NEWGRID = buildHrdpsNewGrid();

// ── datamart var/level tokens per app variable ────────────────────────────────
export interface HrdpsParam {
  /** MSC filename VAR token(s), e.g. "TMP_AGL-2m". Wind is the u/v pair. */
  tokens: string[];
  /** wgrib2 `-match` regex(es) to extract the field(s) post-regrid. */
  match: string[];
  encoding: "scalar" | "uv";
}

/**
 * The HRDPS fields we ingest, keyed by app variable id (matching
 * getSource("hrdps").variables). VERIFIED tokens against the live 00Z listing:
 *   temp     → TMP_AGL-2m   (2 m air temperature, K → °C at bake)
 *   wind     → UGRD_AGL-10m / VGRD_AGL-10m  (10 m wind, m/s, GRID-relative)
 *   gust     → GUST_AGL-10m (10 m wind gust, m/s)
 *   humidity → RH_AGL-2m    (2 m relative humidity, already %)
 *   pressure → PRMSL_MSL    (mean sea-level pressure, Pa → hPa at bake)
 * wgrib2 -match tokens are the standard WMO names after regrid.
 *
 * VERIFIED (live dd.weather.gc.ca listing, 2026-07-06): the datamart directory
 * carries `<ts>_MSC_HRDPS_PRMSL_MSL_RLatLon0.0225_PT<hhh>H.grib2` (note the `_MSL`
 * suffix, not `_AGL-*`), and `wgrib2 -inv` on that file decodes it as
 * `PRMSL:mean sea level` — same WMO shortName as GFS/ICON.
 */
export const HRDPS_PARAMS: Record<string, HrdpsParam> = {
  temp: {
    tokens: ["TMP_AGL-2m"],
    match: [":TMP:2 m above ground:"],
    encoding: "scalar",
  },
  wind: {
    tokens: ["UGRD_AGL-10m", "VGRD_AGL-10m"],
    match: [":UGRD:10 m above ground:", ":VGRD:10 m above ground:"],
    encoding: "uv",
  },
  gust: {
    tokens: ["GUST_AGL-10m"],
    match: [":GUST:10 m above ground:"],
    encoding: "scalar",
  },
  humidity: {
    tokens: ["RH_AGL-2m"],
    match: [":RH:2 m above ground:"],
    encoding: "scalar",
  },
  pressure: {
    tokens: ["PRMSL_MSL"],
    match: [":PRMSL:mean sea level:"],
    encoding: "scalar",
  },
};

const DATAMART_ROOT = "https://dd.weather.gc.ca";

/** Zero-pad a forecast hour to 3 digits (MSC filenames use hhh / PT<hhh>H). */
export function padHrdpsFhr(fhr: number): string {
  return String(fhr).padStart(3, "0");
}

export interface BuildHrdpsUrlArgs {
  /** Run date as YYYYMMDD (UTC) — datamart path AND filename carry it. */
  date: string;
  /** Cycle hour as HH (00/06/12/18). */
  cycle: string;
  /** Forecast hour offset. */
  fhr: number;
  /** MSC filename VAR token, e.g. "TMP_AGL-2m" / "UGRD_AGL-10m". */
  token: string;
}

/**
 * Build the keyless MSC datamart URL for one HRDPS continental GRIB2 field.
 *
 * VERIFIED (TMP_AGL-2m, 00Z, PT000H):
 *   https://dd.weather.gc.ca/20260701/WXO-DD/model_hrdps/continental/2.5km/00/000/
 *     20260701T00Z_MSC_HRDPS_TMP_AGL-2m_RLatLon0.0225_PT000H.grib2
 * The datamart date-prefix is the RUN's UTC date (20260701/00 and 20260630/18
 * both present); the filename timestamp carries the same YYYYMMDDTHHZ.
 */
export function buildHrdpsUrl({ date, cycle, fhr, token }: BuildHrdpsUrlArgs): string {
  const cyc = String(cycle).padStart(2, "0");
  const hhh = padHrdpsFhr(fhr);
  const dir = `${DATAMART_ROOT}/${date}/WXO-DD/model_hrdps/continental/2.5km/${cyc}/${hhh}`;
  const file = `${date}T${cyc}Z_MSC_HRDPS_${token}_RLatLon0.0225_PT${hhh}H.grib2`;
  return `${dir}/${file}`;
}

// ── Latest-available-run resolver (00/06/12/18 cycles) ────────────────────────
/** HRDPS continental runs at these 4 UTC cycles. */
export const HRDPS_CYCLE_HOURS = [0, 6, 12, 18];

/** MSC publishes HRDPS ~90 min after the nominal cycle (descriptor latency). */
export const HRDPS_LATENCY_MINUTES = HRDPS_SOURCE.latencyMinutes ?? 90;

export interface HrdpsRun {
  /** Run date as YYYYMMDD (UTC). */
  date: string;
  /** Cycle hour as HH (00/06/12/18). */
  cycle: string;
  /** Nominal run time as a Date (UTC). */
  runDate: Date;
}

/** Signature for an injected availability probe (HEAD/GET). */
export type FetchHead = (url: string) => Promise<boolean>;

function ymd(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

/**
 * Candidate HRDPS cycles newest-first (6-hourly), respecting the ~90 min
 * latency. Mirrors the ICON/HRRR resolver shape so the availability guard is
 * symmetric.
 */
export function hrdpsCandidateCycles(now: Date, count = 8): HrdpsRun[] {
  const base = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));
  const all: HrdpsRun[] = [];
  for (let i = 0; i < Math.ceil(count / HRDPS_CYCLE_HOURS.length) + 1; i++) {
    const day = new Date(base.getTime() - i * 24 * 3600 * 1000);
    const date = ymd(day);
    for (const c of HRDPS_CYCLE_HOURS) {
      all.push({
        date,
        cycle: String(c).padStart(2, "0"),
        runDate: new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), c, 0, 0, 0)),
      });
    }
  }
  all.sort((a, b) => b.runDate.getTime() - a.runDate.getTime());
  const latencyMs = HRDPS_LATENCY_MINUTES * 60 * 1000;
  const out: HrdpsRun[] = [];
  for (const cand of all) {
    if (now.getTime() - cand.runDate.getTime() >= latencyMs) {
      out.push(cand);
      if (out.length >= count) break;
    }
  }
  return out;
}

/**
 * Latest available HRDPS run: walk candidates newest-first and return the first
 * whose f000 TMP file is reachable. Falls back to the newest latency-eligible
 * candidate when no probe succeeds.
 */
export async function hrdpsLatestAvailableRun(now: Date, fetchHead: FetchHead): Promise<HrdpsRun> {
  const candidates = hrdpsCandidateCycles(now);
  for (const cand of candidates) {
    const url = buildHrdpsUrl({ date: cand.date, cycle: cand.cycle, fhr: 0, token: HRDPS_PARAMS.temp.tokens[0] });
    try {
      if (await fetchHead(url)) return cand;
    } catch {
      // probe failed — try the next-oldest candidate
    }
  }
  return candidates[0];
}
