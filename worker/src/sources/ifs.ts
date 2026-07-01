// sources/ifs.ts
// Pure helpers for the ECMWF IFS open-data source (GRIB2, 0.25° regular lat-lon
// — drop-in on the same 1440×721 grid as GFS). Unlike the NOMADS GRIB-filter,
// ECMWF publishes ONE GRIB2 file per forecast step containing every parameter;
// we download the whole step file and extract fields with wgrib2 -match.
//
// Licence: CC-BY-4.0 — "© ECMWF" must be shown wherever IFS data renders.
// Access: the open-data portal caps concurrent connections (~500 global) — fetch
// politely and cache aggressively; never hammer.

export interface BuildIfsUrlArgs {
  /** Run date as YYYYMMDD (UTC). */
  date: string;
  /** Cycle hour as HH (00/06/12/18). */
  cycle: string;
  /** Forecast step in hours. */
  step: number;
  /**
   * Product stream. Since IFS Cycle 50r1 (May 2026) the short-cutoff scda/scwv
   * streams were folded into oper/wave, so "oper" covers all cycles. Kept
   * configurable in case a run predates the merge — VERIFY current naming.
   */
  stream?: "oper" | "wave";
  /** Resolution token; open data is 0p25. */
  resolution?: string;
}

const IFS_ROOT = "https://data.ecmwf.int/forecasts";

/**
 * Build the ECMWF open-data IFS GRIB2 URL for one forecast step.
 *
 * Example:
 *   https://data.ecmwf.int/forecasts/20260628/00z/ifs/0p25/oper/
 *     20260628000000-12h-oper-fc.grib2
 */
export function buildIfsUrl({
  date,
  cycle,
  step,
  stream = "oper",
  resolution = "0p25",
}: BuildIfsUrlArgs): string {
  const cyc = String(cycle).padStart(2, "0");
  const file = `${date}${cyc}0000-${step}h-${stream}-fc.grib2`;
  return `${IFS_ROOT}/${date}/${cyc}z/ifs/${resolution}/${stream}/${file}`;
}

/**
 * wgrib2 `-match` strings per variable for the IFS GRIB2 file.
 *
 * Confirmed against a real ECMWF 0p25 `oper fc` inventory: wgrib2 prints
 * GFS-style WMO abbreviations (NOT the ecCodes shortNames `2t`/`10u`/`msl` from
 * the sidecar `.index`). Note the one gotcha — IFS MSLP is `PRES:mean sea
 * level`, NOT `PRMSL`/`MSLET`. Each string includes the level so the multi-level
 * IFS file yields exactly one record per field.
 *
 * ⚠️ Packing caveat: ECMWF IFS open data is CCSDS-packed. A wgrib2 build without
 * JPEG/CCSDS support decodes the inventory fine but throws on VALUE extraction
 * ("DRS Template 42 not defined"). If the worker's wgrib2 lacks CCSDS, repack
 * first: `grib_set -r -s packingType=grid_simple in.grib2 out.grib2`.
 */
export const IFS_VAR_MATCH: Record<string, string[]> = {
  temp: [":TMP:2 m above ground:"],
  wind: [":UGRD:10 m above ground:", ":VGRD:10 m above ground:"],
  pressure: [":PRES:mean sea level:"],
};

/**
 * IFS open-data `oper fc` forecast steps (hours). 00z/12z run to 360h; 06z/18z
 * stop at 144h. Returns the step list for a given cycle.
 */
export function ifsForecastSteps(cycle: string, maxHours = 360): number[] {
  const cyc = String(cycle).padStart(2, "0");
  const full = cyc === "00" || cyc === "12";
  const out: number[] = [];
  for (let h = 0; h <= 144 && h <= maxHours; h += 3) out.push(h);
  if (full) for (let h = 150; h <= 360 && h <= maxHours; h += 6) out.push(h);
  return out;
}

/** The four IFS cycles per day (UTC). 00/12 run to 360h; 06/18 are shorter. */
const CYCLE_HOURS = [0, 6, 12, 18];

/** IFS open-data lags the nominal cycle by ~7–9h; treat 9h as the safe floor. */
export const IFS_LATENCY_HOURS = 9;

function ymd(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

export interface IfsRun {
  date: string;
  cycle: string;
  runDate: Date;
}

/**
 * Candidate IFS cycles newest-first, respecting the ~9h latency. Mirrors the GFS
 * `candidateCycles` shape so the scheduler/availability guard is symmetric.
 */
export function ifsCandidateCycles(now: Date, count = 6): IfsRun[] {
  const base = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));
  const all: IfsRun[] = [];
  for (let i = 0; i < Math.ceil(count / 4) + 1; i++) {
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
  const latencyMs = IFS_LATENCY_HOURS * 3600 * 1000;
  const out: IfsRun[] = [];
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
 * Latest available IFS run: walk candidates newest-first and return the first
 * whose f000 step file is reachable. Falls back to the newest latency-eligible
 * candidate when no probe succeeds. `IFS_AS_DEFAULT_BASE` gates whether the
 * director actually switches the atmospheric base to it (GFS stays as fallback).
 */
export async function ifsLatestAvailableRun(now: Date, fetchHead: FetchHead): Promise<IfsRun> {
  const candidates = ifsCandidateCycles(now);
  for (const cand of candidates) {
    const url = buildIfsUrl({ date: cand.date, cycle: cand.cycle, step: 0 });
    try {
      if (await fetchHead(url)) return cand;
    } catch {
      // probe failed — try the next-oldest candidate
    }
  }
  return candidates[0];
}
