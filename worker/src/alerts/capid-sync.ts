import type { AppDb } from "@photonsurge/shared/db/index";
import { log } from "@photonsurge/shared/utill/logger";
import { fetchCapId } from "./wmo-capid";

const TAG = "alerts:capid-sync";

export interface CapIdSyncResult {
  /** Active WMO alerts inspected. */
  candidates: number;
  /** capurls already in the cache (skipped, no fetch). */
  skipped: number;
  /** capurls fetched this run. */
  resolved: number;
  /** Of those, how many yielded a real CAP identifier. */
  withId: number;
  /** Already-stored WMO alerts stamped with their capId this run. */
  backfilled: number;
  failures: string[];
}

/**
 * Fill the capurl → canonical CAP id cache for active WMO alerts.
 *
 * One fetch per capurl, ever: a capurl is content-addressed, so the mapping is
 * immutable and the cache is permanent. Steady state resolves only newly
 * published WMO alerts and usually writes little.
 *
 * Budgeted and resumable rather than exhaustive — ~3.6k live WMO alerts is a lot
 * of small fetches, and nothing here is urgent (an unresolved capurl just means
 * that alert can't merge YET). Deliberately paced: we're a guest on
 * severeweather.wmo.int, and the MeteoGate sync already taught us what happens
 * when a sweep is impolite.
 */
export async function syncCapIds(
  db: AppDb,
  opts: { budget?: number; delayMs?: number } = {},
): Promise<CapIdSyncResult> {
  const budget = opts.budget ?? Number(process.env.WMO_CAPID_BUDGET || 250);
  const delayMs = opts.delayMs ?? Number(process.env.WMO_CAPID_DELAY_MS || 150);
  const res: CapIdSyncResult = { candidates: 0, skipped: 0, resolved: 0, withId: 0, backfilled: 0, failures: [] };

  // MeteoAlarm/NWS publish the canonical id AS their identifier, so stamping them
  // is free — but ingest only ever stamps NEW alerts, and both sides of a pair
  // must carry a capId before a duplicate can be seen. Do it first, every run.
  res.backfilled += await db.alerts.backfillDirectCapIds(["meteoalarm", "nws"]);

  // Only ACTIVE WMO alerts that haven't been stamped yet — a capId, once set,
  // never changes, and an expired alert isn't worth a request.
  const docs = await db.alerts.model
    .find({ source: "wmo", active: true, capId: { $in: [null, undefined] } }, { identifier: 1 })
    .lean()
    .exec();
  const capurls = [...new Set((docs as any[]).map((d) => d.identifier).filter(Boolean))];
  res.candidates = capurls.length;
  if (!capurls.length) return res;

  const known = await db.capIds.knownCapurls(capurls);
  const todo = capurls.filter((c) => !known.has(c));
  res.skipped = capurls.length - todo.length;

  const rows = [];
  for (const capurl of todo.slice(0, budget)) {
    try {
      const { capId, sender } = await fetchCapId(capurl);
      rows.push({ capurl, capId, sender });
      res.resolved++;
      if (capId) res.withId++;
    } catch (err) {
      // Leave it uncached so a later run retries this capurl.
      res.failures.push(`${capurl}: ${String((err as Error)?.message ?? err)}`);
    }
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
  }

  if (rows.length) {
    await db.capIds.upsertMany(rows);
    // Stamp the alerts we just resolved. Ingest enrich can't do it: `upsert`
    // skips an unchanged active alert, so an already-stored WMO alert would
    // never become mergeable no matter how full the cache got.
    res.backfilled = await db.alerts.backfillCapIds(
      rows.flatMap((r) => (r.capId ? [{ capurl: r.capurl, capId: r.capId }] : [])),
    );
  }
  if (todo.length > budget) {
    log(TAG, `budget reached — ${todo.length - budget} capurls deferred to the next run`, {
      budget,
      pending: todo.length - budget,
    });
  }
  return res;
}
