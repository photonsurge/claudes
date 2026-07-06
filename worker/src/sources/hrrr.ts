// sources/hrrr.ts
// Pure helpers for the NOAA HRRR 3 km CONUS source via the NOMADS GRIB-filter.
// Network access is always injected so these functions are unit-testable.
//
// HRRR's NATIVE grid is Lambert conformal conic (not regular lat-lon), so after
// downloading the filtered GRIB2 subset the ingest MUST regrid it to a regular
// lat-lon subset (wgrib2 -new_grid latlon) over the HRRR bbox before baking —
// bakeScalar/bakeVector expect a regular grid. We reuse the wave-mosaic regrid
// path (regridTileToGlobal) with the HRRR_NEWGRID spec below.
//
// The descriptor (shared/src/sources.ts → getSource("hrrr")) is the source of
// truth for bbox/dims/resolution; the -new_grid spec here is derived from it so
// the regridded grid EXACTLY matches the descriptor dims {2600,1100}.

import { getSource } from "@photonsurge/shared/sources";

// ── Regrid target: descriptor bbox/dims → wgrib2 -new_grid latlon spec ─────────
const HRRR_SOURCE = getSource("hrrr")!;

/** HRRR CONUS bbox [W,S,E,N] straight from the descriptor. */
export const HRRR_BBOX = HRRR_SOURCE.bbox as [number, number, number, number];
/** Regular-latlon regrid grid dims (matches the descriptor `dims` {2600,1100}). */
const HRRR_DIMS = HRRR_SOURCE.dims ?? { width: 2600, height: 1100 };
export const HRRR_GRID = {
  width: HRRR_DIMS.width,
  height: HRRR_DIMS.height,
  res: HRRR_SOURCE.resolutionDeg,
} as const;

/**
 * Longitude/latitude step so `width`/`height` points span the bbox edge-to-edge.
 * (nx points over a [lon0,lonE] span → span/(nx-1) between points.) These come
 * out to ~0.0285°/~0.0291°, i.e. the descriptor's ~0.028° target resolution.
 */
export const HRRR_DLON = (HRRR_BBOX[2] - HRRR_BBOX[0]) / (HRRR_GRID.width - 1);
export const HRRR_DLAT = (HRRR_BBOX[3] - HRRR_BBOX[1]) / (HRRR_GRID.height - 1);

/**
 * Build the wgrib2 `-new_grid latlon lon0:nx:dlon lat0:ny:dlat` spec that
 * projects HRRR's Lambert grid onto a regular lat-lon subset over the bbox.
 * lon0/lat0 are the SW corner (row 0 = south; extractField reorders to we:ns).
 *
 * VERIFY: wgrib2 accepts negative lon0 (−134) directly for a regional (non-
 * global-wrapping) latlon grid. If a build insists on 0..360, shift lon0 by +360
 * and roll — but HRRR is a bounded CONUS window so the negative form is standard.
 */
export function buildHrrrNewGrid(): string {
  const lon0 = HRRR_BBOX[0];
  const lat0 = HRRR_BBOX[1];
  const dlon = HRRR_DLON.toFixed(6);
  const dlat = HRRR_DLAT.toFixed(6);
  return `latlon ${lon0}:${HRRR_GRID.width}:${dlon} ${lat0}:${HRRR_GRID.height}:${dlat}`;
}

/** Cached spec string (dims/bbox are static per-descriptor). */
export const HRRR_NEWGRID = buildHrrrNewGrid();

// ── NOMADS GRIB-filter URL builder ────────────────────────────────────────────
// VERIFY: HRRR 2-D surface fields are served by filter_hrrr_2d.pl over the
// conus subdirectory. TMP:2 m / UGRD:10 m / VGRD:10 m / GUST:surface all live in
// the wrfsfcf<FF> (surface) file. If the 2d filter lacks a field, switch to
// filter_hrrr_sfc.pl (same params). Extension-less file name mirrors GFS atmos.
const NOMADS_HRRR_BASE = "https://nomads.ncep.noaa.gov/cgi-bin/filter_hrrr_2d.pl";

/** wgrib2/GRIB-filter var + level tokens per app variable. */
export interface HrrrParam {
  /** GRIB-filter `var_<NAME>=on` token(s). */
  vars: string[];
  /** GRIB-filter `lev_<TOKEN>=on` token(s). */
  levels: string[];
  /** wgrib2 `-match` regex(es) to extract the field(s) post-regrid. */
  match: string[];
  encoding: "scalar" | "uv";
}

/**
 * The HRRR fields we ingest, keyed by app variable id (temp/wind/gust/pressure —
 * matching getSource("hrrr").variables).
 *
 * VERIFIED (live wrfsfcf00 inventory, 2026-07-06):
 *   TMP   : 2 m above ground   → var_TMP=on   & lev_2_m_above_ground=on
 *   UGRD  : 10 m above ground  → var_UGRD=on  & lev_10_m_above_ground=on
 *   VGRD  : 10 m above ground  → var_VGRD=on  & lev_10_m_above_ground=on
 *   GUST  : surface            → var_GUST=on  & lev_surface=on
 *   MSLMA : mean sea level     → var_MSLMA=on & lev_mean_sea_level=on — HRRR codes
 *           MSLP as MSLMA (MAPS/mass-consistent reduction), NOT PRMSL like GFS;
 *           confirmed via `wgrib2 -inv` on a live hrrr.tHHz.wrfsfcf00.grib2.
 */
