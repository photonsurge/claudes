import type { AppDb } from "@photonsurge/shared/db/index";
import { log } from "@photonsurge/shared/utill/logger";
import {
  fetchCountryFeatures,
  meteogateCountries,
  resolveFeature,
  quota,
  quotaLow,
  RateLimitError,
  type EdrFeature,
} from "./meteogate";

const TAG = "alerts:geom-sync";

export interface GeomSyncResult {
  /** Countries swept without error. */
  countries: number;
  /** EDR features seen across all countries. */
  features: number;
  /** Alerts we actually resolved (each costs two requests). */
  resolved: number;
  /** EMMA areas written (new boundary or a bbox→exact upgrade). */
  cached: number;
  /** Alerts skipped because the ledger had already resolved them. */
  skipped: number;
  /** True when the run ended early on the quota rather than finishing. */
  quotaStopped: boolean;
  /** Gateway requests left in the window, as the server last reported them. */
  quotaRemaining: number | null;
  failures: string[];
}

/**
 * Interleave one country's alerts with the next so a budget spreads across
 * Europe instead of draining into whichever country sorts first.
 *
 * This is not cosmetic. The countries are swept alphabetically, and Austria
 * alone offered 450 alerts, so the first run resolved Austria and nothing else —
 * Poland and the UK were never reached at all. Round-robin makes every country
 * progress on every run.
 */
export function interleaveByCountry(byCountry: Map<string, EdrFeature[]>): EdrFeature[] {
  const queues = [...byCountry.values()];
  const out: EdrFeature[] = [];
  for (let i = 0; queues.some((q) => i < q.length); i++) {
    for (const q of queues) if (i < q.length) out.push(q[i]);
  }
  return out;
}

/**
 * Fill the EMMA_ID → boundary cache from MeteoGate.
 *
 * Cost control IS the design. MeteoGate allows **500 gateway requests per hour**
 * and resolving one alert costs two, so a run can only ever resolve ~150–200
 * alerts. That's fine — an EMMA boundary is permanent, so the cache fills over
 * days and then costs almost nothing. What matters is that each run spends its
 * small budget WIDELY (round-robin) and stops before it blows the window, since
 * exhausting the quota 429s every country until the hour rolls over.
 *
 * Tolerant by design: one country's failure must not lose the rest of Europe.
 */
export async function syncAreaGeometry(
  db: AppDb,
  opts: { now?: Date; budget?: number } = {},
): Promise<GeomSyncResult> {
  const now = opts.now ?? new Date();
  // ~100 alerts = ~200 requests + the page walk (~80), so a run uses a bit over
  // half the 500/hour window and leaves room for a manual `yarn refresh:alert-geom`.
  const budget = opts.budget ?? Number(process.env.METEOGATE_BUDGET || 100);
  const res: GeomSyncResult = {
    countries: 0,
    features: 0,
    resolved: 0,
    cached: 0,
    skipped: 0,
    quotaStopped: false,
    quotaRemaining: null,
    failures: [],
  };

  // One feature per alert per country: the feed repeats each alert per language
  // and per area, and they all resolve through the same linked CAP document.
  const byCountry = new Map<string, Map<string, EdrFeature>>();
  for (const cc of meteogateCountries()) {
    if (quotaLow()) {
      res.quotaStopped = true;
      break;
    }
    try {
      const feats = await fetchCountryFeatures(cc, now);
      res.features += feats.length;
      res.countries++;
      const seenHere = new Map<string, EdrFeature>();
      for (const f of feats) if (!seenHere.has(f.alertId)) seenHere.set(f.alertId, f);
      byCountry.set(cc, seenHere);
    } catch (err) {
      if (err instanceof RateLimitError) {
        res.quotaStopped = true;
        break;
      }
      res.failures.push(`${cc}: ${String((err as Error)?.message ?? err)}`);
    }
  }

  const all = new Map<string, EdrFeature[]>();
  for (const [cc, m] of byCountry) all.set(cc, [...m.values()]);
  const total = [...all.values()].reduce((n, q) => n + q.length, 0);

  const seen = await db.alertAreaGeom.seenAlertIds([...all.values()].flat().map((f) => f.alertId));
  for (const [cc, q] of all) all.set(cc, q.filter((f) => !seen.has(f.alertId)));
  const todo = interleaveByCountry(all);
  res.skipped = total - todo.length;

  const areas = [];
  const marks: { alertId: string; emmaId?: string }[] = [];
  for (const f of todo.slice(0, budget)) {
    if (quotaLow()) {
      res.quotaStopped = true;
      break;
    }
    try {
      const { area, emmaId } = await resolveFeature(f);
      res.resolved++;
      // Mark even when it yielded no area: an alert with no EMMA_ID will never
      // resolve, so remembering it stops us paying for it again every run.
      marks.push({ alertId: f.alertId, emmaId });
      if (area) areas.push(area);
    } catch (err) {
      if (err instanceof RateLimitError) {
        res.quotaStopped = true;
        break; // the window is spent; leave the rest unmarked so a later run retries
      }
      res.failures.push(`${f.alertId}: ${String((err as Error)?.message ?? err)}`);
    }
  }

  if (areas.length) {
    const r = await db.alertAreaGeom.upsertAreas(areas);
    res.cached = r.upserted;
  }
  await db.alertAreaGeom.markSeen(marks);

  res.quotaRemaining = quota().remaining;
  if (res.quotaStopped) {
    log(TAG, `stopped on the MeteoGate quota — resumes next run`, {
      remaining: res.quotaRemaining,
      resetSec: quota().resetSec,
      resolved: res.resolved,
    });
  } else if (todo.length > budget) {
    log(TAG, `budget reached — ${todo.length - budget} alerts deferred to the next run`, {
      budget,
      pending: todo.length - budget,
    });
  }
  return res;
}
