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
import { repairCachedGeometry } from "./repair";

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
  /** Already-stored alerts retro-fitted with a boundary this run. */
  backfilled: number;
  /**
   * Alerts fixed by the reconcile — cached boundary, no shape, missed first time.
   * Steady state is 0; anything else is a backfill that didn't take.
   */
  reconciled: number;
  /** Cached boundaries Mongo would have refused, fixed in place (no re-fetch). */
  repaired: number;
  /** True when the run ended early on the quota rather than finishing. */
  quotaStopped: boolean;
  /** Gateway requests left in the window, as the server last reported them. */
  quotaRemaining: number | null;
  failures: string[];
}

/**
 * Apply cached boundaries to any active alert still missing one — not just the
 * areas resolved on this run.
 *
 * The backfill below is fired exactly once per area, on the run that resolves it.
 * If that single attempt doesn't take — a restart mid-run, a sibling polygon that
 * makes Mongo reject the `updateMany`, a transient error caught and logged — the
 * area is never revisited: ingest won't rewrite an unchanged active alert, and a
 * CAP message's `sent` never moves, so the alert stays shapeless until it expires.
 *
 * Measured live, that was not theoretical: 254 areas across 34 EMMA_IDs had an
 * EXACT boundary sitting in the cache and no shape on the alert. ES075's boundary
 * was cached at 17:19, its alerts had been stored at 15:58, and the retro-fit that
 * should have joined them ran and left them empty. Calling the same backfill by
 * hand three days later fixed all 22 first time — nothing was wrong with it except
 * that it only ever got one go.
 *
 * So: one lean scan for who still needs a shape, intersected with what we already
 * hold. Costs no MeteoGate quota (the boundaries are here), and in the steady
 * state the intersection is empty and it writes nothing — the alerts that need
 * something are the ones we haven't fetched yet, and those aren't in the cache to
 * apply.
 */
export async function reconcileCachedGeometry(
  db: AppDb,
  res: Pick<GeomSyncResult, "reconciled" | "failures">,
): Promise<void> {
  const wanted = await db.alerts.emmaIdsMissingGeometry();
  if (!wanted.length) return;

  const cached = await db.alertAreaGeom.byEmmaIds(wanted);
  if (!cached.size) return; // everything outstanding is still un-fetched — quota's problem, not ours

  for (const [emmaId, hit] of cached) {
    try {
      res.reconciled += await db.alerts.backfillAreaGeometry(emmaId, hit.geometry);
    } catch (err) {
      // Same reason as the backfill loop: one bad polygon must not cost the rest.
      res.failures.push(`reconcile ${emmaId}: ${String((err as Error)?.message ?? err)}`);
    }
  }
  if (res.reconciled) {
    log(TAG, `reconciled cached boundaries onto stored alerts`, {
      areas: cached.size,
      alerts: res.reconciled,
    });
  }
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
    backfilled: 0,
    reconciled: 0,
    repaired: 0,
    quotaStopped: false,
    quotaRemaining: null,
    failures: [],
  };

  // Heal boundaries cached before geometry was repaired on the way in. Done
  // FIRST and unconditionally: it costs no network and no MeteoGate quota (the
  // shapes are already here — they need fixing, not re-fetching), and a run that
  // stops on the quota below must still have healed. Self-terminating.
  try {
    const r = await repairCachedGeometry(db.alertAreaGeom);
    res.repaired = r.repaired;
    if (r.repaired || r.unfixable) log(TAG, `repaired cached boundaries Mongo would refuse`, r);
  } catch (err) {
    res.failures.push(`repair-cached: ${String((err as Error)?.message ?? err)}`);
  }

  // Then join what we already hold onto the alerts that still have no shape.
  // AFTER the repair, so a boundary that was only just made storable gets applied
  // on this run rather than the next, and — like the repair — before the quota can
  // stop us: this is the half of the work that owes MeteoGate nothing.
  try {
    await reconcileCachedGeometry(db, res);
  } catch (err) {
    res.failures.push(`reconcile: ${String((err as Error)?.message ?? err)}`);
  }

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

    // Clear stored `geometry: null`s first, or filling ONE area of a multi-area
    // alert makes the doc indexable and its null siblings reject the write.
    try {
      await db.alerts.dropNullGeometries();
    } catch (err) {
      res.failures.push(`drop-nulls: ${String((err as Error)?.message ?? err)}`);
    }

    // Apply each boundary to alerts ALREADY stored for that area. Ingest enrich
    // only ever sees new alerts — `upsert` skips unchanged active ones — so
    // without this a live alert stays shapeless until it expires, however full
    // the cache gets. Newly-resolved areas only, so this stays cheap.
    for (const emmaId of new Set(areas.map((a) => a.emmaId))) {
      const geometry = areas.find((a) => a.emmaId === emmaId)!.geometry;
      try {
        res.backfilled += await db.alerts.backfillAreaGeometry(emmaId, geometry);
      } catch (err) {
        // A polygon Mongo's 2dsphere rejects must not lose the rest of the run.
        res.failures.push(`backfill ${emmaId}: ${String((err as Error)?.message ?? err)}`);
      }
    }
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
