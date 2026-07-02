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
 * Note on geometry: under deck's _GlobeView a PathLayer draws each segment as a
 * straight 3D chord, NOT a geodesic. A long trans-ocean stretch therefore sinks
 * below the sphere at its midpoint, where depthTest (on) has the globe occlude
 * it — leaving the mid-ocean gaps TeleGeography's sparse waypoints would show.
 * So we great-circle-densify any segment longer than DENSIFY_STEP_DEG, keeping
 * the polyline hugging the surface end to end.
 */

/** Max great-circle gap (degrees of arc) between consecutive path vertices
 * before we interpolate. ~2° keeps every chord's sag under the depth sphere. */
const DENSIFY_STEP_DEG = 2;
const DEG = Math.PI / 180;

/** Great-circle distance between two [lng,lat] points, in degrees of arc. */
function arcDeg(a: [number, number], b: [number, number]): number {
  const [lng1, lat1] = a;
  const [lng2, lat2] = b;
  const φ1 = lat1 * DEG;
  const φ2 = lat2 * DEG;
  const dφ = (lat2 - lat1) * DEG;
  const dλ = (lng2 - lng1) * DEG;
  const h =
    Math.sin(dφ / 2) ** 2 +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(dλ / 2) ** 2;
  return (2 * Math.asin(Math.min(1, Math.sqrt(h)))) / DEG;
}

/** Slerp two [lng,lat] points via 3D unit vectors and back to lng/lat. */
function slerp(
  a: [number, number],
  b: [number, number],
  t: number,
): [number, number] {
  const toVec = ([lng, lat]: [number, number]) => {
    const φ = lat * DEG;
    const λ = lng * DEG;
    return [Math.cos(φ) * Math.cos(λ), Math.cos(φ) * Math.sin(λ), Math.sin(φ)];
  };
  const va = toVec(a);
  const vb = toVec(b);
  let dot = va[0] * vb[0] + va[1] * vb[1] + va[2] * vb[2];
  dot = Math.max(-1, Math.min(1, dot));
  const ω = Math.acos(dot);
  if (ω < 1e-9) return a;
  const s = Math.sin(ω);
  const k1 = Math.sin((1 - t) * ω) / s;
  const k2 = Math.sin(t * ω) / s;
  const x = k1 * va[0] + k2 * vb[0];
  const y = k1 * va[1] + k2 * vb[1];
  const z = k1 * va[2] + k2 * vb[2];
  const lat = Math.atan2(z, Math.sqrt(x * x + y * y)) / DEG;
  const lng = Math.atan2(y, x) / DEG;
  return [lng, lat];
}

/** Subdivide any segment longer than DENSIFY_STEP_DEG along its great circle so
 * the polyline follows the globe instead of chording under it. */
function densify(path: [number, number][]): [number, number][] {
  if (path.length < 2) return path;
  const out: [number, number][] = [path[0]];
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    const d = arcDeg(a, b);
    if (d > DENSIFY_STEP_DEG) {
      const steps = Math.ceil(d / DENSIFY_STEP_DEG);
      for (let s = 1; s < steps; s++) out.push(slerp(a, b, s / steps));
    }
    out.push(b);
  }
  return out;
}

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
      if (path.length >= 2)
        out.push({ path: densify(path), color: [r, g, b], name: c.name });
    }
  }
  return out;
}

export interface CableLayerOptions {
  /** Draw landing-station labels (decluttered). Default true. */
  labels?: boolean;
  /** Draw a name label on each cable route (decluttered). Default false. */
  cableLabels?: boolean;
}

/** One cable-name label anchored at the midpoint of its longest stretch. */
interface CableLabel {
  position: [number, number];
  name: string;
}

/** Place one label per cable at the midpoint vertex of its longest path, so the
 * text sits out over the ocean on the route rather than piling up at a coast. */
function toCableLabels(cables: Cable[]): CableLabel[] {
  const out: CableLabel[] = [];
  for (const c of cables) {
    let best: [number, number][] | null = null;
    for (const p of c.paths) {
      if (p.length >= 2 && (!best || p.length > best.length)) best = p;
    }
    if (!best) continue;
    const mid = best[Math.floor(best.length / 2)];
    out.push({ position: [mid[0], mid[1]], name: c.name });
  }
  return out;
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

  if (opts.cableLabels) {
    const cableLabelData = toCableLabels(cables);
    const cableLabelProps = {
      id: "cable-name-labels",
      data: cableLabelData,
      getPosition: (d: CableLabel) => [d.position[0], d.position[1], 0],
      getText: (d: CableLabel) => d.name,
      getColor: [180, 220, 255, 235],
      getSize: 11,
      sizeUnits: "pixels",
      getTextAnchor: "middle",
      getAlignmentBaseline: "center",
      fontFamily: "system-ui, sans-serif",
      fontSettings: { sdf: true, buffer: 8, radius: 12 },
      outlineWidth: 2,
      outlineColor: [0, 0, 0, 255],
      characterSet: LABEL_CHARACTER_SET,
      // Own collision group so cable names declutter against each other but not
      // against the landing-station labels — the two label sets are independent.
      extensions: [new CollisionFilterExtension()],
      collisionGroup: "cable-names",
      collisionTestProps: { sizeScale: 2 },
      pickable: false,
      parameters: DEPTH_TEST,
      updateTriggers: { getText: cableLabelData.length },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    layers.push(new TextLayer(cableLabelProps as any));
  }

  return layers;
}
