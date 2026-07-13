import type { iAlert } from "../db/alert-model";
import type { AlertChange } from "../alerts/diff";
import type { VolcanoChange } from "../volcanoes/diff";
import type { Volcano } from "../volcanoes/types";
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

// ── Volcano promotion (same shape as alerts — one system for all event types) ──

/** Derive the lean WatchedEvent core from a volcano. A volcano is an ongoing
 *  observation object: it stays ACTIVE while we track it and only lapses (ENDED)
 *  when it drops out of the bulletin TTL — not from any single poll. */
export function volcanoToWatchedEvent(v: Volcano): WatchedEventCore {
  const core: WatchedEventCore = {
    type: "VOLCANO",
    status: "ACTIVE",
    title: v.name,
    // "since when has activity been at this level" is the best available start signal.
    startedAt: new Date(v.statusChangedAt || v.firstDate).toISOString(),
    primarySource: "gvp",
    primarySourceId: v.id, // gvp:<vnum> — the canonical volcano join key
    repPoint: { type: "Point", coordinates: [v.lng, v.lat] },
  };
  return core;
}

/** Presentation-ready label for a volcano status change (admin + on-air read this). */
export function volcanoLabelFor(c: VolcanoChange): string {
  const to = c.to ?? "";
  const from = c.from ?? "";
  switch (c.type) {
    case "ALERT_LEVEL_CHANGED": {
      const scheme =
        c.scheme === "USGS_VOLCANO_ALERT_LEVEL"
          ? "USGS alert"
          : c.scheme === "GEONET_VAL"
            ? "GeoNet VAL"
            : c.scheme === "GVP"
              ? "Activity level"
              : "Alert level";
      return from ? `${scheme}: ${from} → ${to}` : `${scheme}: ${to}`;
    }
    case "AVIATION_COLOR_CHANGED":
      return from ? `Aviation code ${from} → ${to}` : `Aviation code ${to}`;
    case "ACTIVITY_CHANGED":
      return "Bulletin updated";
    case "VEI_CHANGED":
      return from ? `VEI ${from} → ${to}` : `VEI ${to}`;
    case "PLUME_CHANGED":
      return from ? `Plume height ${from} → ${to} m` : `Plume height ${to} m`;
  }
}

/** Convert volcano status changes into stored timeline beats. */
export function volcanoTimelineUpdatesFromChanges(
  eventId: string,
  changes: VolcanoChange[],
  at: string,
  source = "gvp",
): NewEventTimelineUpdate[] {
  return changes.map((c) => ({ eventId, at, type: c.type, label: volcanoLabelFor(c), source }));
}
