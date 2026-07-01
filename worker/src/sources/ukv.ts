// sources/ukv.ts
// Pure helpers for the Met Office UKV 2 km (UK) nest via the FREE Met Office AWS
// Open Data mirror. Network access is always injected so these functions are
// unit-testable (no network in tests).
//
// S3 ACCESS: bucket `met-office-atmospheric-model-data`, region eu-west-2, PUBLIC
// / no credentials. Reached over plain HTTPS (no SDK, no signing):
//   object:  https://met-office-atmospheric-model-data.s3.eu-west-2.amazonaws.com/<key>
//   listing: <base>/?list-type=2&prefix=<p>&delimiter=/   (S3 ListObjectsV2 XML)
// Equivalent to `aws s3 ls --no-sign-request s3://met-office-atmospheric-model-data/`.
//
// The UKV NetCDF sits on the native Lambert-azimuthal-equal-area projection (NOT
// regular lat-lon), so the ingest cdo-remaps it to a regular lat-lon subset over
// the descriptor bbox before baking (mirrors the RTOFS netCDF→cdo→grib path). The
// descriptor (shared/src/sources.ts → getSource("ukv")) is the source of truth
// for bbox/dims/resolution; the cdo remap grid here is DERIVED from it so the
// remapped grid EXACTLY matches the descriptor dims {945,723}.

import { getSource } from "@photonsurge/shared/sources";

// ── S3 mirror constants ───────────────────────────────────────────────────────
/** Public HTTPS endpoint for the Met Office atmospheric-model-data bucket. */
export const UKV_S3_BASE =
  "https://met-office-atmospheric-model-data.s3.eu-west-2.amazonaws.com";
/** VERIFY: model prefix. Confirmed from a live top-level listing (2026): the UK
 *  2 km deterministic model lives under `uk-deterministic-2km/`. */
export const UKV_PREFIX = "uk-deterministic-2km";

// ── Regrid target: descriptor bbox/dims → cdo remap grid description ────────────
const UKV_SOURCE = getSource("ukv")!;

/** UK bbox [W,S,E,N] straight from the descriptor. */
export const UKV_BBOX = UKV_SOURCE.bbox as [number, number, number, number];
/** Regular-latlon remap grid dims (matches the descriptor `dims` {945,723}). */
const UKV_DIMS = UKV_SOURCE.dims ?? { width: 945, height: 723 };
export const UKV_GRID = {
  width: UKV_DIMS.width,
  height: UKV_DIMS.height,
  res: UKV_SOURCE.resolutionDeg,
} as const;

/**
 * cdo grid-description text for `-remapbil,<this>`. A regular lon-lat grid whose
 * origin (xfirst/yfirst) and extent (dims·inc) EQUAL the descriptor bbox, so the
 * baked texture, the remap target, and the publishSourceRun bounds all agree:
 *   xfirst + (xsize-1)*xinc == E,  yfirst + (ysize-1)*yinc == N.
 * netcdfToGrib2 passes this straight into `cdo -f grb2 -remapbil,<grid> IN OUT`;
 * cdo accepts either a predefined name (global_0.08) or an inline grid file — we
 * write this to a temp file and pass its path.
 */
export function buildUkvRemapGrid(): string {
  const [w, s] = UKV_BBOX;
  return [
    "gridtype = lonlat",
    `xsize    = ${UKV_GRID.width}`,
    `ysize    = ${UKV_GRID.height}`,
    `xfirst   = ${w}`,
    `xinc     = ${UKV_GRID.res}`,
    `yfirst   = ${s}`,
    `yinc     = ${UKV_GRID.res}`,
    "",
  ].join("\n");
}

/** Cached grid-description text (dims/bbox are static per-descriptor). */
export const UKV_REMAP_GRID = buildUkvRemapGrid();

/**
 * Per app-variable: the NetCDF variable name (for `cdo -selname`) AND the GRIB2
 * `-match` token cdo emits after remap→grib2 (for `wgrib2 -match`). These are TWO
 * namespaces — cdo selects by NetCDF name, wgrib2 matches by GRIB2 shortName — so
 * don't conflate them.
 *
 * VERIFIED from a live NetCDF header + wgrib2 inventory of the cdo output (2026):
 *   temp     : NetCDF `air_temperature` @ 1.5 m (Kelvin) → GRIB2 `:TMP:1.5 m above ground:`
 *   humidity : NetCDF `relative_humidity` @ 1.5 m       → GRIB2 `:RH:1.5 m above ground:`
 * NOTE the file names are `..._at_screen_level.nc` but the *variable* names inside
 * are `air_temperature` / `relative_humidity` (screen level == 1.5 m AGL).
 * NOTE humidity arrives as a 0..1 FRACTION, so the ingest scales ×100 → % before
 * bake (bake with skipUnitConvert). temp is Kelvin → bake K→°C (default convert).
 */