export const HRRR_PARAMS: Record<string, HrrrParam> = {
  temp: {
    vars: ["TMP"],
    levels: ["2_m_above_ground"],
    match: [":TMP:2 m above ground:"],
    encoding: "scalar",
  },
  wind: {
    vars: ["UGRD", "VGRD"],
    levels: ["10_m_above_ground"],
    match: [":UGRD:10 m above ground:", ":VGRD:10 m above ground:"],
    encoding: "uv",
  },
  gust: {
    vars: ["GUST"],
    levels: ["surface"],
    match: [":GUST:surface:"],
    encoding: "scalar",
  },
  pressure: {
    vars: ["MSLMA"],
    levels: ["mean_sea_level"],
    match: [":MSLMA:mean sea level:"],
    encoding: "scalar",
  },
};

/** Zero-pad a forecast hour to 2 digits (HRRR uses wrfsfcf<FF>, e.g. f00). */
export function padHrrrFhr(fhr: number): string {
  return String(fhr).padStart(2, "0");
}

export interface BuildHrrrUrlArgs {
  /** Run date as YYYYMMDD (UTC). */
  date: string;
  /** Cycle hour as HH (00..23 — HRRR runs hourly). */
  cycle: string;
  /** Forecast hour offset. */
  fhr: number;
  /**
   * The variables to request. Each supplies its var_/lev_ filter tokens.
   * Defaults to every variable in HRRR_PARAMS (temp/wind/gust/pressure).
   */
  params?: HrrrParam[];
}

/**
 * Build a NOMADS GRIB-filter URL for a single HRRR CONUS forecast-hour subset.
 *
 * Example (00z, f00, all vars):
 *   https://nomads.ncep.noaa.gov/cgi-bin/filter_hrrr_2d.pl
 *     ?dir=/hrrr.20260628/conus
 *     &file=hrrr.t00z.wrfsfcf00.grib2
 *     &var_TMP=on&var_UGRD=on&var_VGRD=on&var_GUST=on
 *     &lev_2_m_above_ground=on&lev_10_m_above_ground=on&lev_surface=on
 */
export function buildHrrrUrl({ date, cycle, fhr, params }: BuildHrrrUrlArgs): string {
  const cyc = String(cycle).padStart(2, "0");
  const ff = padHrrrFhr(fhr);
  const chosen = params ?? Object.values(HRRR_PARAMS);

  // De-dupe var/level tokens across the chosen params (UGRD+VGRD share a level).
  const vars = new Set<string>();
  const levels = new Set<string>();
  for (const p of chosen) {
    for (const v of p.vars) vars.add(v);
    for (const l of p.levels) levels.add(l);
  }

  const dir = `/hrrr.${date}/conus`;
  const file = `hrrr.t${cyc}z.wrfsfcf${ff}.grib2`;

  // Deterministic param order: dir, file, then vars, then levels.
  const qs: string[] = [];
  qs.push(`dir=${encodeURIComponent(dir)}`);
  qs.push(`file=${file}`);
  for (const v of vars) qs.push(`var_${v}=on`);
  for (const l of levels) qs.push(`lev_${l}=on`);

  return `${NOMADS_HRRR_BASE}?${qs.join("&")}`;
}

// ── Latest-available-run resolver (hourly cycles) ─────────────────────────────
export interface HrrrRun {
  /** Run date as YYYYMMDD (UTC). */
  date: string;
  /** Cycle hour as HH (00..23). */
  cycle: string;
  /** Nominal run time as a Date (UTC). */
  runDate: Date;
}

/** Signature for an injected availability probe (HEAD/GET). */
export type FetchHead = (url: string) => Promise<boolean>;

/**
 * HRRR products lag the nominal cycle by ~50–90 min. Treat a cycle as a
 * candidate only once this many minutes have elapsed since its nominal time
 * (matches the descriptor's latencyMinutes = 90).
 */
export const HRRR_LATENCY_MINUTES = HRRR_SOURCE.latencyMinutes ?? 90;

function ymd(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

/**
 * Enumerate candidate HRRR cycles newest-first (hourly), given `now`. A cycle is
 * a candidate only once HRRR_LATENCY_MINUTES have elapsed since its nominal hour.
 * NOMADS keeps ~2 days of HRRR, so a couple of dozen candidates is ample.
 */
export function hrrrCandidateCycles(now: Date, count = 24): HrrrRun[] {
  const latencyMs = HRRR_LATENCY_MINUTES * 60 * 1000;
  // Most recent whole-hour boundary at/under `now`.
  const cursor = new Date(Date.UTC(
    now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), now.getUTCHours(), 0, 0, 0,
  ));
  const out: HrrrRun[] = [];
  for (let i = 0; out.length < count && i < count + 48; i++) {
    const runDate = new Date(cursor.getTime() - i * 3600 * 1000);
    if (now.getTime() - runDate.getTime() >= latencyMs) {
      out.push({ date: ymd(runDate), cycle: String(runDate.getUTCHours()).padStart(2, "0"), runDate });
    }
  }
  return out;
}

/**
 * Latest available HRRR run: walk candidates newest-first (respecting latency)
 * and return the first whose f00 surface subset is reachable via `fetchHead`.
 * Falls back to the newest latency-eligible candidate when no probe succeeds.
 */
export async function hrrrLatestAvailableRun(now: Date, fetchHead: FetchHead): Promise<HrrrRun> {
  const candidates = hrrrCandidateCycles(now);
  for (const cand of candidates) {
    const url = buildHrrrUrl({ date: cand.date, cycle: cand.cycle, fhr: 0, params: [HRRR_PARAMS.temp] });
    try {
      if (await fetchHead(url)) return cand;
    } catch {
      // probe failed — try the next-oldest candidate
    }
  }
  return candidates[0];
}
