import type { iWatchedEvent } from "../db/watched-event-model";
import type { iEventTimelineUpdate } from "../db/event-timeline-update-model";
import type { EventTimelineUpdateType } from "./types";

/**
 * The read-time builder for a unified event's timeline. Unlike the alert timeline
 * (fully derived), an event's beats are STORED (event_timeline_updates) — this
 * only sorts them and synthesises the head (ISSUED) + tail (ENDED) when the
 * stored rows don't already carry them. Both admin and on-air render this, so
 * they can never disagree.
 */

export interface EventTimelineBeat {
  at: string;
  type: EventTimelineUpdateType;
  label: string;
  source?: string;
  severityRank?: number;
  areaKm2?: number;
  refUrl?: string;
  assetIds?: string[];
}

type TimelineEvent = Pick<iWatchedEvent, "status" | "startedAt" | "endedAt" | "title">;

const beatOf = (u: iEventTimelineUpdate): EventTimelineBeat => ({
  at: u.at,
  type: u.type,
  label: u.label,
  source: u.source,
  severityRank: u.severityRank,
  areaKm2: u.areaKm2,
  refUrl: u.refUrl,
  assetIds: u.assetIds,
});

/**
 * Ordered (oldest→newest) beats for one event.
 *
 * @param event   the WatchedEvent (lifecycle + when it started/ended)
 * @param updates event_timeline_updates.listForEvent(eventId) — any order
 */
export function buildEventTimeline(event: TimelineEvent, updates: iEventTimelineUpdate[]): EventTimelineBeat[] {
  const beats: EventTimelineBeat[] = updates.map(beatOf);

  // Head: ISSUED — synthesise only when the stored rows don't already carry one.
  if (!beats.some((b) => b.type === "ISSUED")) {
    beats.unshift({ at: event.startedAt, type: "ISSUED", label: "Event detected" });
  }

  // Tail: ENDED — a natural lapse. If cancelled, the CANCELLED beat tells the story.
  const cancelled = beats.some((b) => b.type === "CANCELLED");
  const ended = beats.some((b) => b.type === "ENDED" || b.type === "CLOSED");
  if (event.status === "ENDED" && !cancelled && !ended && event.endedAt) {
    beats.push({ at: event.endedAt, type: "ENDED", label: "Event ended" });
  }

  return beats.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}

/** The most-recent `n` beats (newest last), for the space-limited on-air slide. */
export function latestEventBeats(beats: EventTimelineBeat[], n: number): EventTimelineBeat[] {
  return n > 0 && beats.length > n ? beats.slice(beats.length - n) : beats;
}
