import { ScatterplotLayer } from "@deck.gl/layers";
import type { Volcano } from "@photonsurge/shared/volcanoes/types";
import { DEPTH_TEST } from "./depth";

/**
 * Active-volcano overlay (Smithsonian/USGS weekly bulletin). deck's Icon/Text
 * layers (texture + font atlases) come back blank under this project's
 * MapLibre globe view — see tracks.ts's shapeToCoords / GlobeLabels — so the
 * actual volcano-cone glyph and name label are NOT drawn here. They're a DOM
 * overlay instead (VolcanoIcon + GlobeLabels in Globe.tsx), same pattern as
 * the seismograph stations. This file only provides the deck.gl part: a soft
 * ambient glow (status-tinted, bigger/hotter the more active) plus a small
 * pickable dot so the operator can still click a volcano to pull up its info
 * card even though the glyph itself is plain HTML.
 */

// Metres above the surface to float the markers — matches tracks.ts's
// SURFACE_ALT_M, avoiding any depth-buffer fighting with the basemap raster.
export const VOLCANO_ALT_M = 5000;

export function volcanoPosition(d: Volcano): [number, number, number] {
  return [d.lng, d.lat, VOLCANO_ALT_M];
}

export const VOLCANO_STATUS_COLORS: Record<Volcano["status"], [number, number, number]> = {
  erupting: [239, 68, 68], // red — active eruption
  unrest: [249, 115, 22], // orange — elevated unrest, no fresh eruption
  dormant: [148, 163, 184], // grey — easing off / no longer erupting
};

export function volcanoColor(v: Volcano): [number, number, number] {
  return VOLCANO_STATUS_COLORS[v.status];
}

const GLOW_RADIUS: Record<Volcano["status"], number> = { erupting: 40, unrest: 30, dormant: 22 };
const GLOW_ALPHA: Record<Volcano["status"], number> = { erupting: 70, unrest: 45, dormant: 28 };

export function volcanoLayers(volcanoes: Volcano[]) {
  return [
    // Wide glow halo — bigger and hotter the more active the status. Purely
    // ambient, not the click target (see the marker dot below).
    new ScatterplotLayer<Volcano>({
      id: "volcano-glow",
      data: volcanoes,
      getPosition: volcanoPosition,
      getRadius: (d) => GLOW_RADIUS[d.status],
      getFillColor: (d) => [...volcanoColor(d), GLOW_ALPHA[d.status]] as [number, number, number, number],
      radiusUnits: "pixels",
      radiusMinPixels: 10,
      radiusMaxPixels: 60,
      stroked: false,
      pickable: false,
      parameters: DEPTH_TEST,
      updateTriggers: { getFillColor: volcanoes.length, getRadius: volcanoes.length },
    }),
    // Small pickable core — the actual click target under the DOM glyph.
    new ScatterplotLayer<Volcano>({
      id: "volcano-marker",
      data: volcanoes,
      getPosition: volcanoPosition,
      getRadius: 6,
      getFillColor: (d) => [...volcanoColor(d), 235] as [number, number, number, number],
      radiusUnits: "pixels",
      radiusMinPixels: 5,
      radiusMaxPixels: 8,
      stroked: false,
      pickable: true,
      parameters: DEPTH_TEST,
      updateTriggers: { getFillColor: volcanoes.length },
    }),
  ];
}
