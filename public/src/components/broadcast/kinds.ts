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
  weather: "#2f8f4e",
  storm: "#d23a3a",
  quake: "#e08a1e",
  flight: "#2aa6c0",
  ship: "#3b6ea5",
  ad: "#d4a017",
};

/** Short kind badge label. */
export const KIND_LABEL: Record<SegmentKind, string> = {
  intro: "Live",
  ocean: "Ocean",
  orbital: "Orbital",
  tour: "Region",
  weather: "Weather",
  storm: "Severe",
  quake: "Seismic",
  flight: "Aircraft",
  ship: "Vessel",
  ad: "Sponsor",
};

/** Kinds that are a single tracked point → get the centred event reticle. */
const TARGETED = new Set<SegmentKind>(["storm", "quake", "flight", "ship"]);

/** True when the segment is a specific point the reticle should frame. */
export function isTargetedEvent(kind: SegmentKind): boolean {
  return TARGETED.has(kind);
}
