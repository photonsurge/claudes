import { ScatterplotLayer, IconLayer, TextLayer } from "@deck.gl/layers";
import type { Volcano } from "@photonsurge/shared/volcanoes/types";
import { DEPTH_TEST } from "./depth";

/**
 * Active-volcano overlay (Smithsonian/USGS weekly bulletin). Each volcano draws
 * as a little volcano-cone icon — deliberately NOT a circle, so it reads as
 * distinct from the quake/fire dot markers at a glance — sitting on a soft
 * ambient glow, colour-coded by the report's own status tier: red when
 * actively erupting, orange for elevated unrest with no fresh eruption, and
 * grey once a report reads as easing off/dormant. The icon is a real served
 * static .png asset (`/icons/volcano.png`, baked from volcano.svg via sharp;
 * `mask: true` so `getColor` tints it) — NOT a canvas-built/font-based atlas
 * or an SVG needing browser-side rasterization, both of which render
 * unreliably under this globe's _GlobeView. Pickable so the operator can
 * click one to pull up its info card. Depth-tested like every globe layer
 * so far-hemisphere
 * volcanoes are occluded by the planet. Erupting events get a name label;
 * unrest/dormant stay unlabeled to keep the map readable.
 */

const VOLCANO_ICON_ATLAS = "/icons/volcano.png";
const VOLCANO_ICON_MAPPING = {
  volcano: { x: 0, y: 0, width: 64, height: 64, mask: true },
};

export const VOLCANO_STATUS_COLORS: Record<Volcano["status"], [number, number, number]> = {
  erupting: [239, 68, 68], // red — active eruption
  unrest: [249, 115, 22], // orange — elevated unrest, no fresh eruption
  dormant: [148, 163, 184], // grey — easing off / no longer erupting
};

export function volcanoColor(v: Volcano): [number, number, number] {
  return VOLCANO_STATUS_COLORS[v.status];
}

const GLOW_RADIUS: Record<Volcano["status"], number> = { erupting: 26, unrest: 16, dormant: 11 };
const GLOW_ALPHA: Record<Volcano["status"], number> = { erupting: 70, unrest: 45, dormant: 28 };
const ICON_SIZE: Record<Volcano["status"], number> = { erupting: 32, unrest: 24, dormant: 18 };

export function volcanoLayers(volcanoes: Volcano[]) {
  const erupting = volcanoes.filter((v) => v.status === "erupting");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const layers: any[] = [
    // Wide glow halo — bigger and hotter the more active the status.
    new ScatterplotLayer<Volcano>({
      id: "volcano-glow",
      data: volcanoes,
      getPosition: (d) => [d.lng, d.lat, 0],
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
    // The volcano icon itself — status-coloured, constant pixel size (visible
    // at any zoom, like the glow beneath it). This is the pickable marker.
    new IconLayer<Volcano>({
      id: "volcano-glyph",
      data: volcanoes,
      getPosition: (d) => [d.lng, d.lat, 0],
      iconAtlas: VOLCANO_ICON_ATLAS,
      iconMapping: VOLCANO_ICON_MAPPING,
      getIcon: () => "volcano",
      getColor: (d) => [...volcanoColor(d), 255] as [number, number, number, number],
      getSize: (d) => ICON_SIZE[d.status],
      sizeUnits: "pixels",
      pickable: true,
      parameters: DEPTH_TEST,
      updateTriggers: { getColor: volcanoes.length, getSize: volcanoes.length },
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
      getPixelOffset: [0, -18],
      getTextAnchor: "middle",
      getAlignmentBaseline: "bottom",
      fontFamily: "system-ui, sans-serif",
      fontSettings: { sdf: true },
      outlineWidth: 2,
      outlineColor: [0, 0, 0, 200],
      characterSet: "auto",
      parameters: DEPTH_TEST,
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    layers.push(new TextLayer(labelProps as any));
  }

  return layers;
}
