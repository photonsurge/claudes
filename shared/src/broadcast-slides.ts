/**
 * Catalog of the bottom-left mode-deck SLIDES — the single source of truth for
 * the /watch renderer (mode-slides), the admin per-channel slide editor, and the
 * operator console. Each slide the deck can rotate through has a stable id here.
 *
 * Per channel the operator/admin can: HIDE slides (`ControlState.slidesOff`,
 * an off-list — empty = show all), REORDER them (`ControlState.slideOrder`, a
 * ranking applied as a stable sort), and set the rotation dwell
 * (`ControlState.slideHoldMs`). The `onair` lede is PINNED — always kept and
 * always first — so a channel can't drop its own identity page.
 *
 * Dynamic per-instance slides (e.g. `region-country-<cc>`) are intentionally NOT
 * in this catalog: they're never individually toggled and just keep their
 * natural position.
 */

/** Grouping for the admin form, in display order. */
export type SlideGroup = "core" | "context" | "place" | "event" | "quake" | "volcano";

/** Stable id for one deck slide (never renamed — it persists in slidesOff/order). */
export type SlideId =
  | "onair"
  | "track"
  | "history"
  | "depth"
  | "forecast"
  | "cityconditions"
  | "nation"
  | "topcities"
  | "region-next24"
  | "roundup"
  | "place-roundup"
  | "place-roundup-24h"
  | "alerts"
  | "alert-timeline"
  | "alert-media"
  | "event-timeline"
  | "event-media"
  | "nearby"
  | "quake"
  | "volcano-facts"
  | "volcano-geology"
  | "volcano-cams"
  | "volcano-eruptions"
  | "volcano-media"
  | "volcano-nearby"
  | "volcano-satellite"
  | "volcano-timeline";

export interface BroadcastSlide {
  id: SlideId;
  group: SlideGroup;
  label: string;
  /** Pinned slides can't be hidden or reordered — always kept, always first. */
  pinned?: boolean;
}

/** Every catalog slide, in a sensible default order (this doubles as the natural
 *  ranking when a channel hasn't set its own `slideOrder`). */
export const BROADCAST_SLIDES: readonly BroadcastSlide[] = [
  // Core — the identity lede (pinned) + the rich notable-track card.
  { id: "onair", group: "core", label: "On-air lede", pinned: true },
  { id: "track", group: "core", label: "Track info" },
  // Context — the shared located-shot cards.
  { id: "history", group: "context", label: "Area history" },
  { id: "depth", group: "context", label: "Ocean depth profile" },
  { id: "forecast", group: "context", label: "Forecast" },
  { id: "cityconditions", group: "context", label: "City conditions" },
  // Place — country / region spotlight cards.
  { id: "nation", group: "place", label: "The nation" },
  { id: "topcities", group: "place", label: "Top cities" },
  { id: "region-next24", group: "place", label: "Region · next 24h" },
  { id: "roundup", group: "place", label: "World round-up" },
  { id: "place-roundup", group: "place", label: "Place round-up" },
  { id: "place-roundup-24h", group: "place", label: "Place round-up · 24h" },
  // Event / storm — the alert & unified-event drill-downs.
  { id: "alerts", group: "event", label: "Alerts in view" },
  { id: "alert-timeline", group: "event", label: "Alert timeline" },
  { id: "alert-media", group: "event", label: "Alert media" },
  { id: "event-timeline", group: "event", label: "Event timeline" },
  { id: "event-media", group: "event", label: "Event media" },
  { id: "nearby", group: "event", label: "Near this event" },
  // Quake.
  { id: "quake", group: "quake", label: "Quake report" },
  // Volcano — the per-volcano dossier pages.
  { id: "volcano-facts", group: "volcano", label: "Volcano facts" },
  { id: "volcano-geology", group: "volcano", label: "Volcano geology" },
  { id: "volcano-cams", group: "volcano", label: "Volcano cams" },
  { id: "volcano-eruptions", group: "volcano", label: "Eruption history" },
  { id: "volcano-media", group: "volcano", label: "Volcano media" },
  { id: "volcano-nearby", group: "volcano", label: "Volcano nearby" },
  { id: "volcano-satellite", group: "volcano", label: "Volcano satellite" },
  { id: "volcano-timeline", group: "volcano", label: "Volcano timeline" },
];

