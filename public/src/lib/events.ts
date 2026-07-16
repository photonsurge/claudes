import type { iWatchedEvent } from "@photonsurge/shared/db/watched-event-model";
import type { iEventSource } from "@photonsurge/shared/db/event-source-model";
import type { iEventSourceRevision } from "@photonsurge/shared/db/event-source-revision-model";
import type { iEventExternalLink } from "@photonsurge/shared/db/event-external-link-model";
import type { iEventResource } from "@photonsurge/shared/db/event-resource-model";
import type { iEventSeries } from "@photonsurge/shared/db/event-series-model";
import type { EventSnapshotMeta } from "@photonsurge/shared/db/event-snapshot-repo";
import type { iEventWatchSchedule } from "@photonsurge/shared/db/event-watch-schedule-model";
import type { EventTimelineBeat } from "@photonsurge/shared/events/event-timeline";

/** The /admin/events/:id dossier payload. */
export interface EventDetail {
  event: iWatchedEvent;
  timeline: EventTimelineBeat[];
  sources: iEventSource[];
  sourceRevisions: iEventSourceRevision[];
  links: iEventExternalLink[];
  resources: iEventResource[];
  series: iEventSeries[];
  snapshots: EventSnapshotMeta[];
  schedules: iEventWatchSchedule[];
}

/** The unified WatchedEvent list (newest first). */
export async function getEventList(status?: string): Promise<iWatchedEvent[]> {
  const q = status ? `?status=${encodeURIComponent(status)}` : "";
  const res = await fetch(`/api/admin/events${q}`, { cache: "no-store" });
  if (!res.ok) return [];
  const json = await res.json();
  return (json.events ?? []) as iWatchedEvent[];
}

/** One event's full dossier, or null if it doesn't exist. */
export async function getEventDetail(id: string): Promise<EventDetail | null> {
  const res = await fetch(`/api/admin/events/${encodeURIComponent(id)}`, { cache: "no-store" });
  if (!res.ok) return null;
  return (await res.json()) as EventDetail;
}

/**
 * Theme colour key per event status, for admin chips. Returns MUI palette
 * semantics (resolved via `sx`), not hexes: /admin owns one palette and this is
 * the only caller surface, so a live/cancelled event agrees with every other
 * healthy/failed chip in the engine room.
 */
export function eventStatusColor(status: string): string {
  switch (status) {
    case "ACTIVE":
      return "success.main";
    case "CANCELLED":
      return "error.main";
    case "ENDED":
      return "text.secondary";
    default:
      return "text.secondary";
  }
}
