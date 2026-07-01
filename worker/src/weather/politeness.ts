// weather/politeness.ts
// NOMADS soft-bans clients that fetch faster than ~10s apart (NOAA treats it as a
// DoS). This is a process-level gate the manual refresh scripts await before each
// NOMADS download; the scheduled path enforces the same via a BullMQ limiter
// ({ max: 1, duration: 10_000 }) when the per-source jobs get wired.

let lastNomadsFetch = 0;

/** Default min gap between NOMADS fetches (ms); override via NOMADS_MIN_GAP_MS. */
export function nomadsMinGapMs(): number {
  const v = Number(process.env.NOMADS_MIN_GAP_MS);
  return Number.isFinite(v) && v > 0 ? v : 10_000;
}

/** Await until at least `minGapMs` has elapsed since the last NOMADS fetch. */
export async function nomadsGate(minGapMs = nomadsMinGapMs()): Promise<void> {
  const wait = minGapMs - (Date.now() - lastNomadsFetch);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastNomadsFetch = Date.now();
}
