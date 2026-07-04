/**
 * Segment-kind presentation helpers shared by the broadcast on-air elements.
 * A "targeted" kind is a single point the director frames on screen (storm,
 * quake, aircraft, ship) → the centred EVENT DETECTION reticle. The wide kinds
 * (global intro, ocean, orbital, region tour, weather) have no single target, so
 * they get a small tucked-away card instead of a reticle framing empty screen.
 */
import type { SegmentKind } from "@photonsurge/shared/director";

/** Per-kind accent — matches the "now viewing" card's kind badge colours. */
export const KIND_COLOR: Record<SegmentKind, string> = {
  intro: "#1f9d72",
  ocean: "#1c7fb8",
  orbital: "#6a59c0",
  tour: "#3b6ea5",
  country: "#3f8f8f",
  weather: "#2f8f4e",
  storm: "#d23a3a",
  quake: "#e08a1e",
  flight: "#2aa6c0",
  ship: "#3b6ea5",
  ad: "#d4a017",
  summary: "#8a5fd1",
};

/** Short kind badge label. */
export const KIND_LABEL: Record<SegmentKind, string> = {
  intro: "Live",
  ocean: "Ocean",
  orbital: "Orbital",
  tour: "Region",
  country: "Country",
  weather: "Weather",
  storm: "Severe",
  quake: "Seismic",
  flight: "Aircraft",
  ship: "Vessel",
  ad: "Sponsor",
  summary: "Round-Up",
};

/** Kinds that are a single tracked point → get the centred event reticle. */
const TARGETED = new Set<SegmentKind>(["storm", "quake", "flight", "ship"]);

/** True when the segment is a specific point the reticle should frame. */
export function isTargetedEvent(kind: SegmentKind): boolean {
  return TARGETED.has(kind);
}

/** Kinds whose camera just sits on GLOBAL_VIEW's arbitrary framing point rather
 *  than a real ground location — there's nothing meaningful to sample weather
 *  or climate history for, so panels keyed on the camera centre should hide. */
const NO_LOCATION = new Set<SegmentKind>(["intro", "ocean", "orbital", "summary"]);

/** True when the segment's camera centre is a real ground location worth
 *  sampling (as opposed to an arbitrary global framing point). */
export function hasRealLocation(kind: SegmentKind): boolean {
  return !NO_LOCATION.has(kind);
}
