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
  /**
   * Epoch ms this volcano's `status` last actually changed value (not just
   * re-reported) — the closest available "just started erupting" signal, since
   * the weekly bulletin's own dates don't distinguish a fresh transition from
   * a routine re-poll of an ongoing eruption. Set on insert and whenever
   * `status` differs from what was previously stored (see volcano-repo.ts).
   */
  statusChangedAt: number;
  /** Link to the Smithsonian GVP volcano page. */
  sourceUrl?: string;
  /** The current week's report text, HTML-stripped — what's actually happening right now. */
  latestReport?: string;
  /** The report's own date range label, e.g. "25 June-1 July 2026". */
  reportDateRange?: string;
  /** Wikipedia enrichment (see worker/src/jobs/volcanoes.ts#enrichWiki) — absent until the enrich job has run. */
  wikiTitle?: string;
  wikiThumb?: string;
  /** Full-resolution version of wikiThumb (Wikipedia's `originalimage`) — prefer for the large detail view. */
  wikiPhoto?: string;
  wikiExtract?: string;
  /** A handful of additional photo URLs pulled from the article's embedded images, for a gallery strip. */
  wikiGallery?: string[];
  /** Epoch ms of the last enrichment attempt (set even on a no-match, to avoid re-querying every run). */
  wikiFetchedAt?: number;
  /** Wikidata-sourced facts (see fetchVolcanoFacts) — absent until enrichment has run or on a miss. */
  elevationM?: number;
  volcanoType?: string;
  lastEruptionYear?: number;
  /**
   * USGS Volcano Notification Service alert state (see usgs-vona.ts) — only
   * populated for the subset of volcanoes USGS actively monitors (US, Alaska,
   * Hawaii, Cascades). Far fresher than the weekly GVP bulletin when present.
   */
  usgsAlertLevel?: string;
  usgsColorCode?: string;
  usgsNoticeSynopsis?: string;
  usgsNoticeUrl?: string;
  usgsUpdatedAt?: number;
  /**
   * Official observatory status from a non-USGS source (e.g. GeoNet Volcanic
   * Alert Level) — kept separate from GVP-derived `status`. Raw value preserved;
   * normalized (`normal|advisory|watch|warning|unrest|eruption|unknown`) for scoring.
   */
  officialSource?: string;
  officialAlertScheme?: string;
  officialAlertLevelRaw?: string;
  officialAlertLevelNormalized?: string;
  officialActivity?: string;
  officialUpdatedAt?: number;
  /** LLM-parsed facts from this week's `latestReport` text (see worker/src/volcanoes/parseReport.ts). */
  reportVei?: number;
  reportPlumeHeightM?: number;
  /** Epoch ms the report text was last parsed — compared against `lastDate` to skip re-parsing an unchanged bulletin. */
  reportParsedAt?: number;
}

/** Everything the volcano overlay needs in one cached payload. */
export interface VolcanoData {
  volcanoes: Volcano[];
}
