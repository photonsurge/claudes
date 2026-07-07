/**
 * Active-volcano domain types, shared by the worker (ingest) and the public app
 * (overlay). Worker-cached from the Smithsonian/USGS Weekly Volcanic Activity
 * Report (see `gvp.ts`); the public app only ever reads the Mongo cache.
 */

/**
 * Derived from the report's own activity label (not a time-window guess):
 * "erupting" — "New Eruptive Activity" / "Continuing Eruptive Activity".
 * "unrest" — "New Unrest" / "Continuing Unrest" (elevated activity, no eruption).
 * "dormant" — "Cessation of Eruption" or any other/unrecognised label — easing
 * off or ambiguous, kept one more week so the ticker doesn't just vanish.
 */
export type VolcanoStatus = "erupting" | "unrest" | "dormant";

/** One volcano with a report in the current (or a recent) weekly bulletin. */
export interface Volcano {
  /** Stable Smithsonian VOTW volcano number, e.g. "gvp:211060" (Etna) — the upsert key. */
  id: string;
  name: string;
  /** Country name as given by the report (Smithsonian's own labelling). */
  country?: string;
  lat: number;
  lng: number;
  status: VolcanoStatus;
  /** Epoch ms this volcano was first seen reporting in OUR cache (set once, not overwritten by later polls). */
  firstDate: number;
  /** Epoch ms of the current report (the bulletin's publish date). */
  lastDate: number;
  /** Link to the Smithsonian GVP volcano page. */
  sourceUrl?: string;
  /** The current week's report text, HTML-stripped — what's actually happening right now. */
  latestReport?: string;
  /** The report's own date range label, e.g. "25 June-1 July 2026". */
  reportDateRange?: string;
  /** Wikipedia enrichment (see worker/src/jobs/volcanoes.ts#enrichWiki) — absent until the enrich job has run. */
  wikiTitle?: string;
  wikiThumb?: string;
  wikiExtract?: string;
  /** Epoch ms of the last enrichment attempt (set even on a no-match, to avoid re-querying every run). */
  wikiFetchedAt?: number;
}

/** Everything the volcano overlay needs in one cached payload. */
export interface VolcanoData {
  volcanoes: Volcano[];
}