/** Group display labels, in admin-form order. */
export const SLIDE_GROUP_LABELS: Record<SlideGroup, string> = {
  core: "Core",
  context: "Context",
  place: "Place (country / region)",
  event: "Storm / event",
  quake: "Quake",
  volcano: "Volcano",
};

/** Group render order for the admin form. */
export const SLIDE_GROUP_ORDER: readonly SlideGroup[] = [
  "core",
  "context",
  "place",
  "event",
  "quake",
  "volcano",
];

/** All slide ids, in catalog order. */
export const SLIDE_IDS: readonly SlideId[] = BROADCAST_SLIDES.map((s) => s.id);

const SLIDE_ID_SET: ReadonlySet<string> = new Set(SLIDE_IDS);
const PINNED_SLIDE_ID_SET: ReadonlySet<string> = new Set(
  BROADCAST_SLIDES.filter((s) => s.pinned).map((s) => s.id),
);

/** Narrow an untrusted value (socket/HTTP) to a known slide id. */
export function isSlideId(value: unknown): value is SlideId {
  return typeof value === "string" && SLIDE_ID_SET.has(value);
}

/** A pinned slide (e.g. the on-air lede) can't be hidden or reordered. */
export function isPinnedSlide(id: string): boolean {
  return PINNED_SLIDE_ID_SET.has(id);
}

/** Slide dwell bounds (ms). Since the deck became run-paced (see `slideRuns`)
 *  this is the FLOOR and the safety CEILING around the derived dwell, not the
 *  dwell itself: a slide never advances before `slideHoldMs` and never sits
 *  longer than SLIDE_HOLD_MAX_MS even if its body never reports a finished run. */
export const SLIDE_HOLD_MIN_MS = 6000;
export const SLIDE_HOLD_MAX_MS = 40000;
export const DEFAULT_SLIDE_HOLD_MS = 16000;

/**
 * RUNS THROUGH — how many times a slide's body is presented in full before the
 * deck advances. One "run" is the card's content shown once end to end: a full
 * top→bottom scroll pass for an overflowing body, or the time it takes to READ
 * the body at the channel's reading pace when it fits without scrolling.
 *
 * This is the primary rotation control. It replaced a bare dwell because the
 * dwell knew nothing about the card: a dense slide was cut mid-scroll while a
 * sparse one sat in dead air. Expressed as runs, the deck advances exactly when
 * the viewer has been shown everything on the card — the same move the crawl and
 * the marquee already made when they started deriving from `readPaceCps`.
 */
export const SLIDE_RUNS_MIN = 1;
export const SLIDE_RUNS_MAX = 4;
export const DEFAULT_SLIDE_RUNS = 1;

/**
 * Safety ceiling for a run-paced slide, ms — shared by BOTH decks.
 *
 * This is a DEADLOCK BREAKER, not a pacing control, so it is deliberately not
 * the dwell slider's maximum. It only ever bites on a slide whose moving part
 * claimed the clock and then never reported: a marquee waiting on a feed that
 * never arrives, a body whose measurement never lands. A legitimately long run
 * must be allowed to finish, and they do get long — a 20-row feed of headlines
 * stepping at the reading pace needs about a minute to come round, and a dense
 * card body wants ~50 s for one scroll pass. Cutting those at the slider max
 * (40 s / 30 s) would reinstate the very bug the run pacing fixes.
 */
export const RUN_CEILING_MS = 120000;

/** Any untrusted value → a usable run count. */
export function clampRuns(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

/**
 * Apply a channel's slide preferences to a composed deck: drop hidden slides
 * (never pinned ones), then stable-sort by the channel's ranking — pinned first,
 * then ranked ids in `order`, then everything else in its natural position.
 * Pure + shared so the renderer and any preview agree.
 */
export function applySlidePrefs<T extends { id: string }>(
  slides: T[],
  off: readonly string[],
  order: readonly string[],
): T[] {
  const offSet = new Set(off);
  const visible = slides.filter((s) => isPinnedSlide(s.id) || !offSet.has(s.id));
  const rank = (id: string): number => {
    if (isPinnedSlide(id)) return -1;
    const i = order.indexOf(id);
    return i === -1 ? Number.MAX_SAFE_INTEGER : i;
  };
  return visible
    .map((s, i) => ({ s, i }))
    .sort((a, b) => rank(a.s.id) - rank(b.s.id) || a.i - b.i)
    .map((x) => x.s);
}
