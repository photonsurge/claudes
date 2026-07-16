import type { AppDb } from "@photonsurge/shared/db/index";
import { log } from "@photonsurge/shared/utill/logger";

const TAG = "events:close";

export interface CloseEventsResult {
  /** ACTIVE events inspected. */
  candidates: number;
  /** Events whose warning has lapsed, closed this run. */
  closed: number;
  /** Watch schedules deleted — for the events just closed AND any already over. */
  schedulesRetired: number;
}

/**
 * Close watched events whose alert is no longer active, and stop watching
 * anything that's over.
 *
 * Promotion sets ENDED from `alert.active === false`, but it only runs for alerts
 * in a freshly parsed feed. An alert that lapses never arrives that way —
 * `expire()` and `deactivateMissing()` flip `active` in a bulk updateMany — so the
 * event stayed ACTIVE forever and its schedule polled a warning that ended days
 * ago, reporting `changed: false` every five minutes until the heat death of the
 * universe.
 *
 * Measured live: 3,858 schedules, 3,758 due at once, demanding ~50,382 acquires
 * an hour against a ceiling of 1,200 (tick x batch). 1,348 were for ENDED events
 * and ~1,359 more for events nothing had closed — roughly 70% of a queue running
 * 25x beyond its own throughput, none of it doing anything.
 *
 * ALERT-SOURCED ONLY, and deliberately proven rather than assumed: an event is
 * only closed if we can find its `(primarySource, primarySourceId)` in the alerts
 * collection and see that it's inactive. A volcano's primary source isn't an alert
 * at all, so it's never found, never closed — matching on `type !== "VOLCANO"`
 * would have worked today and broken silently the first time another non-alert
 * source was added.
 */
export async function closeEndedAlertEvents(db: AppDb): Promise<CloseEventsResult> {
  const res: CloseEventsResult = { candidates: 0, closed: 0, schedulesRetired: 0 };

  const active = await db.watchedEvents.list({ status: "ACTIVE" });
  res.candidates = active.length;

  // One query per source rather than per event: `(source, identifier)` is the
  // dedup index, so an $in over identifiers is covered and 2,510 lookups collapse
  // into ~3.
  const bySource = new Map<string, string[]>();
  for (const e of active) {
    if (!e.primarySource || !e.primarySourceId) continue;
    const ids = bySource.get(e.primarySource);
    if (ids) ids.push(e.primarySourceId);
    else bySource.set(e.primarySource, [e.primarySourceId]);
  }

  // identifier -> the alert's lifecycle, for every source we might be holding.
  const alertState = new Map<string, { active: boolean; expiresAt?: string }>();
  for (const [source, identifiers] of bySource) {
    const rows = (await db.alerts.model
      .find({ source, identifier: { $in: identifiers } }, { _id: 0, identifier: 1, active: 1, expiresAt: 1 })
      .lean()
      .exec()) as any[];
    for (const r of rows) alertState.set(`${source}|${r.identifier}`, { active: !!r.active, expiresAt: r.expiresAt });
  }

  const toClose: { id: string; endedAt?: string }[] = [];
  for (const e of active) {
    const hit = alertState.get(`${e.primarySource}|${e.primarySourceId}`);
    // Not an alert at all (a volcano, say) — not ours to close.
    if (!hit) continue;
    if (hit.active) continue;
    toClose.push({ id: e.id!, endedAt: hit.expiresAt });
  }

  if (toClose.length) res.closed = await db.watchedEvents.closeMany(toClose);

  // Retire the schedules: the ones we just closed, plus every event that was
  // already over and kept its schedule anyway. Re-read rather than reusing the
  // list above — closeMany guards on ACTIVE, so this reflects what actually landed.
  const over = await db.watchedEvents.model
    .find({ status: { $in: ["ENDED", "CANCELLED"] } }, { _id: 0, id: 1 })
    .lean()
    .exec();
  const overIds = (over as any[]).map((e) => e.id);
  if (overIds.length) res.schedulesRetired = await db.eventWatch.removeForEvents(overIds);

  if (res.closed || res.schedulesRetired) {
    log(TAG, `closed lapsed events and retired their schedules`, res);
  }
  return res;
}
