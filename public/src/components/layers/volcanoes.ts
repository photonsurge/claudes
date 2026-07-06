import { ScatterplotLayer, TextLayer } from "@deck.gl/layers";
import type { Volcano } from "@photonsurge/shared/volcanoes/types";
import { DEPTH_TEST } from "./depth";

/**
 * Active-volcano overlay (NASA EONET). Each event draws as a small "cone" glyph
 * — a hot core with a wide, pulsing-looking glow ring — coloured molten
 * red-orange when actively erupting and a cooler smoky amber when it's just
 * ongoing unrest with no fresh eruption report. Pickable (like the seismic
 * ring) so the operator can click one to pull up its info card. Depth-tested
 * like every globe layer so far-hemisphere volcanoes are occluded by the
 * planet. Erupting events get a name label; unrest events stay unlabeled to
 * keep the map readable.
 */

export const VOLCANO_STATUS_COLORS: Record<Volcano["status"], [number, number, number]> = {
  erupting: [255, 64, 32], // molten red-orange
  unrest: [196, 132, 58], // smoky amber advisory
};

export function volcanoColor(v: Volcano): [number, number, number] {
  return VOLCANO_STATUS_COLORS[v.status];
}

export function volcanoLayers(volcanoes: Volcano[]) {
  const erupting = volcanoes.filter((v) => v.status === "erupting");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const layers: any[] = [
    // Wide glow halo — bigger and hotter for actively-erupting events.
    new ScatterplotLayer<Volcano>({
      id: "volcano-glow",
      data: volcanoes,
      getPosition: (d) => [d.lng, d.lat, 0],
      getRadius: (d) => (d.status === "erupting" ? 30 : 16),
      getFillColor: (d) => [...volcanoColor(d), d.status === "erupting" ? 80 : 45] as [number, number, number, number],
      radiusUnits: "pixels",
      radiusMinPixels: 10,
      radiusMaxPixels: 60,
      stroked: false,
      pickable: false,
      parameters: DEPTH_TEST,
      updateTriggers: { getFillColor: volcanoes.length, getRadius: volcanoes.length },
    }),
    // Cone ring — hollow, status-tinted. `filled` with a transparent fill keeps
    // the whole disc clickable (like the seismic epicentre ring).
    new ScatterplotLayer<Volcano>({
      id: "volcano-ring",
      data: volcanoes,
      getPosition: (d) => [d.lng, d.lat, 0],
      getRadius: 9,
      filled: true,
      getFillColor: [0, 0, 0, 0],
      stroked: true,
      getLineColor: (d) => [...volcanoColor(d), 235] as [number, number, number, number],
      getLineWidth: 2,
      radiusUnits: "pixels",
      radiusMinPixels: 9,
      radiusMaxPixels: 14,
      lineWidthUnits: "pixels",
      lineWidthMinPixels: 2,
      pickable: true,
      parameters: DEPTH_TEST,
      updateTriggers: { getLineColor: volcanoes.length },
    }),
    // Bright core.
    new ScatterplotLayer<Volcano>({
      id: "volcano-core",
      data: volcanoes,
      getPosition: (d) => [d.lng, d.lat, 0],
      getRadius: 3,
      getFillColor: (d) => [...volcanoColor(d), 255] as [number, number, number, number],
      getLineColor: [255, 255, 255, 220],
      radiusUnits: "pixels",
      radiusMinPixels: 2,
      radiusMaxPixels: 4,
      lineWidthUnits: "pixels",
      getLineWidth: 0.75,
      lineWidthMinPixels: 0.5,
      stroked: true,
      pickable: true,
      parameters: DEPTH_TEST,
      updateTriggers: { getFillColor: volcanoes.length },
    }),
  ];

  if (erupting.length) {
    const labelProps = {
      id: "volcano-labels",
      data: erupting,
      getPosition: (d: Volcano) => [d.lng, d.lat, 0],
      getText: (d: Volcano) => `🌋 ${d.name}`,
      getColor: [255, 255, 255, 235],
      getSize: 11,
      sizeUnits: "pixels",
      getPixelOffset: [0, -14],
      getTextAnchor: "middle",
      getAlignmentBaseline: "bottom",
      fontFamily: "system-ui, sans-serif",
      fontSettings: { sdf: true },
      outlineWidth: 2,
      outlineColor: [0, 0, 0, 200],
      parameters: DEPTH_TEST,
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    layers.push(new TextLayer(labelProps as any));
  }

  return layers;
}
