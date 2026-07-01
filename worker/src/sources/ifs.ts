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
 * wgrib2 -match token per variable for the IFS GRIB2 file.
 *
 * ⚠️ VERIFY against `wgrib2 -inv` on a real IFS open-data file before enabling in
 * production — wgrib2 may render IFS ecCodes shortNames differently from the
 * NOMADS GFS abbreviations (UGRD/VGRD/TMP). These map to the GFS-style tokens
 * wgrib2 commonly emits for the WMO params; adjust if the inventory differs.
 */
export const IFS_VAR_MATCH: Record<string, { match: string; level: string }[]> = {
  temp: [{ match: ":TMP:", level: "2 m above ground" }],
  wind: [
    { match: ":UGRD:", level: "10 m above ground" },
    { match: ":VGRD:", level: "10 m above ground" },
  ],
  pressure: [{ match: ":PRMSL:", level: "mean sea level" }],
};

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
