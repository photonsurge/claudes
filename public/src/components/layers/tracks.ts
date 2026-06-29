import { ScatterplotLayer, PathLayer, TextLayer, IconLayer } from "@deck.gl/layers";
import { CollisionFilterExtension } from "@deck.gl/extensions";
import type { Track } from "../../lib/tracks/types";
import type { TrackColorMode, TrackIconMode, TrackStyle } from "@photonsurge/shared/control";
import type { OrbitSegment } from "../../lib/tracks/orbit";
import type { TrackPath } from "../../lib/tracks/client";

type RGB = [number, number, number];

/** Default per-kind marker colours (the "kind" colour mode). */
const KIND_COLOR: Record<string, RGB> = {
  aircraft: [250, 204, 21],
  ship: [34, 197, 94],
  satellite: [56, 189, 248],
};

const clamp01 = (t: number) => Math.max(0, Math.min(1, t));
const lerp = (a: RGB, b: RGB, t: number): RGB => {
  const k = clamp01(t);
  return [Math.round(a[0] + (b[0] - a[0]) * k), Math.round(a[1] + (b[1] - a[1]) * k), Math.round(a[2] + (b[2] - a[2]) * k)];
};

/** Slow→fast gradient (slate → hot). Ships use knots, aircraft m/s. */
function speedColor(d: Track): RGB {
  const t = d.kind === "ship" ? (d.sogKn ?? 0) / 22 : (d.speedMS ?? 0) / 300;
  return lerp([71, 85, 120], [255, 90, 60], t);
}

/** Aircraft altitude band: ground green → cruise yellow → high pale. */
function altColor(altM?: number): RGB {
  const t = clamp01((altM ?? 0) / 12000);
  return t < 0.5 ? lerp([34, 197, 94], [250, 204, 21], t * 2) : lerp([250, 204, 21], [226, 232, 240], (t - 0.5) * 2);
}

function hslToRgb(h: number, s: number, l: number): RGB {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h * 12) % 12;
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
}

/** Deterministic hue per country string. */
function countryColor(country?: string): RGB {
  if (!country) return [148, 163, 184];
  let h = 0;
  for (let i = 0; i < country.length; i++) h = (h * 31 + country.charCodeAt(i)) >>> 0;
  return hslToRgb((h % 360) / 360, 0.6, 0.62);
}

/** Resolve a track's colour for the active per-kind colour mode. */
function colorFor(d: Track, mode: TrackColorMode): RGB {
  if (d.kind === "satellite") return d.color ?? KIND_COLOR.satellite;
  switch (mode) {
    case "speed":
      return speedColor(d);
    case "altitude":
      return d.kind === "aircraft" ? altColor(d.altM) : KIND_COLOR.ship;
    case "country":
      return d.kind === "aircraft" ? countryColor(d.country) : countryColor(d.country);
    case "kind":
    default:
      return d.color ?? KIND_COLOR[d.kind] ?? [255, 255, 255];
  }
}

/**
 * Icons are rendered to a canvas → PNG data URL (deck loads PNG reliably; SVG
 * data URIs are flaky in its texture pipeline). White shapes authored pointing
 * north (up) with mask:true so getColor tints them. Built lazily on first use
 * (needs `document`, so never at SSR import time) and cached.
 */
type DeckIcon = { url: string; width: number; height: number; anchorX: number; anchorY: number; mask: boolean };

function drawIcon(size: number, pts: [number, number][]): DeckIcon {
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
  ctx.fill();
  return { url: c.toDataURL("image/png"), width: size, height: size, anchorX: size / 2, anchorY: size / 2, mask: true };
}

let ICONS: { arrow: DeckIcon; plane: DeckIcon; ship: DeckIcon } | null = null;
function iconSet() {
  if (ICONS) return ICONS;
  if (typeof document === "undefined") return null; // SSR guard
  ICONS = {
    arrow: drawIcon(24, [[12, 1], [21, 22], [12, 17], [3, 22]]),
    plane: drawIcon(32, [[16, 1], [19, 13], [31, 20], [31, 23], [18, 18], [17, 27], [21, 30], [21, 31], [16, 29], [11, 31], [11, 30], [15, 27], [14, 18], [1, 23], [1, 20], [13, 13]]),
    ship: drawIcon(32, [[16, 2], [23, 13], [23, 24], [20, 30], [12, 30], [9, 24], [9, 13]]),
  };
  return ICONS;
}

