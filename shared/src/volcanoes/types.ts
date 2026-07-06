/**
 * Active-volcano domain types, shared by the worker (ingest) and the public app
 * (overlay). Like earthquakes/fires, these are worker-cached from an external
 * feed; the public app only ever reads the Mongo cache.
 */

/**
 * "erupting" — the feed has a report within the last VOLCANO_RECENT_MS window.
 * "unrest" — the event is still open (no end reported) but its last confirmed
 * report has gone stale, i.e. ongoing activity/monitoring without a fresh
 * eruption update.
 */
export type VolcanoStatus = "erupting" | "unrest";

/** One actively-tracked volcanic event. */
export interface Volcano {
  /** Source event id (the upsert key). */
  id: string;
  name: string;
  lat: number;
  lng: number;
  status: VolcanoStatus;
  /** Epoch ms of the earliest known report for this event. */
  firstDate: number;
  /** Epoch ms of the most recent report for this event. */
  lastDate: number;
  /** Link to a source report, if the feed provided one. */
  sourceUrl?: string;
}

/** Everything the volcano overlay needs in one cached payload. */
export interface VolcanoData {
  volcanoes: Volcano[];
}
