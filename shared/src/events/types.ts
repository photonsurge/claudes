import type { AlertChangeType } from "../alerts/diff";

/**
 * Core vocabulary for the unified WatchedEvent layer — the cross-source event
 * dossier that sits OVER the per-alert / per-quake pipelines. One physical event
 * (a cyclone, a flood, a quake) gathers contributions from many sources (GDACS,
 * ReliefWeb, Copernicus, EONET, USGS…) that all append to one shared timeline.
 * Kept dependency-free (pure types) so both shared logic and the DB models can
 * import it without pulling in Mongoose.
 */

export type WatchedEventType =
  | "WEATHER_ALERT"
  | "CYCLONE"
  | "FLOOD"
  | "WILDFIRE"
  | "DROUGHT"
  | "EARTHQUAKE"
  | "VOLCANO";

export type WatchedEventStatus = "ACTIVE" | "ENDED" | "CANCELLED";

/** How an external source got linked to an event (records provenance of a match). */
export type MatchMethod = "EXPLICIT_ID" | "GLIDE" | "MANUAL" | "DERIVED";

/**
 * Stored timeline-beat kinds. Superset of the alert change types (so the
 * promotion bridge can map an `AlertChange[]` straight to beats) plus the
 * event-level beats contributed by acquisition adapters and media jobs.
 */
export type EventTimelineUpdateType =
  | "ISSUED"
  | "UPDATED"
  | "SOURCE_LINKED"
  | "REPORT_ADDED"
  | "PRODUCT_ADDED"
  | "PRODUCT_UPDATED"
  | "MAP_ADDED"
  | "IMAGE_ADDED"
  | "GRAPH_ADDED"
  | "GEOMETRY_REFINED"
  | "SNAPSHOT_CAPTURED"
  | "IMPACT_UPDATE"
  | "SEISMIC_REVISION"
  // Volcano status beats (see shared/src/volcanoes/diff.ts VolcanoChangeType).
  | "ALERT_LEVEL_CHANGED"
  | "AVIATION_COLOR_CHANGED"
  | "ACTIVITY_CHANGED"
  | "VEI_CHANGED"
  | "PLUME_CHANGED"
  | "CLOSED"
  | "ENDED"
  | AlertChangeType; // SEVERITY_CHANGED | AREA_CHANGED | TEXT_CHANGED | INSTRUCTION_CHANGED | START_TIME_CHANGED | EXPIRY_CHANGED | CANCELLED