function iconFor(d: Track, mode: TrackIconMode): DeckIcon | undefined {
  const set = iconSet();
  if (!set) return undefined;
  if (mode === "glyph") return d.kind === "aircraft" ? set.plane : set.ship;
  return set.arrow;
}

/**
 * Metres above the globe surface to float aircraft/ships. Sitting them exactly
 * on the sphere (z = altM or 0) makes their billboards z-fight the basemap
 * raster — they flicker/tear as the depth range shifts while zooming. A small
 * constant shell is invisible at globe scale (≈0.08% of Earth's radius) but
 * keeps every marker reliably in front of the surface. Satellites keep their
 * real altitude. depthTest stays on so the far hemisphere is still occluded.
 */
const SURFACE_ALT_M = 5000;

/** Position on the surface shell, except satellites which keep real altitude. */
function trackPosition(d: Track): [number, number, number] {
  const [lng, lat] = d.position;
  return d.kind === "satellite"
    ? (d.position as [number, number, number])
    : [lng, lat, SURFACE_ALT_M];
}

/**
 * Live-tracks overlay. Points coloured by kind, optional decluttered name labels
 * (CollisionFilterExtension shows more as you zoom — readable even with thousands
 * of satellites), and optional orbit rings. depthTest on so the globe occludes
 * the far side.
 */
const DEFAULT_STYLE: TrackStyle = { color: "kind", icon: "arrow" };

