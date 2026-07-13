import type { iAlert } from "../db/alert-model";
import type { AlertChange } from "../alerts/diff";
import { labelFor } from "../alerts/timeline";
import { unionBboxOfAlert } from "../geo/polygon";
import { alertRepPoint } from "../alerts/geo";
import type { WatchedEventCore } from "../db/watched-event-model";
import type { NewEventTimelineUpdate } from "../db/event-timeline-update-model";
import type { WatchedEventType } from "./types";

/**
 * Pure alert → WatchedEvent mapping + change → timeline-beat conversion. No DB,
 * no HTTP — the worker bridge calls these and hands the result to the repos, so
 * the mapping is exhaustively unit-testable. The whole point of the unified layer
 * is that this same shape later serves quakes (a `quakeToWatchedEvent`), so keep
 * it small and dependency-light.
 */

/** GDACS hazard code → unified event type. VO/TS and unknown fall through to WEATHER_ALERT. */
const GDACS_TYPE: Record<string, WatchedEventType> = {
  TC: "CYCLONE",
  FL: "FLOOD",
  FF: "FLOOD",
  DR: "DROUGHT",
  WF: "WILDFIRE",
};

/** Classify an alert into a WatchedEventType — GDACS code first, else the CAP event text. */
export function watchedEventTypeForAlert(a: Pick<iAlert, "info">): WatchedEventType {
  const info = a.info?.[0];
  const gd = info?.parameters?.gdacsEventType;
  if (gd && GDACS_TYPE[gd]) return GDACS_TYPE[gd];
  const ev = (info?.event || "").toLowerCase();
  if (/cyclone|hurricane|typhoon/.test(ev)) return "CYCLONE";
  if (/flood/.test(ev)) return "FLOOD";
  if (/fire|wildfire|bushfire/.test(ev)) return "WILDFIRE";
  if (/drought/.test(ev)) return "DROUGHT";
  return "WEATHER_ALERT";
}

/** First area geometry across the alert's info entries (for the representative point). */
function firstGeometry(a: Pick<iAlert, "info">) {
  for (const inf of a.info ?? []) {
    for (const ar of inf.area ?? []) {
      if (ar.geometry?.coordinates != null) return ar.geometry;
    }
  }
  return null;
}

/** Derive the lean WatchedEvent core from an alert (pre-persistence). */
export function alertToWatchedEvent(a: iAlert): WatchedEventCore {
  const info = a.info?.[0];
  const status = a.msgType === "Cancel" ? "CANCELLED" : a.active === false ? "ENDED" : "ACTIVE";
  const title = info?.headline || info?.event || a.identifier;
  const startedAt = info?.onset || info?.effective || a.sent || "";
  const pt = alertRepPoint(firstGeometry(a));
  const bbox = unionBboxOfAlert(a.info);

  const core: WatchedEventCore = {
    type: watchedEventTypeForAlert(a),
    status,
    title,
    startedAt,
    primarySource: a.source,
    primarySourceId: a.identifier,
  };
  if (status !== "ACTIVE" && a.expiresAt) core.endedAt = a.expiresAt;
  if (pt) core.repPoint = { type: "Point", coordinates: [pt[0], pt[1]] };
  if (bbox) core.bbox = bbox;
  return core;
}

/**
 * Convert the change list `diffAlert` already produced into stored timeline
 * beats, labelled identically to the on-air alert timeline (shared `labelFor`).
 */
export function timelineUpdatesFromChanges(
  eventId: string,
  changes: AlertChange[],
  at: string,
  source: string,
): NewEventTimelineUpdate[] {
  return changes.map((c) => {
    const beat: NewEventTimelineUpdate = { eventId, at, type: c.type, label: labelFor(c), source };
    if (c.type === "SEVERITY_CHANGED" && c.to != null) beat.severityRank = Number(c.to);
    if (c.type === "AREA_CHANGED" && c.to != null) beat.areaKm2 = Number(c.to);
    return beat;
  });
}
