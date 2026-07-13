import type { AppDb } from "@photonsurge/shared/db/index";
import type { iWatchedEvent } from "@photonsurge/shared/db/watched-event-model";

/**
 * The contract every external-source acquisition adapter implements. The
 * `events.acquire` job loads a WatchedEvent, runs each enabled adapter whose
 * `appliesTo` matches, and each adapter fetches → normalizes → persists onto the
 * unified event (EventSource/Revision + EventResource + EventSeries + timeline
 * beats). Adapters NEVER render images — a preview is a separate LOW-priority job.
 */

export interface AcquireContext {
  db: AppDb;
  event: iWatchedEvent;
  now: Date;
  /** Injectable fetch (tests). */
  fetchImpl?: typeof fetch;
}

export interface AcquireResult {
  /** Did the source payload change since last poll? (drives reschedule + noise gating) */
  changed: boolean;
  timeline: number;
  resources: number;
  series: number;
}

export interface ExternalSource {
  /** Adapter id (also the EventSource `source`), e.g. "gdacs-detail". */
  id: string;
  /** Env gate. */
  enabled(): boolean;
  /** Matcher gate — does this adapter have anything to fetch for this event? */
  appliesTo(event: iWatchedEvent): boolean;
  acquire(ctx: AcquireContext): Promise<AcquireResult>;
}
