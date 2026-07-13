import { loadWorkerEnv } from "../loadEnv";
loadWorkerEnv();

import type { Job } from "bullmq";
import { getAppDb } from "@photonsurge/shared/db/index";
import { acquire } from "../jobs/events";
import { eventsUnifiedEnabled } from "../events/config";

/**
 * One-shot: run the unified-event acquire pipeline for every ACTIVE WatchedEvent
 * (deep-GDACS + any other enabled adapter). Seeds each event's dossier — source
 * revisions, official resources, metric series, timeline beats — without waiting
 * for the watch sweeper. `yarn refresh:events`. Needs Mongo and
 * EVENTS_UNIFIED_ENABLED=true (promote some alerts first via the alert ingest).
 */
(async () => {
  if (!eventsUnifiedEnabled()) {
    console.warn("EVENTS_UNIFIED_ENABLED is not 'true' — acquire will no-op. Set it and re-run.");
  }
  const db = await getAppDb();
  const events = await db.watchedEvents.list({ status: "ACTIVE" });
  console.log(`active watched events: ${events.length}`);
  for (const e of events) {
    const job = { id: "manual", data: { data: { eventId: e.id, source: e.primarySource } } } as unknown as Job;
    console.log(`  ${e.type} ${e.title}:`, await acquire(job));
  }
  console.log(
    `totals — events: ${await db.watchedEvents.count()}, beats: ${await db.eventTimeline.count()}, ` +
      `resources: ${await db.eventResources.count()}, sources: ${await db.eventSources.count()}`,
  );
  await db.conn.close();
  process.exit(0);
})().catch((err) => {
  console.error("refreshEvents fatal:", err);
  process.exit(1);
});
