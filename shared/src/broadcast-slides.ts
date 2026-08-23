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

/** Slide dwell bounds (ms) for the rotation-speed control. */
export const SLIDE_HOLD_MIN_MS = 6000;
export const SLIDE_HOLD_MAX_MS = 40000;
export const DEFAULT_SLIDE_HOLD_MS = 16000;

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
