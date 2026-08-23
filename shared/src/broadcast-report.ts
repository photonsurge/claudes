/**
 * Catalog of the top-right WORLD REPORT deck slides — the single source of truth
 * for the /watch renderer (WorldReportDeck), the admin editor and the operator
 * console. The report is how a channel presents the whole-planet dataset, so
 * curating it is how one globe becomes several themed channels: a SEISMIC
 * channel keeps quakes + volcanoes, a WEATHER channel keeps the weather report +
 * alerts, and so on.
 *
 * Per channel: HIDE slides (`ControlState.reportOff`, an off-list — empty = show
 * all) and REORDER them (`ControlState.reportOrder`, a stable-sort ranking).
 * No slide is pinned — a channel may pare the report down to a single category.
 */

/** Stable id for one World Report deck slide (persisted in reportOff/order). */
export type ReportSlideId = "detection" | "hourly" | "alerts" | "seismic" | "volcanoes" | "about";

/**
 * The event categories the report is built from. Hiding a kind (reportKindsOff)
 * drops it from BOTH the detection grid and the active feed — so a seismic
 * channel's whole report reflects only quakes + volcanoes, not just its slides.
 */
export type ReportKind = "alert" | "quake" | "volcano";

export const REPORT_KINDS: { id: ReportKind; label: string }[] = [
  { id: "alert", label: "Weather alerts" },
  { id: "quake", label: "Earthquakes" },
  { id: "volcano", label: "Volcanoes" },
];

const REPORT_KIND_SET: ReadonlySet<string> = new Set(REPORT_KINDS.map((k) => k.id));

/** Narrow an untrusted value to a known report kind. */
export function isReportKind(value: unknown): value is ReportKind {
  return typeof value === "string" && REPORT_KIND_SET.has(value);
}

export interface ReportSlide {
  id: ReportSlideId;
  label: string;
  /** One-line hint for the admin form. */
  note: string;
}

/** Every report slide, in natural rotation order (also the default ranking). */
export const BROADCAST_REPORT_SLIDES: readonly ReportSlide[] = [
  { id: "detection", label: "Detection grid", note: "Whole-planet situation grid + active feed" },
  { id: "hourly", label: "World report", note: "Global weather report (area forecast)" },
  { id: "alerts", label: "Global alerts", note: "Active weather alerts by severity & continent" },
  { id: "seismic", label: "Seismic activity", note: "24h quakes by magnitude & continent" },
  { id: "volcanoes", label: "Volcanic activity", note: "Active volcanoes by status & continent" },
  { id: "about", label: "About card", note: "Channel description + data sources (copy editable per channel)" },
];

/** All report slide ids, in catalog order. */
export const REPORT_SLIDE_IDS: readonly ReportSlideId[] = BROADCAST_REPORT_SLIDES.map((s) => s.id);

const REPORT_ID_SET: ReadonlySet<string> = new Set(REPORT_SLIDE_IDS);

/** Narrow an untrusted value (socket/HTTP) to a known report slide id. */
export function isReportSlideId(value: unknown): value is ReportSlideId {
  return typeof value === "string" && REPORT_ID_SET.has(value);
}

/**
 * One-click focuses for spinning up a themed channel — each curates BOTH layers:
 * `off` hides slides, `kindsOff` drops whole categories from the grid + feed. So
 * "Weather focus" hides the seismic/volcano slides AND strips quakes/volcanoes
 * out of the detection grid and active feed. "Everything" clears both.
 */
export const REPORT_PRESETS: { id: string; label: string; off: ReportSlideId[]; kindsOff: ReportKind[] }[] = [
  { id: "all", label: "Everything", off: [], kindsOff: [] },
  { id: "weather", label: "Weather focus", off: ["seismic", "volcanoes"], kindsOff: ["quake", "volcano"] },
  { id: "geo", label: "Quakes & volcanoes", off: ["hourly", "alerts"], kindsOff: ["alert"] },
];

/**
 * Apply a channel's report preferences to the natural slide list: drop hidden
 * ids, then stable-sort by the channel's ranking (listed ids first in `order`,
 * everything else in its natural position). Pure + shared so renderer and any
 * preview agree. No report slide is pinned.
 */
export function applyReportPrefs<T extends { id: string }>(
  slides: T[],
  off: readonly string[],
  order: readonly string[],
): T[] {
  const offSet = new Set(off);
  const visible = slides.filter((s) => !offSet.has(s.id));
  const rank = (id: string): number => {
    const i = order.indexOf(id);
    return i === -1 ? Number.MAX_SAFE_INTEGER : i;
  };
  return visible
    .map((s, i) => ({ s, i }))
    .sort((a, b) => rank(a.s.id) - rank(b.s.id) || a.i - b.i)
    .map((x) => x.s);
}
