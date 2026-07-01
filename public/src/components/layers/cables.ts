import { PathLayer, ScatterplotLayer, TextLayer } from "@deck.gl/layers";
import { CollisionFilterExtension } from "@deck.gl/extensions";
import type { Cable, LandingPoint } from "@photonsurge/shared/cables/types";
import { hexToRgba } from "./props";
import { DEPTH_TEST } from "./depth";

/**
 * Submarine fiber-optic cable overlay (TeleGeography). Three sub-layers:
 *   • PathLayer  — the cable routes, tinted by the source's per-cable colour.
 *   • Scatterplot — coastal landing stations as small dots.
 *   • TextLayer  — landing-station labels, deck-decluttered so dense coastlines
 *                  (NY, London, Singapore…) don't turn into a wall of text.
 *
 * depthTest is ON so far-side cables are occluded by the globe's depth sphere
 * instead of bleeding through the front (same convention as the weather fills).
 *
 * Note on geometry: under deck's _GlobeView a polyline only curves with the
 * sphere if it has enough intermediate vertices. TeleGeography's paths are
 * already densely sampled great-circle routes, so they bend correctly without
 * us subdividing them.
 */

/** Stable glyph atlas covering ASCII + Latin-1 + Latin-Extended-A (accented
 * station names) so labels never render blank or re-flash mid-broadcast. */
const LABEL_CHARACTER_SET: string[] = (() => {
  const chars: string[] = [];
  for (let c = 0x20; c <= 0x7e; c++) chars.push(String.fromCodePoint(c));
  for (let c = 0xa0; c <= 0x17f; c++) chars.push(String.fromCodePoint(c));
  return chars;
})();

/** One drawable polyline: a single stretch of one cable, with its colour/name. */
interface CablePath {
  path: [number, number][];
  color: [number, number, number];
  name: string;
}

/** Flatten cables (each may have several disconnected stretches) into paths. */
function toCablePaths(cables: Cable[]): CablePath[] {
  const out: CablePath[] = [];
  for (const c of cables) {
    const [r, g, b] = hexToRgba(c.color);
    for (const path of c.paths) {
      if (path.length >= 2) out.push({ path, color: [r, g, b], name: c.name });
    }
  }
  return out;
}

export interface CableLayerOptions {
  /** Draw landing-station labels (decluttered). Default true. */
  labels?: boolean;
}

export function cableLayers(
  cables: Cable[],
  landings: LandingPoint[],
  opts: CableLayerOptions = {},
) {
  const paths = toCablePaths(cables);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const layers: any[] = [
    new PathLayer<CablePath>({
      id: "cable-lines",
      data: paths,
      getPath: (d) => d.path,
      getColor: (d) => [...d.color, 190] as [number, number, number, number],
      getWidth: 1,
      widthUnits: "pixels",
      widthMinPixels: 1,
      widthMaxPixels: 2.5,
      capRounded: true,
      jointRounded: true,
      pickable: false,
      parameters: DEPTH_TEST,
      updateTriggers: { getColor: paths.length, getPath: paths.length },
    }),
    new ScatterplotLayer<LandingPoint>({
      id: "cable-landings",
      data: landings,
      getPosition: (d) => [d.lng, d.lat, 0],
      getRadius: 2,
      getFillColor: [220, 240, 255, 230],
      getLineColor: [10, 20, 35, 220],
      stroked: true,
      lineWidthUnits: "pixels",
      getLineWidth: 0.75,
      lineWidthMinPixels: 0.5,
      radiusUnits: "pixels",
      radiusMinPixels: 1.5,
      radiusMaxPixels: 3,
      pickable: false,
      parameters: DEPTH_TEST,
      updateTriggers: { getPosition: landings.length },
    }),
  ];

  if (opts.labels !== false && landings.length) {
    const labelProps = {
      id: "cable-landing-labels",
      data: landings,
      getPosition: (d: LandingPoint) => [d.lng, d.lat, 0],
      getText: (d: LandingPoint) => d.name,
      getColor: [200, 225, 255, 235],
      getSize: 10,
      sizeUnits: "pixels",
      getTextAnchor: "start",
      getAlignmentBaseline: "center",
      getPixelOffset: [6, 0],
      fontFamily: "system-ui, sans-serif",
      fontSettings: { sdf: true, buffer: 8, radius: 12 },
      outlineWidth: 2,
      outlineColor: [0, 0, 0, 255],
      characterSet: LABEL_CHARACTER_SET,
      // Declutter: drop labels that would overlap so dense coastlines stay
      // legible on air rather than collapsing into solid text. collisionGroup/
      // collisionTestProps are contributed by the extension, not the base type.
      extensions: [new CollisionFilterExtension()],
      collisionGroup: "cable-labels",
      collisionTestProps: { sizeScale: 2 },
      pickable: false,
      parameters: DEPTH_TEST,
      updateTriggers: { getText: landings.length },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    layers.push(new TextLayer(labelProps as any));
  }

  return layers;
}