export interface UkvParam {
  /** NetCDF variable name (cdo -selname). */
  ncVar: string;
  /** wgrib2 `-match` token to extract the field post-remap. */
  match: string;
  /** The file's parameter slug in the object key (…-PT…-<slug>.nc). */
  fileSlug: string;
}
export const UKV_PARAMS: Record<string, UkvParam> = {
  temp: {
    ncVar: "air_temperature",
    match: ":TMP:1.5 m above ground:",
    fileSlug: "temperature_at_screen_level",
  },
  humidity: {
    ncVar: "relative_humidity",
    match: ":RH:1.5 m above ground:",
    fileSlug: "relative_humidity_at_screen_level",
  },
};

// ── Object-key builder ─────────────────────────────────────────────────────────
/** Zero-pad a number to a fixed width. */
function pad(n: number, w: number): string {
  return String(n).padStart(w, "0");
}

/** Run stamp `YYYYMMDDTHHMMZ` (UKV run dirs are hourly). */
export function ukvRunStamp(runDate: Date): string {
  const y = runDate.getUTCFullYear();
  const mo = pad(runDate.getUTCMonth() + 1, 2);
  const d = pad(runDate.getUTCDate(), 2);
  const h = pad(runDate.getUTCHours(), 2);
  const mi = pad(runDate.getUTCMinutes(), 2);
  return `${y}${mo}${d}T${h}${mi}Z`;
}

/** Lead-time token `PT<HHHH>H<MM>M` (validTime − runTime). f0 → PT0000H00M. */
export function ukvLeadToken(leadMinutes: number): string {
  const hh = pad(Math.floor(leadMinutes / 60), 4);
  const mm = pad(leadMinutes % 60, 2);
  return `PT${hh}H${mm}M`;
}

export interface BuildUkvKeyArgs {
  runDate: Date;
  /** Which variable's file (temp/humidity). */
  variableId: keyof typeof UKV_PARAMS | string;
  /** Forecast lead in minutes (0 = analysis/nowcast). */
  leadMinutes?: number;
}

/**
 * Build the S3 object KEY for one UKV field file.
 *
 * Example (temp, 00Z run, f0):
 *   uk-deterministic-2km/20260701T0000Z/
 *     20260701T0000Z-PT0000H00M-temperature_at_screen_level.nc
 */
export function buildUkvKey({ runDate, variableId, leadMinutes = 0 }: BuildUkvKeyArgs): string {
  const stamp = ukvRunStamp(runDate);
  const lead = ukvLeadToken(leadMinutes);
  const p = UKV_PARAMS[variableId];
  if (!p) throw new Error(`UKV: no file slug for variable "${variableId}"`);
  return `${UKV_PREFIX}/${stamp}/${stamp}-${lead}-${p.fileSlug}.nc`;
}

/** Full public HTTPS URL for a UKV field file. */
export function buildUkvUrl(args: BuildUkvKeyArgs): string {
  return `${UKV_S3_BASE}/${buildUkvKey(args)}`;
}

// ── Latest-available-run resolver (hourly runs) ───────────────────────────────
export interface UkvRun {
  /** Nominal run time as a Date (UTC). */
  runDate: Date;
  /** Run stamp `YYYYMMDDTHHMMZ`. */
  stamp: string;
}

/** Signature for an injected availability probe (HEAD/GET). */
export type FetchHead = (url: string) => Promise<boolean>;

/** UKV product lag: ~90 min (matches the descriptor latencyMinutes). */
export const UKV_LATENCY_MINUTES = UKV_SOURCE.latencyMinutes ?? 90;

/**
 * Enumerate candidate UKV runs newest-first (hourly), given `now`. A run is a
 * candidate only once UKV_LATENCY_MINUTES have elapsed since its nominal hour.
 * The mirror keeps ~2 days, so a couple dozen candidates is ample.
 */
export function ukvCandidateRuns(now: Date, count = 24): UkvRun[] {
  const latencyMs = UKV_LATENCY_MINUTES * 60 * 1000;
  const cursor = new Date(Date.UTC(
    now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), now.getUTCHours(), 0, 0, 0,
  ));
  const out: UkvRun[] = [];
  for (let i = 0; out.length < count && i < count + 48; i++) {
    const runDate = new Date(cursor.getTime() - i * 3600 * 1000);
    if (now.getTime() - runDate.getTime() >= latencyMs) {
      out.push({ runDate, stamp: ukvRunStamp(runDate) });
    }
  }
  return out;
}

/**
 * Latest available UKV run: walk candidates newest-first (respecting latency) and
 * return the first whose f0 temperature file is reachable via `fetchHead`. Falls
 * back to the newest latency-eligible candidate when no probe succeeds.
 */
export async function ukvLatestAvailableRun(now: Date, fetchHead: FetchHead): Promise<UkvRun> {
  const candidates = ukvCandidateRuns(now);
  for (const cand of candidates) {
    const url = buildUkvUrl({ runDate: cand.runDate, variableId: "temp", leadMinutes: 0 });
    try {
      if (await fetchHead(url)) return cand;
    } catch {
      // probe failed — try the next-oldest candidate
    }
  }
  return candidates[0];
}
