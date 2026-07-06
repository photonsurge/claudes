// sources/iconGlobal.ts
// DWD ICON global 13 km — the WORLDWIDE nest. Unlike ICON-D2/ICON-EU (which have a
// pre-interpolated regular-lat-lon twin), the GLOBAL product is published ONLY on
// its native ICOSAHEDRAL triangular mesh (wgrib2 can't decode/regrid it directly).
// So the worker must regrid it to a regular lat-lon grid with `cdo remap` using
// DWD's precomputed target-grid + weights (see ICON_GLOBAL_CDO_REMAP below).
//
// DWD open-data publishes ICON global as GRIB2, ONE bzip2-compressed file per
// variable per forecast step, under a per-cycle / per-variable directory tree:
//   https://opendata.dwd.de/weather/nwp/icon/grib/<HH>/<var>/
//     icon_global_icosahedral_single-level_<YYYYMMDDHH>_<FFF>_<VAR>.grib2.bz2
//
// Fields: t_2m / u_10m / v_10m / vmax_10m / relhum_2m — same WMO param coding as
// the ICON-D2/EU nests. u_10m/v_10m are EARTH-RELATIVE after the cdo remap, so the
// wind pair bakes directly (no `-new_grid_winds earth` — see iconCommon.ts).
//
// Licence: DWD open data — "© Deutscher Wetterdienst (DWD)" must be shown.
// Be polite: throttle (nomadsGate) and cache; don't hammer opendata.dwd.de.

const DWD_ROOT = "https://opendata.dwd.de/weather/nwp/icon/grib";

/**
 * cdo icosahedral→regular remap spec (VERIFIED against DWD's opendata cdo
 * guideline + the DeutscherWetterdienst/regrid tooling, 2026-07).
 *
 * The ICON global native grid is an unstructured icosahedral mesh; cdo's
 * `remapbil`/`remapbic` CANNOT be used on it — only `remapdis`/`remapnn`/
 * `remapycon` (or precomputed weights via `remap,<grid>,<weights>`). DWD ships
 * BOTH the target-grid description AND the precomputed nearest-neighbour weights
 * for the 0.125° world grid in one archive, so we use the ready-made weights (no
 * per-run weight generation):
 *
 *   https://opendata.dwd.de/weather/lib/cdo/ICON_GLOBAL2WORLD_0125_EASY.tar.bz2
 *
 * which unpacks to:
 *   ICON_GLOBAL2WORLD_0125_EASY/target_grid_world_0125.txt   (0.125° world grid)
 *   ICON_GLOBAL2WORLD_0125_EASY/weights_icogl2world_0125.nc  (interpolation weights)
 *
 * Invocation (per field GRIB2, after bunzip2):
 *   cdo -O -f grb2 remap,<GRID>.txt,<WEIGHTS>.nc  in.grib2  out.grib2
 *
 * VERIFY: `target_grid_world_0125.txt` is the DWD 0.125° WORLD grid whose extent
 * equals the icon-global descriptor bbox EXACTLY: 2880 lon (−180..179.875) × 1441
 * lat (−90..90). If DWD's grid ever differs (gridsize / xfirst / yfirst), the
 * baked texture will misalign — assert the wgrib2 dims of the remap output match
 * 2880×1441 before publishing (extractField throws on a size mismatch, so a drift
 * surfaces as a bake error rather than a silently-stretched texture).
 * VERIFY: the archive filename ICON_GLOBAL2WORLD_0125_EASY.tar.bz2 and the two
 * inner filenames are current on opendata.dwd.de/weather/lib/cdo/.
 */
export const ICON_GLOBAL_CDO_REMAP = {
  /** DWD lib archive holding the target grid + precomputed weights. */
  weightsArchiveUrl: "https://opendata.dwd.de/weather/lib/cdo/ICON_GLOBAL2WORLD_0125_EASY.tar.bz2",
  /** Directory the archive unpacks into. */
  archiveDir: "ICON_GLOBAL2WORLD_0125_EASY",
  /** Target-grid description file (0.125° world grid) inside the archive. */
  targetGridFile: "target_grid_world_0125.txt",
  /** Precomputed interpolation weights (NetCDF) inside the archive. */
  weightsFile: "weights_icogl2world_0125.nc",
} as const;

/**
 * Build the `cdo remap` argument vector for an icosahedral→0.125° regular remap
 * (pure, unit-testable). `gridPath`/`weightsPath` are the extracted archive
 * files; `inPath` is the bunzip2'd icosahedral GRIB2; `outPath` the regular
 * GRIB2. Emits: `cdo -O -f grb2 remap,GRID,WEIGHTS IN OUT`.
 */
export function buildIconGlobalRemapArgs(args: {
  gridPath: string;
  weightsPath: string;
  inPath: string;
  outPath: string;
}): string[] {
  return [
    "-O",
    "-f", "grb2",
    `remap,${args.gridPath},${args.weightsPath}`,
    args.inPath,
    args.outPath,
  ];
}

/**
 * Our variable id → the DWD field token (lowercase URL <var> segment). Wind is a
 * 2-component field → u/v pair; temp/gust/humidity are single scalars. Same field
 * set as the ICON-D2/EU nests.
 *
 *   temp     → t_2m       (2 m air temperature, K)
 *   wind     → u_10m / v_10m   (10 m wind components, m/s, earth-relative post-remap)
 *   gust     → vmax_10m   (10 m max wind gust, m/s)
 *   humidity → relhum_2m  (2 m relative humidity, %)
 *   pressure → pmsl       (mean sea-level pressure, Pa)
 */
