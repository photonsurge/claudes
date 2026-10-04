/**
 * Segment-kind presentation helpers shared by the broadcast on-air elements.
 * A "targeted" kind is a single point the director frames on screen (storm,
 * quake, aircraft, ship) → the centred EVENT DETECTION reticle. The wide kinds
 * (intro, global spin, ocean, orbital) and the sandbox `point` inspector have no
 * single target, so they get a small tucked-away card instead of a reticle.
 */
import type { SegmentKind } from "@photonsurge/shared/director";
import type { BreakInReason } from "@photonsurge/shared/director-break-in";

/** Per-kind accent — matches the "now viewing" card's kind badge colours. */
export const KIND_COLOR: Record<SegmentKind, string> = {
  intro: "#1f9d72",
  global: "#1f9d72",
  ocean: "#1c7fb8",
  orbital: "#6a59c0",
  country: "#3f8f8f",
  region: "#4a8f6f",
  point: "#2f8f4e",
  storm: "#d23a3a",
  volcano: "#c2410c",
  quake: "#e08a1e",
  flight: "#2aa6c0",
  ship: "#3b6ea5",
  ad: "#d4a017",
};

/** Short kind badge label. */
export const KIND_LABEL: Record<SegmentKind, string> = {
  intro: "Live",
  global: "Live",
  ocean: "Ocean",
  orbital: "Orbital",
  country: "Country",
  region: "Region",
  point: "Point",
  storm: "Severe",
  volcano: "Volcano",
  quake: "Seismic",
  flight: "Aircraft",
  ship: "Vessel",
  ad: "Sponsor",
};

/** The INCOMING eyebrow per break-in reason (EventOverlay / the deck badge). */
export const BREAK_IN_LABEL: Record<BreakInReason, string> = {
  quake: "EARTHQUAKE",
  storm: "NEW WARNING",
  volcano: "ERUPTION",
  roundup: "NEW ROUND-UP",
};

/** The reticle's pre-roll eyebrow: what's incoming, or a plain detection. */
export function incomingEyebrow(segment: { breakIn?: { reason: BreakInReason } }): string {
  return segment.breakIn ? `⚡ INCOMING · ${BREAK_IN_LABEL[segment.breakIn.reason]}` : "EVENT DETECTED";
}

/** Who asked for this shot, for the on-air eyebrow — null for the director's own picks. */
export function requestedByLabel(segment: { requestedBy?: { author: string } }): string | null {
  const author = segment.requestedBy?.author?.trim();
  return author ? `REQUESTED BY @${author.replace(/^@/, "")}` : null;
}

/** Kinds that are a single tracked point → get the centred event reticle. */
const TARGETED = new Set<SegmentKind>(["storm", "volcano", "quake", "flight", "ship"]);

/** True when the segment is a specific point the reticle should frame. */
export function isTargetedEvent(kind: SegmentKind): boolean {
  return TARGETED.has(kind);
}

/** Kinds whose camera just sits on GLOBAL_VIEW's arbitrary framing point rather
 *  than a real ground location — there's nothing meaningful to sample weather
 *  or climate history for, so panels keyed on the camera centre should hide. */
const NO_LOCATION = new Set<SegmentKind>(["intro", "global", "ocean", "orbital"]);

/** True when the segment's camera centre is a real ground location worth
 *  sampling (as opposed to an arbitrary global framing point). */
export function hasRealLocation(kind: SegmentKind): boolean {
  return !NO_LOCATION.has(kind);
}
