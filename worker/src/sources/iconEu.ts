// sources/iconEu.ts
// DWD ICON-EU (all-Europe 6.5 km) regional nest source. Mirrors iconD2.ts: DWD
// open-data publishes ICON-EU as GRIB2, ONE file per variable per forecast step,
// under a per-cycle / per-variable directory tree. We use the REGULAR-LAT-LON
// variant (the native ICON grid is an unstructured triangular mesh wgrib2 can't
// decode; DWD ships a pre-interpolated regular-lat-lon twin). Files are
// bzip2-compressed (`.grib2.bz2`) and must be decompressed before wgrib2.
//
// Differences from ICON-D2 (VERIFIED against a live opendata.dwd.de listing):
//   - region token is "europe" (ICON-D2 uses "germany");
//   - the filename OMITS the "_2d" surface infix that ICON-D2 carries;
//   - the trailing field token in the FILENAME is UPPERCASE (T_2M, U_10M, …),
//     while the URL <var> directory segment stays lowercase (t_2m, u_10m, …).
// Same WMO field/param match strings and same u/v wind-pair handling as D2.
//
// Licence: DWD open data — "© Deutscher Wetterdienst (DWD)" must be shown.
// Be polite: throttle (nomadsGate) and cache; don't hammer opendata.dwd.de.

const DWD_ROOT = "https://opendata.dwd.de/weather/nwp/icon-eu/grib";

/**
 * Our variable id → the DWD field token (lowercase URL <var> segment). Wind is a
 * 2-component field → u/v pair; temp/gust/humidity are single scalars.
 *
 *   temp     → t_2m       (2 m air temperature, K)
 *   wind     → u_10m / v_10m   (10 m wind components, m/s)
 *   gust     → vmax_10m   (10 m max wind gust, m/s)
 *   humidity → relhum_2m  (2 m relative humidity, %)
 *   pressure → pmsl       (mean sea-level pressure, Pa)
 */
export const ICON_EU_VAR_TOKENS: Record<string, string[]> = {
  temp: ["t_2m"],
  wind: ["u_10m", "v_10m"],
  gust: ["vmax_10m"],
  humidity: ["relhum_2m"],
  pressure: ["pmsl"],
};

/**
 * wgrib2 -match token per DWD field (single record per single-var file).
 * IDENTICAL to ICON-D2 — the WMO param coding is the same across ICON nests.
 * VERIFIED (live opendata.dwd.de listing, 2026-07-06): pmsl decodes as
 * `PRMSL:mean sea level`.
 */
export const ICON_EU_FIELD_MATCH: Record<string, string> = {
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
export function padIconEuStep(step: number): string {
  return String(step).padStart(3, "0");
}

export interface BuildIconEuUrlArgs {
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
 * Build the DWD open-data URL for one ICON-EU regular-lat-lon GRIB2.bz2 file.
 *
 * VERIFIED (live listing, 2026-07): the filename uses region "europe", NO "_2d"
 * infix, and the trailing field token is UPPERCASE, e.g. (t_2m, 00z, f000):
 *   https://opendata.dwd.de/weather/nwp/icon-eu/grib/00/t_2m/
 *     icon-eu_europe_regular-lat-lon_single-level_2026070100_000_T_2M.grib2.bz2
 * The <regular-lat-lon> token distinguishes the drop-in regular grid from the
 * native `icosahedral` mesh files in the same directory.
 */
export function buildIconEuUrl({ date, cycle, step, field }: BuildIconEuUrlArgs): string {
  const cyc = String(cycle).padStart(2, "0");
  const fff = padIconEuStep(step);
  // URL <var> segment is lowercase; the trailing filename token is uppercase.
  const fileToken = field.toUpperCase();
  // NOTE: unlike ICON-D2, ICON-EU has NO "_2d" surface infix (VERIFIED).
  const file = `icon-eu_europe_regular-lat-lon_single-level_${date}${cyc}_${fff}_${fileToken}.grib2.bz2`;
  return `${DWD_ROOT}/${cyc}/${field}/${file}`;
}

/** ICON-EU runs every 6 h (4 cycles/day). */
const CYCLE_HOURS = [0, 6, 12, 18];

/** DWD publishes ICON-EU ~2.5 h after the nominal cycle; poll rather than trust. */
export const ICON_EU_LATENCY_HOURS = 2.5;

function ymd(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

export interface IconEuRun {
  date: string;
  cycle: string;
  runDate: Date;
}

/**
 * Candidate ICON-EU cycles newest-first, respecting the ~2.5 h latency. Mirrors
 * the ICON-D2 resolver shape so the scheduler/availability guard is symmetric.
 */
export function iconEuCandidateCycles(now: Date, count = 4): IconEuRun[] {
  const base = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));
  const all: IconEuRun[] = [];
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
  const latencyMs = ICON_EU_LATENCY_HOURS * 3600 * 1000;
  const out: IconEuRun[] = [];
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
 * Latest available ICON-EU run: walk candidates newest-first and return the
 * first whose f000 t_2m file is reachable. Falls back to the newest
 * latency-eligible candidate when no probe succeeds.
 */
export async function iconEuLatestAvailableRun(now: Date, fetchHead: FetchHead): Promise<IconEuRun> {
  const candidates = iconEuCandidateCycles(now);
  for (const cand of candidates) {
    const url = buildIconEuUrl({ date: cand.date, cycle: cand.cycle, step: 0, field: "t_2m" });
    try {
      if (await fetchHead(url)) return cand;
    } catch {
      // probe failed — try the next-oldest candidate
    }
  }
  return candidates[0];
}