export function tracksLayer(
  tracks: Track[],
  opts: { labels?: boolean; aircraftStyle?: TrackStyle; shipStyle?: TrackStyle } = {},
) {
  const aircraftStyle = opts.aircraftStyle ?? DEFAULT_STYLE;
  const shipStyle = opts.shipStyle ?? DEFAULT_STYLE;

  const sats = tracks.filter((t) => t.kind === "satellite");
  const aircraft = tracks.filter((t) => t.kind === "aircraft");
  const ships = tracks.filter((t) => t.kind === "ship");

  // Dots: satellites always; aircraft/ships when their icon mode is "dot".
  const dotLayer = (id: string, data: Track[], mode: TrackColorMode) =>
    new ScatterplotLayer<Track>({
      id,
      data,
      getPosition: trackPosition,
      getFillColor: (d) => colorFor(d, mode),
      getRadius: (d) => (d.kind === "satellite" ? 3 : 2),
      radiusUnits: "pixels",
      radiusMinPixels: 1.5,
      radiusMaxPixels: 6,
      stroked: false,
      pickable: true,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      parameters: { depthTest: true } as any,
      updateTriggers: { getFillColor: [mode, data.length] },
    });

  // Heading-rotated, colour-tinted arrow/glyph markers for aircraft/ships.
  const markerLayer = (id: string, data: Track[], style: TrackStyle) =>
    new IconLayer<Track>({
      id,
      data,
      getPosition: trackPosition,
      getIcon: (d) => iconFor(d, style.icon),
      getColor: (d) => colorFor(d, style.color),
      getAngle: (d) => -(d.heading ?? 0), // deck rotates CCW; heading is CW from N
      getSize: style.icon === "glyph" ? 15 : 13,
      sizeUnits: "pixels",
      sizeMinPixels: 8,
      sizeMaxPixels: 26,
      pickable: true,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      parameters: { depthTest: true } as any,
      updateTriggers: { getColor: [style.color, data.length], getIcon: style.icon, getAngle: data.length },
    });

  // Distinct ids per layer type: deck.gl errors if one id changes layer class
  // between renders (Scatterplot ↔ Icon), so dot/marker never share an id.
  const kindLayer = (id: string, data: Track[], style: TrackStyle) =>
    style.icon === "dot" ? dotLayer(`${id}-dot`, data, style.color) : markerLayer(`${id}-icon`, data, style);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const layers: any[] = [];
  if (sats.length) layers.push(dotLayer("live-tracks-sat", sats, "kind"));
  if (aircraft.length) layers.push(kindLayer("live-tracks-aircraft", aircraft, aircraftStyle));
  if (ships.length) layers.push(kindLayer("live-tracks-ship", ships, shipStyle));

  if (opts.labels) {
    const labelColor = (d: Track): RGB =>
      d.kind === "aircraft"
        ? colorFor(d, aircraftStyle.color)
        : d.kind === "ship"
          ? colorFor(d, shipStyle.color)
          : d.color ?? [255, 255, 255];
    // Extension props (collision*) aren't on TextLayer's typed props, so build
    // the config loosely and cast.
    const labelProps = {
      id: "live-track-labels",
      data: tracks.filter((t) => t.name),
      getPosition: trackPosition,
      // Name/code only — deck's SDF TextLayer can't render colour flag emoji
      // (those show in the hover tooltip + admin tables, which are HTML).
      getText: (d: Track) => d.name ?? "",
      getColor: (d: Track) => [...labelColor(d), 235],
      getSize: 12,
      sizeUnits: "pixels",
      getPixelOffset: [9, 0],
      getTextAnchor: "start",
      getAlignmentBaseline: "center",
      fontFamily: "system-ui, sans-serif",
      fontWeight: 600,
      // Crisp halo so labels read over any basemap/weather.
      outlineWidth: 3,
      outlineColor: [0, 0, 0, 230],
      fontSettings: { sdf: true, radius: 12 },
      // Hide overlapping labels (more spacing → readable on dense traffic); more
      // appear as you zoom in. Higher sizeScale = more breathing room per label.
      extensions: [new CollisionFilterExtension()],
      collisionTestProps: { sizeScale: 3.5 },
      getCollisionPriority: (d: Track) => (d.kind === "satellite" ? 0 : 1),
      parameters: { depthTest: true },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    layers.push(new TextLayer(labelProps as any));
  }

  return layers;
}

/** Aircraft (amber) and ship (green) trail colours, matching the markers. */
const TRAIL_COLOR: Record<string, [number, number, number]> = {
  aircraft: [250, 204, 21],
  ship: [34, 197, 94],
};

/**
 * Live trailing routes: one path per aircraft/ship from recorded history. Drawn
 * UNDER the markers (call before tracksLayer) at the surface shell so they don't
 * z-fight the basemap. depthTest on so the far hemisphere is occluded.
 */
export function trailsLayer(trails: TrackPath[], opacity = 0.35) {
  const alpha = Math.max(0, Math.min(255, Math.round(opacity * 255)));
  return new PathLayer<TrackPath>({
    id: "track-trails",
    data: trails,
    // Lift onto the surface shell (same as markers) so trails don't z-fight the
    // basemap. Cast: deck's PathGeometry accessor type is awkward with the map.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    getPath: ((d: TrackPath) => d.path.map(([lng, lat]) => [lng, lat, SURFACE_ALT_M])) as any,
    getColor: (d) => [...(TRAIL_COLOR[d.kind] ?? [255, 255, 255]), alpha],
    getWidth: 1,
    widthUnits: "pixels",
    widthMinPixels: 0.5,
    capRounded: true,
    jointRounded: true,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    parameters: { depthTest: true } as any,
    updateTriggers: { getColor: [trails.length, alpha] },
  });
}

/** Satellite orbit rings (one PathLayer over all segments). */
export function orbitLayer(orbits: OrbitSegment[]) {
  return new PathLayer<OrbitSegment>({
    id: "orbit-rings",
    data: orbits,
    getPath: (d) => d.path,
    getColor: [56, 189, 248, 90],
    getWidth: 1,
    widthUnits: "pixels",
    widthMinPixels: 1,
    capRounded: true,
    jointRounded: true,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    parameters: { depthTest: true } as any,
  });
}
