import type { Job } from "bullmq";
import { getAppDb } from "@photonsurge/shared/db/index";
import { log } from "@photonsurge/shared/utill/logger";
import { sendToQueue, QUEUE_PRIORITY } from "@photonsurge/shared/bull/bull-queue";
import { summarizeForLog } from "../utils";
import { blogInfo, blogErr } from "../blog";
import { eventsUnifiedEnabled } from "../events/config";
import { enabledEventSources } from "../events/registry";

const TAG = "job:events";

/** How many due schedules a single watch tick dispatches. */
/**
 * Events dispatched per tick. THIS is the throughput knob, not the tick interval.
 *
 * Capacity is tick x batch and nothing else: at a 60s tick, 20 was 1,200
 * acquires/hour against 13,812 of demand, so the queue sat 3,758 deep and never
 * drained. 50 lifts the ceiling to 3,000/hour, which covers ~1,151 events on a
 * 30-minute cadence with room to spare.
 */
const WATCH_BATCH = Number(process.env.EVENT_WATCH_BATCH || 50);

/**
 * The unified-event watch SWEEPER. Dispatched as type "events", event "watch"
 * (one hourly-ish repeatable — see index.ts). Reads the per-event schedules whose
 * `nextCheckAt` is due and enqueues an `acquire` for each, then advances the row
 * so the same event isn't re-dispatched before its acquire runs. Per-event cadence
 * lives in Mongo, so a burst of events never spawns a repeatable each.
 */
export async function watch(_job: Job) {
  if (!eventsUnifiedEnabled()) {
    log(TAG, "watch skipped (EVENTS_UNIFIED_ENABLED not set)");
    return { skipped: true };
  }
  const db = await getAppDb();
  const now = new Date();
  const due = await db.eventWatch.due(now, WATCH_BATCH);
  let dispatched = 0;
  for (const row of due) {
    try {
      await sendToQueue(
        "events",
        "events",
        "acquire",
        { eventId: row.eventId, source: row.source },
        undefined,
        QUEUE_PRIORITY.NORMAL,
      );
      // Advance optimistically so we don't re-dispatch before acquire completes;
      // acquire only touches the schedule again on FAILURE (to back off).
      await db.eventWatch.reschedule(row.eventId, row.source, { ok: true, now });
      dispatched++;
    } catch (err) {
      log(TAG, "dispatch failed", { eventId: row.eventId, err: String(err) });
    }
  }
  if (dispatched) log(TAG, "watch dispatched", { dispatched });
  return { dispatched };
}

/**
 * Acquire the latest data for ONE event across every applicable external adapter
 * (deep-GDACS, later ReliefWeb/Copernicus/EONET). Dispatched as event "acquire"
 * with `{eventId, source}`. Each adapter fetches → normalizes → persists onto the
 * unified event (source revisions / resources / series / timeline beats), writing
 * only when its payload actually changed. NEVER renders images (that's a separate
 * LOW-priority job) — this lane is network-bound only.
 */
export async function acquire(job: Job) {
  if (!eventsUnifiedEnabled()) return { skipped: true };
  const db = await getAppDb();
  const eventId: string | undefined = job.data?.data?.eventId;
  const source: string | undefined = job.data?.data?.source;
  if (!eventId) return { skipped: true };

  const event = await db.watchedEvents.getById(eventId);
  if (!event) {
    log(TAG, "acquire: event gone", { eventId });
    return { missing: true };
  }

  const now = new Date();
  const adapters = enabledEventSources().filter((s) => s.appliesTo(event));
  let changed = false;
  let timeline = 0;
  let resources = 0;
  let series = 0;
  let ok = true;
  for (const adapter of adapters) {
    try {
      const r = await adapter.acquire({ db, event, now });
      changed = changed || r.changed;
      timeline += r.timeline;
      resources += r.resources;
      series += r.series;
    } catch (err) {
      ok = false;
      log(TAG, "adapter failed", { eventId, adapter: adapter.id, err: summarizeForLog(err) });
    }
  }

  await db.watchedEvents.touchChecked(eventId, now);
  // On failure, re-advance with backoff; success already advanced in `watch`.
  if (!ok && source) await db.eventWatch.reschedule(eventId, source, { ok: false, now });

  const result = { eventId, adapters: adapters.length, changed, timeline, resources, series };
  if (changed) {
    blogInfo(TAG, `event ${event.title}: +${timeline} beats, +${resources} products`, result, "events", "acquire");
  }
  if (!ok) blogErr(TAG, `event acquire had failures`, new Error("adapter failure"), "events", "acquire");
  return result;
}
