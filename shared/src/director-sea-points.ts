import type { SeaPoint } from "./sea-points/types";

/**
 * Seed data for the `SeaPoint` Mongo catalog (see `db/sea-point-model.ts`) —
 * read only by `worker/src/scripts/seedSeaPoints.ts`. The live catalog lives
 * in Mongo and is managed at `/admin/sea-points`; neither the worker's
 * Director nor any client code reads this array at runtime.
 *
 * Two families: oceanographically notable currents/features (held-still
 * single-depth shots) and real depth-monitoring regions (`depthCycle: true`)
 * where the editorial point IS the thermocline — El Niño/ENSO, the Atlantic
 * hurricane Main Development Region, the North Sea, the Mediterranean, and
 * the Indian Ocean Dipole.
 */
export const SEED_SEA_POINTS: SeaPoint[] = [
  // Currents & features
  { pointId: "gulf-stream", name: "Gulf Stream", blurb: "Warm western-boundary current, N. Atlantic", lng: -70, lat: 36, zoom: 4.5, depthCycle: false, enabled: true },
  { pointId: "sargasso-sea", name: "Sargasso Sea", blurb: "Becalmed subtropical gyre core", lng: -60, lat: 30, zoom: 4, depthCycle: false, enabled: true },
  { pointId: "drake-passage", name: "Drake Passage", blurb: "Antarctic Circumpolar Current", lng: -65, lat: -60, zoom: 4, depthCycle: false, enabled: true },
  { pointId: "humboldt", name: "Humboldt Current", blurb: "Cold upwelling off Peru & Chile", lng: -75, lat: -20, zoom: 4, depthCycle: false, enabled: true },
  { pointId: "norwegian-sea", name: "Norwegian Sea", blurb: "Where Gulf Stream water meets the Arctic", lng: 2, lat: 70, zoom: 3.5, depthCycle: false, enabled: true },
  { pointId: "agulhas", name: "Agulhas Current", blurb: "Warm current off South Africa", lng: 28, lat: -33, zoom: 4.5, depthCycle: false, enabled: true },
  { pointId: "bay-of-bengal", name: "Bay of Bengal", blurb: "Warm cyclone nursery, N. Indian Ocean", lng: 88, lat: 15, zoom: 4.5, depthCycle: false, enabled: true },
  { pointId: "warm-pool", name: "Indo-Pacific Warm Pool", blurb: "Earth's largest reservoir of warm water", lng: 130, lat: 0, zoom: 3.5, depthCycle: false, enabled: true },
  { pointId: "kuroshio", name: "Kuroshio Current", blurb: 'The "Black Stream", off Japan', lng: 145, lat: 35, zoom: 4.5, depthCycle: false, enabled: true },
  { pointId: "mariana-trench", name: "Mariana Trench", blurb: "Deepest point in the ocean", lng: 142.2, lat: 11.35, zoom: 5, depthCycle: false, enabled: true },
  // Ocean-monitoring regions — depth cycling, since the story IS the thermocline
  { pointId: "nino-1-2", name: "Niño 1+2", blurb: "El Niño monitoring region, off Peru & Ecuador", lng: -85, lat: -5, zoom: 4.5, depthCycle: true, enabled: true },
  { pointId: "nino-3", name: "Niño 3", blurb: "El Niño monitoring region, eastern equatorial Pacific", lng: -120, lat: 0, zoom: 4, depthCycle: true, enabled: true },
  { pointId: "nino-3-4", name: "Niño 3.4", blurb: "El Niño monitoring region — the standard ENSO index box", lng: -145, lat: 0, zoom: 3.5, depthCycle: true, enabled: true },
  { pointId: "nino-4", name: "Niño 4", blurb: "El Niño monitoring region, western-central equatorial Pacific", lng: -175, lat: 0, zoom: 3.5, depthCycle: true, enabled: true },
  { pointId: "atlantic-mdr", name: "Atlantic Main Development Region", blurb: "Hurricane nursery — subsurface heat fuels rapid intensification", lng: -40, lat: 15, zoom: 4, depthCycle: true, enabled: true },
  { pointId: "north-sea", name: "North Sea", blurb: "Shallow shelf sea — winter storms mix it top to bottom", lng: 3, lat: 56, zoom: 5, depthCycle: true, enabled: true },
  { pointId: "mediterranean", name: "Mediterranean Sea", blurb: "Warm, salty outflow sinks into the Atlantic at depth", lng: 18, lat: 35, zoom: 4.5, depthCycle: true, enabled: true },
  { pointId: "iod-west", name: "Indian Ocean Dipole — West", blurb: "West pole of the Indian Ocean's own El Niño-like seesaw", lng: 60, lat: 0, zoom: 4, depthCycle: true, enabled: true },
  { pointId: "iod-east", name: "Indian Ocean Dipole — East", blurb: "East pole of the Indian Ocean's own El Niño-like seesaw", lng: 100, lat: -5, zoom: 4, depthCycle: true, enabled: true },
];
