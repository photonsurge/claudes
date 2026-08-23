import { type SegmentKind } from "@photonsurge/shared/director";

/**
 * Long-form operator-facing name for each director segment kind. Shared by the
 * /control director panel, the broadcast frame's shot readout and the
 * /admin/scenes channel card (broadcast/kinds.ts has a separate SHORT badge
 * map — keep them distinct).
 */
export const KIND_LABEL: Record<SegmentKind, string> = {
  intro: "Intro spin (opener)",
  global: "Global spin",
  ocean: "Ocean (world)",
  orbital: "Orbital (satellites)",
  country: "Countries",
  region: "Regions (areas)",
  point: "Point (sandbox)", // not director-scheduled; kind pickers iterate SEGMENT_KINDS so this never renders
  storm: "Severe storms",
  volcano: "Volcanoes",
  quake: "Earthquakes",
  flight: "Aircraft",
  ship: "Ships",
  ad: "Sponsor ads",
};
