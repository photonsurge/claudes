/**
 * Curated establishing shots and per-kind layer presets for the auto-director.
 *
 * ROIs are the ambient "tour" filler the director falls back to when nothing
 * notable is happening — a global spread of regions so the channel always has
 * somewhere photogenic to point. PRESETS define which layers each SegmentKind
 * turns on; the worker merges a preset with a camera to make a Segment.patch.
 */
import type { ControlState } from "./control";
import type { SegmentKind } from "./director";

export interface RegionOfInterest {
  id: string;
  name: string;
  /** [lng, lat] */
  center: [number, number];
  zoom: number;
}

/** A photogenic global rotation for tour/weather filler segments. */
export const REGIONS_OF_INTEREST: RegionOfInterest[] = [
  { id: "n-atlantic", name: "North Atlantic", center: [-40, 45], zoom: 3 },
  { id: "gulf-caribbean", name: "Gulf & Caribbean", center: [-82, 22], zoom: 3.2 },
  { id: "us-east", name: "Eastern US", center: [-78, 38], zoom: 3.5 },
  { id: "us-west", name: "Western US", center: [-118, 38], zoom: 3.5 },
  { id: "w-europe", name: "Western Europe", center: [5, 50], zoom: 3.6 },
  { id: "mediterranean", name: "Mediterranean", center: [15, 38], zoom: 3.4 },
  { id: "w-africa", name: "West Africa", center: [0, 8], zoom: 3.2 },
  { id: "s-africa", name: "Southern Africa", center: [25, -28], zoom: 3.2 },
  { id: "middle-east", name: "Middle East", center: [47, 28], zoom: 3.4 },
  { id: "south-asia", name: "South Asia", center: [80, 22], zoom: 3.3 },
  { id: "se-asia", name: "Southeast Asia", center: [110, 10], zoom: 3.2 },
  { id: "e-asia", name: "East Asia", center: [125, 35], zoom: 3.4 },
  { id: "japan", name: "Japan", center: [138, 37], zoom: 3.8 },
  { id: "australia", name: "Australia", center: [134, -25], zoom: 3.2 },
  { id: "s-america", name: "South America", center: [-60, -15], zoom: 3 },
];

/** Global establishing shot — the intro/idle spin. */
export const GLOBAL_VIEW: { center: [number, number]; zoom: number } = {
  center: [0, 20],
  zoom: 2.4,
};

/**
 * Layer preset per kind (everything except the camera, which the worker fills
 * in per subject). Kept partial so unspecified fields keep their prior value on
 * /watch via mergeControlState — we only assert what the shot needs.
 */
export const PRESETS: Record<SegmentKind, Partial<ControlState>> = {
  // Per-shot camera "mode" so the globe is always alive but never wanders off a
  // subject. Two deterministic motions (in phase across /control and /watch via
  // spinEpoch):
  //   • WIDE shots (intro/tour/weather) ORBIT — autoSpin sweeps the region so you
  //     read the heat/humidity/storm field across an area.
  //   • DETAIL shots (storm/quake/flight/ship) PUSH IN — no spin (stays dead-
  //     centred on the event), with a slow zoomDrift creeping closer.
  intro: {
    activeVariable: "temp",
    showWind: true,
    showCities: false,
    showContours: false,
    autoSpin: true,
    spinSpeed: 6,
    zoomDrift: 0,
    showAlerts: false,
    showSeismic: false,
    showAircraft: false,
    showShips: false,
    showTrails: false,
  },
  tour: {
    activeVariable: "temp",
    showWind: true,
    showCities: true,
    autoSpin: true,
    spinSpeed: 2.2,
    zoomDrift: 0,
    showAircraft: false,
    showShips: false,
    showSeismic: false,
  },
  weather: {
    activeVariable: "temp",
    showWind: true,
    showContours: true,
    showCities: true,
    autoSpin: true,
    spinSpeed: 1.6,
    zoomDrift: 0,
  },
  storm: {
    activeVariable: "gust",
    showWind: true,
    showAlerts: true,
    showContours: false,
    autoSpin: false,
    spinSpeed: 0,
    zoomDrift: 0.045,
    showCities: true,
  },
  quake: {
    showSeismic: true,
    showCities: true,
    showWind: false,
    autoSpin: false,
    spinSpeed: 0,
    zoomDrift: 0.045,
  },
  flight: {
    showAircraft: true,
    showTrails: true,
    showTrackLabels: true,
    showWind: false,
    autoSpin: false,
    spinSpeed: 0,
    zoomDrift: 0.035,
    showCities: true,
  },
  ship: {
    showShips: true,
    showTrails: true,
    showTrackLabels: true,
    showWind: false,
    autoSpin: false,
    spinSpeed: 0,
    zoomDrift: 0.035,
    showCities: true,
  },
};
