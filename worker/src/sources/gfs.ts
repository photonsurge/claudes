// sources/gfs.ts
// Pure helpers for the NOAA NOMADS GFS 0.25° GRIB-filter source.
// Network access is always injected so these functions are unit-testable.

export interface BuildNomadsUrlArgs {
  /** Run date as YYYYMMDD. */
  date: string;
  /** Cycle hour as HH (00/06/12/18). */
  cycle: string;
  /** Forecast hour offset. */
  fhr: number;
  /** GFS variable name(s), e.g. ["UGRD","VGRD"]. */
  vars: string[];
  /** GRIB-filter level token(s), e.g. ["10_m_above_ground"]. */
  levels: string[];
  /** NOMADS product: atmos (default GFS 0.25°) or the GFS-Wave global product. */
  product?: "atmos" | "wave";
}

const NOMADS_BASE = "https://nomads.ncep.noaa.gov/cgi-bin/filter_gfs_0p25.pl";
const NOMADS_WAVE_BASE = "https://nomads.ncep.noaa.gov/cgi-bin/filter_gfswave.pl";

/** Zero-pad a forecast hour to 3 digits ("0" -> "000", "12" -> "012"). */
export function padFhr(fhr: number): string {
  return String(fhr).padStart(3, "0");
}

/**
 * Build a NOMADS GRIB-filter URL for a single GFS 0.25° forecast hour subset.
 *
 * Example:
 *   https://nomads.ncep.noaa.gov/cgi-bin/filter_gfs_0p25.pl
 *     ?dir=/gfs.20260628/00/atmos
 *     &file=gfs.t00z.pgrb2.0p25.f012
 *     &var_UGRD=on&var_VGRD=on&lev_10_m_above_ground=on
 */
export function buildNomadsUrl({ date, cycle, fhr, vars, levels, product = "atmos" }: BuildNomadsUrlArgs): string {
  const cyc = String(cycle).padStart(2, "0");
  const fff = padFhr(fhr);

  const wave = product === "wave";
  const base = wave ? NOMADS_WAVE_BASE : NOMADS_BASE;
  // GFS-Wave lives under .../wave/gridded with a different file naming + a
  // .grib2 extension; atmos uses .../atmos and an extension-less pgrb2 file.
  const dir = wave ? `/gfs.${date}/${cyc}/wave/gridded` : `/gfs.${date}/${cyc}/atmos`;
  const file = wave ? `gfswave.t${cyc}z.global.0p25.f${fff}.grib2` : `gfs.t${cyc}z.pgrb2.0p25.f${fff}`;

  // Use a deterministic param order: dir, file, then vars, then levels.
  const params: string[] = [];
  params.push(`dir=${encodeURIComponent(dir)}`);
  params.push(`file=${file}`);
  for (const v of vars) params.push(`var_${v}=on`);
  for (const l of levels) params.push(`lev_${l}=on`);

  return `${base}?${params.join("&")}`;
}

export interface LatestRun {
  /** Run date as YYYYMMDD (UTC). */
  date: string;
  /** Cycle hour as HH. */
  cycle: string;
  /** Nominal run time as a Date (UTC). */
  runDate: Date;
}

/** Signature for an injected availability probe (HEAD/GET). */
export type FetchHead = (url: string) => Promise<boolean>;

/** The four GFS cycles each day, in hours UTC. */
const CYCLE_HOURS = [0, 6, 12, 18];

/**
 * GFS products lag the nominal cycle by roughly 3.5–4h. We treat a cycle as a
 * *candidate* only once this many hours have elapsed since its nominal time.
 */
export const GFS_LATENCY_HOURS = 4;

function ymd(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

function cycleRunDate(date: string, cycle: number): Date {
  const y = Number(date.slice(0, 4));
  const mo = Number(date.slice(4, 6)) - 1;
  const d = Number(date.slice(6, 8));
  return new Date(Date.UTC(y, mo, d, cycle, 0, 0, 0));
}

/**
 * Enumerate candidate cycles from most-recent backwards, given `now`. A cycle is
 * a candidate only if at least GFS_LATENCY_HOURS have elapsed since its nominal
 * time. Returns `{date,cycle,runDate}` ordered newest-first.
 */
export function candidateCycles(now: Date, count = 8): LatestRun[] {
  const out: LatestRun[] = [];
  // Walk back from `now` in 6h steps over cycle boundaries.
  // Start from the most recent cycle boundary at/under now.
  const cursor = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));
  // Generate cycle datetimes for today and the previous few days, newest first.
  const days: Date[] = [];
  for (let i = 0; i < Math.ceil(count / 4) + 1; i++) {
    days.push(new Date(cursor.getTime() - i * 24 * 3600 * 1000));
  }
  const all: LatestRun[] = [];
  for (const day of days) {
    const date = ymd(day);
    for (const c of CYCLE_HOURS) {
      const runDate = cycleRunDate(date, c);
      all.push({ date, cycle: String(c).padStart(2, "0"), runDate });
    }
  }
  // newest first
  all.sort((a, b) => b.runDate.getTime() - a.runDate.getTime());
  const latencyMs = GFS_LATENCY_HOURS * 3600 * 1000;
  for (const cand of all) {
    if (now.getTime() - cand.runDate.getTime() >= latencyMs) {
      out.push(cand);
      if (out.length >= count) break;
    }
  }
  return out;
}

/**
 * Determine the latest *complete* GFS cycle available.
 *
 * Walks candidate cycles newest-first (respecting the ~4h product latency) and
 * returns the first one whose f000 product is reachable via `fetchHead`. If no
 * probe succeeds, falls back to the newest latency-eligible candidate.
 */
export async function latestAvailableRun(now: Date, fetchHead: FetchHead): Promise<LatestRun> {
  const candidates = candidateCycles(now);
  for (const cand of candidates) {
    const url = buildNomadsUrl({
      date: cand.date,
      cycle: cand.cycle,
      fhr: 0,
      vars: ["PRMSL"],
      levels: ["mean_sea_level"],
    });
    try {
      const ok = await fetchHead(url);
      if (ok) return cand;
    } catch {
      // probe failed — try the next-oldest candidate
    }
  }
  // Nothing probed true: assume the newest latency-eligible cycle exists.
  if (candidates.length > 0) return candidates[0];
  // Degenerate fallback: most recent cycle boundary regardless of latency.
  const fallback = candidateCycles(new Date(now.getTime() + GFS_LATENCY_HOURS * 3600 * 1000))[0];
  return fallback;
}
