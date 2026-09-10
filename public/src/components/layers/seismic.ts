import { ScatterplotLayer, TextLayer } from "@deck.gl/layers";
import { quakeDepthClass } from "@photonsurge/shared/seismic";
import type { Quake } from "../../lib/tracks/types";
import { DEPTH_TEST } from "./depth";

/**
 * Earthquake overlay. Quakes draw as an epicentre TARGET — a hollow ring with a
 * small centre dot — so they read as a distinct "icony" marker and are never
 * confused with the solid, filled hazard badges of the area-alert zones. Ring
 * radius scales with magnitude; colour encodes hypocentre depth (shallow quakes,
 * felt hardest, are red; deep ones blue). M5+ get a translucent halo and a
 * magnitude label. Depth-tested (like every globe layer) so a quake on the far
 * hemisphere is hidden by the globe instead of bleeding through the front.
 *
 * `visible` toggles drawing; the layers themselves stay mounted. The director
 * flips quakes on and off between cuts, and rebuilding the four layers on each
 * on-cut cost ~25 ms of model + attribute init — plus, the first time, the
 * label layer's SDF font atlas (58 ms) right inside the cut. Mounted from the
 * start (label layer included, empty or not) that all happens once, at page
 * load (docs/watch-perf-plan.md, round 54).
 */

/** Depth (km) → colour. Shallow = red, intermediate = orange, deep = blue. */
export const QUAKE_DEPTH_COLORS = {
  shallow: [239, 68, 68] as [number, number, number], // < 70 km
  intermediate: [249, 115, 22] as [number, number, number], // 70–300 km
  deep: [59, 130, 246] as [number, number, number], // > 300 km
};
export function depthColor(depthKm: number): [number, number, number] {
  return QUAKE_DEPTH_COLORS[quakeDepthClass(depthKm)];
}

/** Magnitude → epicentre-ring radius in pixels (roughly area ∝ energy, clamped). */
const radiusPx = (mag: number): number => Math.max(4, mag * mag * 0.9);

export function seismicLayer(quakes: Quake[], visible = true) {
  const big = quakes.filter((q) => q.mag >= 5);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const layers: any[] = [
    // Halo behind the larger quakes for on-air emphasis.
    new ScatterplotLayer<Quake>({
      id: "seismic-halo",
      data: big,
      getPosition: (d) => [d.lng, d.lat, 0],
      getRadius: (d) => radiusPx(d.mag) * 2.2,
      getFillColor: (d) => [...depthColor(d.depthKm), 45] as [number, number, number, number],
      radiusUnits: "pixels",
      radiusMaxPixels: 140,
      stroked: false,
      pickable: false,
      parameters: DEPTH_TEST,
      updateTriggers: { getFillColor: big.length, getRadius: big.length },
      visible,
    }),
    // Epicentre ring — hollow, depth-tinted, magnitude-scaled. This is the
    // "icony" shape that sets quakes apart from the filled alert badges.
    // `filled` is on with a fully-transparent fill so the WHOLE disc is a click
    // target (deck picks filled geometry regardless of its display alpha) — the
    // ring reads as hollow but the operator can click anywhere inside it to pull
    // up the info card, not just land on the ~1.5px stroke. radiusMinPixels also
    // keeps a small quake's disc clickable when the ring shrinks under 4px.
    new ScatterplotLayer<Quake>({
      id: "seismic-ring",
      data: quakes,
      getPosition: (d) => [d.lng, d.lat, 0],
      getRadius: (d) => radiusPx(d.mag),
      filled: true,
      getFillColor: [0, 0, 0, 0],
      stroked: true,
      getLineColor: (d) => [...depthColor(d.depthKm), 235] as [number, number, number, number],
      getLineWidth: (d) => 1.5 + d.mag * 0.35,
      radiusUnits: "pixels",
      radiusMinPixels: 6,
      radiusMaxPixels: 60,
      lineWidthUnits: "pixels",
      lineWidthMinPixels: 1.5,
      pickable: true,
      parameters: DEPTH_TEST,
      updateTriggers: { getLineColor: quakes.length, getRadius: quakes.length, getLineWidth: quakes.length },
      visible,
    }),
    // Centre dot — the epicentre point itself (fixed small size, depth-tinted).
    new ScatterplotLayer<Quake>({
      id: "seismic-core",
      data: quakes,
      getPosition: (d) => [d.lng, d.lat, 0],
      getRadius: 2,
      getFillColor: (d) => [...depthColor(d.depthKm), 255] as [number, number, number, number],
      getLineColor: [255, 255, 255, 220],
      radiusUnits: "pixels",
      radiusMinPixels: 1.5,
      radiusMaxPixels: 3,
      lineWidthUnits: "pixels",
      getLineWidth: 0.75,
      lineWidthMinPixels: 0.5,
      stroked: true,
      pickable: true,
      parameters: DEPTH_TEST,
      updateTriggers: { getFillColor: quakes.length },
      visible,
    }),
  ];

  {
    const labelProps = {
      id: "seismic-labels",
      data: big,
      getPosition: (d: Quake) => [d.lng, d.lat, 0],
      getText: (d: Quake) => `M${d.mag.toFixed(1)}`,
      getColor: [255, 255, 255, 235],
      getSize: 11,
      sizeUnits: "pixels",
      getPixelOffset: [0, -10],
      getTextAnchor: "middle",
      getAlignmentBaseline: "bottom",
      fontFamily: "system-ui, sans-serif",
      fontSettings: { sdf: true },
      outlineWidth: 2,
      outlineColor: [0, 0, 0, 200],
      parameters: DEPTH_TEST,
      visible,
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    layers.push(new TextLayer(labelProps as any));
  }

  return layers;
}
