"use client";

/**
 * Reference graticule overlay — the named lines of the planet: the Equator, the
 * two Tropics (Cancer / Capricorn, at ±23.4367° axial tilt), the polar circles
 * (Arctic / Antarctic, at ±66.5633°) and the key meridians (Prime Meridian and
 * the 180° antimeridian / Date Line).
 *
 * The rings are floated a few dozen km ABOVE the surface (a small altitude on
 * every vertex) so they hover just clear of the basemap depth sphere instead of
 * z-fighting it — depthTest stays on, so only the near hemisphere's lines show
 * and the far side is correctly occluded, the same as the country borders.
 */
import { PathLayer, TextLayer } from "@deck.gl/layers";
import { PathStyleExtension } from "@deck.gl/extensions";
import { hexToRgb } from "./basemap";
import { DEPTH_TEST } from "./depth";

/** Axial tilt → the Tropics; its complement (90−tilt) → the polar circles. */
const AXIAL_TILT = 23.43667;
const POLAR = 90 - AXIAL_TILT; // 66.56333°

/** Metres to lift the lines above the surface so they hover, free of z-fighting. */
const ELEV = 30_000;

interface Line {
  /** Polyline vertices as [lng, lat, altitude]. */
  path: [number, number, number][];
  /** Stroke weight (px multiplier) — the Equator/Prime are heavier than the rest. */
  weight: number;
  /** Stroke alpha 0–255 — primary lines brighter than secondary ones. */
  alpha: number;
  /** Label anchor [lng, lat, altitude] and text. */
  labelAt: [number, number, number];
  label: string;
}

/** A full parallel (line of latitude) sampled densely so it curves on the globe. */
function parallel(lat: number, label: string, weight: number, alpha: number): Line {
  const path: [number, number, number][] = [];
  for (let lng = -180; lng <= 180; lng += 4) path.push([lng, lat, ELEV]);
  return { path, weight, alpha, label, labelAt: [-160, lat, ELEV] };
}

/** A meridian (line of longitude) from near-pole to near-pole. */
function meridian(lng: number, label: string, weight: number, alpha: number): Line {
  const path: [number, number, number][] = [];
  for (let lat = -85; lat <= 85; lat += 2) path.push([lng, lat, ELEV]);
  return { path, weight, alpha, label, labelAt: [lng, 78, ELEV] };
}

const LINES: Line[] = [
  // Parallels — the Equator is the hero line, tropics next, polar circles faintest.
  parallel(0, "Equator", 1, 235),
  parallel(AXIAL_TILT, "Tropic of Cancer", 0.7, 175),
  parallel(-AXIAL_TILT, "Tropic of Capricorn", 0.7, 175),
  parallel(POLAR, "Arctic Circle", 0.55, 140),
  parallel(-POLAR, "Antarctic Circle", 0.55, 140),
  // Meridians — "the other axis".
  meridian(0, "Prime Meridian", 0.7, 175),
  meridian(180, "180° · Date Line", 0.55, 140),
];

/**
 * Build the graticule layers. `color` is the operator-chosen hex; `labels` toggles
 * the text. Returns [PathLayer] or [PathLayer, TextLayer].
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function graticuleLayer(color: string, labels: boolean): any[] {
  const [r, g, b] = hexToRgb(color);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const out: any[] = [
    new PathLayer<Line>({
      id: "graticule-lines",
      data: LINES,
      getPath: (d) => d.path,
      getColor: (d) => [r, g, b, d.alpha],
      getWidth: (d) => d.weight * 1.6,
      widthUnits: "pixels",
      widthMinPixels: 0.8,
      widthMaxPixels: 2.4,
      extensions: [new PathStyleExtension({ dash: true })],
      // Dashed so the reference lines read as an overlay, not a coastline. The
      // dash props come from PathStyleExtension and aren't on the base PathLayer
      // prop type, so cast them in.
      ...({ getDashArray: [6, 5], dashJustified: true } as Record<string, unknown>),
      // Depth-tested so the far hemisphere's lines are hidden by the globe.
      parameters: DEPTH_TEST,
      pickable: false,
      updateTriggers: { getColor: [r, g, b] },
    }),
  ];

  if (labels) {
    out.push(
      new TextLayer<Line>({
        id: "graticule-labels",
        data: LINES,
        getPosition: (d) => d.labelAt,
        getText: (d) => d.label,
        getColor: [r, g, b, 240],
        getSize: 11,
        sizeUnits: "pixels",
        getTextAnchor: "start",
        getAlignmentBaseline: "bottom",
        getPixelOffset: [4, -3],
        fontFamily: "system-ui, sans-serif",
        fontSettings: { sdf: true },
        outlineWidth: 2,
        outlineColor: [0, 0, 0, 200],
        parameters: DEPTH_TEST,
        pickable: false,
        updateTriggers: { getColor: [r, g, b] },
      }),
    );
  }

  return out;
}
