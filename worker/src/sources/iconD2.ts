// sources/iconD2.ts
// DWD ICON-D2 (Europe / central-Europe 2.2 km) regional nest source.
//
// DWD open-data publishes ICON-D2 as GRIB2, ONE file per variable per forecast
// step, under a per-cycle / per-variable directory tree. We use the
// REGULAR-LAT-LON variant (the native ICON grid is an unstructured triangular
// mesh which wgrib2 can't decode; DWD ships a pre-interpolated regular-lat-lon
// twin whose filename carries the `regular-lat-lon` token). Files are
// bzip2-compressed (`.grib2.bz2`) and must be decompressed before wgrib2.
//
// Licence: DWD open data — "© Deutscher Wetterdienst (DWD)" must be shown.
// Be polite: throttle (nomadsGate) and cache; don't hammer opendata.dwd.de.

const DWD_ROOT = "https://opendata.dwd.de/weather/nwp/icon-d2/grib";

/**
 * Our variable id → the DWD field token used BOTH as the URL <var> directory
 * segment AND the trailing filename token. Wind is a 2-component field, so it
 * maps to the u/v pair (u_10m/v_10m); temp/gust are single scalars.
 *
 * Fields:
 *   temp     → t_2m     (2 m air temperature, K)
 *   wind     → u_10m / v_10m   (10 m wind components, m/s)
 *   gust     → vmax_10m (10 m max wind gust, m/s)
 *   humidity → relhum_2m (2 m relative humidity, %)
 */
export const ICON_D2_VAR_TOKENS: Record<string, string[]> = {
  temp: ["t_2m"],
  wind: ["u_10m", "v_10m"],
  gust: ["vmax_10m"],
  humidity: ["relhum_2m"],
};

/** wgrib2 -match token per DWD field (single record per single-var file). */
export const ICON_D2_FIELD_MATCH: Record<string, string> = {
  t_2m: ":TMP:2 m above ground:",
  u_10m: ":UGRD:10 m above ground:",
  v_10m: ":VGRD:10 m above ground:",
  // DWD VMAX_10M is coded as WMO MAXGUST at 10 m above ground.
  vmax_10m: ":(MAXGUST|GUST):10 m above ground:",
  // DWD RELHUM_2M is coded as WMO RH at 2 m above ground (already %).
  relhum_2m: ":RH:2 m above ground:",
};

/** Zero-pad a forecast hour to 3 digits (DWD filenames use fff). */
export function padIconD2Step(step: number): string {
  return String(step).padStart(3, "0");
}

export interface BuildIconD2UrlArgs {
  /** Run date as YYYYMMDD (UTC). */
  date: string;
  /** Cycle hour as HH (00/03/06/09/12/15/18/21). */
  cycle: string;
  /** Forecast step in hours. */
  step: number;
  /** DWD field token, e.g. "t_2m" / "u_10m" / "vmax_10m". */
  field: string;
}

/**
 * Build the DWD open-data URL for one ICON-D2 regular-lat-lon GRIB2.bz2 file.
 *
 * VERIFY: live filename/dir shape (DWD occasionally renames the model-run token
 * and the level suffix). Example (t_2m, 00z, f001):
 *   https://opendata.dwd.de/weather/nwp/icon-d2/grib/00/t_2m/
 *     icon-d2_germany_regular-lat-lon_single-level_2026070100_001_2d_t_2m.grib2.bz2
 * The <regular-lat-lon> token distinguishes the drop-in regular grid from the
 * native `icosahedral` mesh files in the same directory.
 */
export function buildIconD2Url({ date, cycle, step, field }: BuildIconD2UrlArgs): string {
  const cyc = String(cycle).padStart(2, "0");
  const fff = padIconD2Step(step);
  // VERIFY: `single-level` + `2d` are the level/kind tokens for surface fields
  // (t_2m, u_10m, v_10m, vmax_10m). Upper-air fields would use different tokens.
  const file = `icon-d2_germany_regular-lat-lon_single-level_${date}${cyc}_${fff}_2d_${field}.grib2.bz2`;
  return `${DWD_ROOT}/${cyc}/${field}/${file}`;
}

/** ICON-D2 runs every 3 h (8 cycles/day). */
const CYCLE_HOURS = [0, 3, 6, 9, 12, 15, 18, 21];

/** DWD publishes ICON-D2 ~2 h after the nominal cycle; poll rather than trust. */
export const ICON_D2_LATENCY_HOURS = 2;

function ymd(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

export interface IconD2Run {
  date: string;
  cycle: string;
  runDate: Date;
}

/**
 * Candidate ICON-D2 cycles newest-first, respecting the ~2 h latency. Mirrors
 * the IFS/RTOFS resolver shape so the scheduler/availability guard is symmetric.
 */
export function iconD2CandidateCycles(now: Date, count = 4): IconD2Run[] {
  const base = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));
  const all: IconD2Run[] = [];
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
  const latencyMs = ICON_D2_LATENCY_HOURS * 3600 * 1000;
  const out: IconD2Run[] = [];
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
 * Latest available ICON-D2 run: walk candidates newest-first and return the
 * first whose f000 t_2m file is reachable. Falls back to the newest
 * latency-eligible candidate when no probe succeeds.
 */
export async function iconD2LatestAvailableRun(now: Date, fetchHead: FetchHead): Promise<IconD2Run> {
  const candidates = iconD2CandidateCycles(now);
  for (const cand of candidates) {
    const url = buildIconD2Url({ date: cand.date, cycle: cand.cycle, step: 0, field: "t_2m" });
    try {
      if (await fetchHead(url)) return cand;
    } catch {
      // probe failed — try the next-oldest candidate
    }
  }
  return candidates[0];
}