export const ICON_GLOBAL_VAR_TOKENS: Record<string, string[]> = {
  temp: ["t_2m"],
  wind: ["u_10m", "v_10m"],
  gust: ["vmax_10m"],
  humidity: ["relhum_2m"],
  pressure: ["pmsl"],
};

/**
 * wgrib2 -match token per DWD field on the REMAPPED (regular) GRIB2. IDENTICAL to
 * ICON-D2/EU — the WMO param coding is the same across ICON nests, and cdo remap
 * preserves the GRIB2 param definitions.
 * VERIFIED (live opendata.dwd.de listing, 2026-07-06): pmsl decodes as
 * `PRMSL:mean sea level` on the pre-remap icosahedral file — same field cdo remap
 * carries through, consistent with the other four fields' verified behaviour.
 */
export const ICON_GLOBAL_FIELD_MATCH: Record<string, string> = {
  t_2m: ":TMP:2 m above ground:",
  u_10m: ":UGRD:10 m above ground:",
  v_10m: ":VGRD:10 m above ground:",
  // DWD VMAX_10M is coded as WMO MAXGUST at 10 m above ground.
  vmax_10m: ":(MAXGUST|GUST):10 m above ground:",
  // DWD RELHUM_2M is coded as WMO RH at 2 m above ground (already %).
  relhum_2m: ":RH:2 m above ground:",
  pmsl: ":PRMSL:mean sea level:",
};

/** Zero-pad a forecast hour to 3 digits (DWD filenames use fff). */
export function padIconGlobalStep(step: number): string {
  return String(step).padStart(3, "0");
}

export interface BuildIconGlobalUrlArgs {
  /** Run date as YYYYMMDD (UTC). */
  date: string;
  /** Cycle hour as HH (00/06/12/18). */
  cycle: string;
  /** Forecast step in hours. */
  step: number;
  /** DWD field token (lowercase), e.g. "t_2m" / "u_10m" / "relhum_2m". */
  field: string;
}

/**
 * Build the DWD open-data URL for one ICON global ICOSAHEDRAL GRIB2.bz2 file.
 *
 * VERIFIED (live listing, 2026-07): the global product's filename uses model
 * "icon", grid token "icosahedral" (NOT "regular-lat-lon" — the global drop-in
 * regular grid does not exist), NO level infix for these single-level surface
 * fields, and the trailing field token is UPPERCASE, e.g. (t_2m, 00z, f000):
 *   https://opendata.dwd.de/weather/nwp/icon/grib/00/t_2m/
 *     icon_global_icosahedral_single-level_2026070100_000_T_2M.grib2.bz2
 *
 * VERIFY: no `_<LEVEL>` infix appears for t_2m/u_10m/v_10m/vmax_10m/relhum_2m on
 * a live listing (single-level surface fields carry none; some pressure-level
 * products do — these five are surface-only).
 */
export function buildIconGlobalUrl({ date, cycle, step, field }: BuildIconGlobalUrlArgs): string {
  const cyc = String(cycle).padStart(2, "0");
  const fff = padIconGlobalStep(step);
  // URL <var> segment is lowercase; the trailing filename token is uppercase.
  const fileToken = field.toUpperCase();
  const file = `icon_global_icosahedral_single-level_${date}${cyc}_${fff}_${fileToken}.grib2.bz2`;
  return `${DWD_ROOT}/${cyc}/${field}/${file}`;
}

/** ICON global runs every 6 h (4 cycles/day). */
const CYCLE_HOURS = [0, 6, 12, 18];

/** DWD publishes ICON global ~4 h after the nominal cycle; poll rather than trust. */
export const ICON_GLOBAL_LATENCY_HOURS = 4;

function ymd(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

export interface IconGlobalRun {
  date: string;
  cycle: string;
  runDate: Date;
}

/**
 * Candidate ICON global cycles newest-first, respecting the ~4 h latency. Mirrors
 * the ICON-EU resolver shape so the scheduler/availability guard is symmetric.
 */
export function iconGlobalCandidateCycles(now: Date, count = 4): IconGlobalRun[] {
  const base = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));
  const all: IconGlobalRun[] = [];
  for (let i = 0; i < Math.ceil(count / CYCLE_HOURS.length) + 1; i++) {
    const day = new Date(base.getTime() - i * 24 * 3600 * 1000);
    const date = ymd(day);
    for (const c of CYCLE_HOURS) {
      all.push({
        date,
        cycle: String(c).padStart(2, "0"),
        runDate: new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), c, 0, 0, 0)),
      });
    }
  }
  all.sort((a, b) => b.runDate.getTime() - a.runDate.getTime());
  const latencyMs = ICON_GLOBAL_LATENCY_HOURS * 3600 * 1000;
  const out: IconGlobalRun[] = [];
  for (const cand of all) {
    if (now.getTime() - cand.runDate.getTime() >= latencyMs) {
      out.push(cand);
      if (out.length >= count) break;
    }
  }
  return out;
}

/** Signature for an injected availability probe (HEAD/GET). */
export type FetchHead = (url: string) => Promise<boolean>;

/**
 * Latest available ICON global run: walk candidates newest-first and return the
 * first whose f000 t_2m file is reachable. Falls back to the newest
 * latency-eligible candidate when no probe succeeds.
 */
export async function iconGlobalLatestAvailableRun(now: Date, fetchHead: FetchHead): Promise<IconGlobalRun> {
  const candidates = iconGlobalCandidateCycles(now);
  for (const cand of candidates) {
    const url = buildIconGlobalUrl({ date: cand.date, cycle: cand.cycle, step: 0, field: "t_2m" });
    try {
      if (await fetchHead(url)) return cand;
    } catch {
      // probe failed — try the next-oldest candidate
    }
  }
  return candidates[0];
}
