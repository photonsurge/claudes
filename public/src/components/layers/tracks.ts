import { ScatterplotLayer, PathLayer, TextLayer, SolidPolygonLayer } from "@deck.gl/layers";
import type { Track } from "../../lib/tracks/types";
import type { TrackStyle } from "@photonsurge/shared/control";
import type { OrbitSegment } from "../../lib/tracks/orbit";
import type { TrackPath } from "../../lib/tracks/client";
import { DEPTH_TEST } from "./depth";

type RGB = [number, number, number];

/** Parse a `#rgb`/`#rrggbb` hex string to RGB, defaulting to white on garbage. */
function hexToRgb(hex?: string): RGB {
  const h = (hex ?? "").trim().replace(/^#/, "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return [255, 255, 255];
  return [parseInt(full.slice(0, 2), 16), parseInt(full.slice(2, 4), 16), parseInt(full.slice(4, 6), 16)];
}

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

/** Satellite altitude tint: LEO cyan → MEO violet → GEO warm. */
function satAltColor(altM?: number): RGB {
  const t = clamp01((altM ?? 0) / 35_786_000); // GEO ≈ 35,786 km
  return t < 0.5 ? lerp([56, 189, 248], [167, 139, 250], t * 2) : lerp([167, 139, 250], [251, 191, 36], (t - 0.5) * 2);
}

/** Resolve a track's colour for its type's colour mode (custom wins everywhere). */
function colorFor(d: Track, style: TrackStyle): RGB {
  if (style.color === "custom") return hexToRgb(style.customColor);
  if (d.kind === "satellite") {
    return style.color === "altitude" ? satAltColor(d.altM) : d.color ?? KIND_COLOR.satellite;
  }
  switch (style.color) {
    case "speed":
      return speedColor(d);
    case "altitude":
      return d.kind === "aircraft" ? altColor(d.altM) : KIND_COLOR.ship;
    case "country":
      return countryColor(d.country);
    case "kind":
    default:
      return d.color ?? KIND_COLOR[d.kind] ?? [255, 255, 255];
  }
}

/**
 * True if a track passes its type's display filters. All thresholds default to
 * off (0 / empty / false) so nothing is hidden until the operator sets one.
 * Speed compares knots for ships, m/s for aircraft/satellites.
 */
function passesFilter(d: Track, style: TrackStyle): boolean {
  const alt = d.altM ?? 0;
  if (style.hideGround && d.kind === "aircraft" && alt < 50) return false;
  if (style.minAltM && alt < style.minAltM) return false;
  if (style.maxAltM && alt > style.maxAltM) return false;
  const speed = d.kind === "ship" ? d.sogKn ?? 0 : d.speedMS ?? 0;
  if (style.minSpeed && speed < style.minSpeed) return false;
  const q = (style.country ?? "").trim().toLowerCase();
  if (q) {
    const tokens = q.split(",").map((s) => s.trim()).filter(Boolean);
    const c = (d.country ?? "").toLowerCase();
    if (!tokens.some((t) => c.includes(t))) return false;
  }
  return true;
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

/**
 * Thin labels to ~one per grid cell so dense traffic doesn't stack into an
 * unreadable blob. Each KIND is thinned independently (the cell key includes the
 * kind) so blanket aircraft coverage can't evict the sparser satellite/ship
 * names — otherwise sat labels (e.g. ISS) never show wherever a plane shares the
 * cell. Done in JS (not CollisionFilterExtension) because that extension
 * mis-culls on a globe.
 */
const LABEL_CELL_DEG = 5;
function labelSubset(tracks: Track[]): Track[] {
  const best = new Map<string, Track>();
  for (const t of tracks) {
    if (!t.name) continue;
    const cx = Math.round(t.position[0] / LABEL_CELL_DEG);
    const cy = Math.round(t.position[1] / LABEL_CELL_DEG);
    const key = `${t.kind}:${cx}:${cy}`;
    if (!best.has(key)) best.set(key, t);
  }
  return [...best.values()];
}

/**
 * Map a marker shape — authored in heading-relative (forward, right) unit space,
 * where +forward points toward the track's heading and +right is 90° clockwise —
 * onto [lng, lat, alt] coords around the track position, scaled by `sizeDeg`.
 * The cosL term keeps the shape from squashing at high latitudes. Polygons
 * render reliably under the MapLibre globe where Icon / Text layers (texture +
 * font atlases) come back blank, so every directional marker is a polygon.
 */
function shapeToCoords(d: Track, sizeDeg: number, shape: [number, number][]): [number, number, number][] {
  const lng = d.position[0];
  const lat = d.position[1];
  const h = ((d.heading ?? 0) * Math.PI) / 180;
  const cosL = Math.max(0.15, Math.cos((lat * Math.PI) / 180));
  const fLng = Math.sin(h) / cosL;
  const fLat = Math.cos(h); // forward (heading) unit
  const rLng = Math.cos(h) / cosL;
  const rLat = -Math.sin(h); // right unit (90° CW of forward)
  return shape.map(([f, r]) => [
    lng + (fLng * f + rLng * r) * sizeDeg,
    lat + (fLat * f + rLat * r) * sizeDeg,
    SURFACE_ALT_M,
  ]);
}

/** Generic heading arrowhead triangle (tip forward). Used by "arrow" icon mode. */
const ARROW_SHAPE: [number, number][] = [
  [1, 0], // tip (heading)
  [-0.5, 0.55], // right base
  [-0.5, -0.55], // left base
];

/** Plane silhouette (nose forward, swept wings + tailplane), as one simple ring. */
const PLANE_SHAPE: [number, number][] = [
  [1.0, 0.0], // nose
  [0.0, 0.1], [-0.1, 0.7], [-0.35, 0.7], [-0.25, 0.1], // right wing
  [-0.65, 0.1], [-0.8, 0.42], [-1.0, 0.42], [-0.9, 0.0], // right tailplane → tail
  [-1.0, -0.42], [-0.8, -0.42], [-0.65, -0.1], // left tailplane
  [-0.25, -0.1], [-0.35, -0.7], [-0.1, -0.7], [0.0, -0.1], // left wing
];

/** Ship hull silhouette (pointed bow forward, flat stern), as one simple ring. */
const SHIP_SHAPE: [number, number][] = [
  [1.0, 0.0], // bow
  [0.25, 0.32], [-0.85, 0.28], // right gunwale → stern quarter
  [-0.85, -0.28], [0.25, -0.32], // left stern quarter → gunwale
];

/** Diamond fallback for any other kind. */
const DIAMOND_SHAPE: [number, number][] = [[0.9, 0], [0, 0.8], [-0.9, 0], [0, -0.8]];

function arrowPolygon(d: Track, sizeDeg: number): [number, number, number][] {
  return shapeToCoords(d, sizeDeg, ARROW_SHAPE);
}

/** Per-kind silhouette for the "glyph" icon mode (plane / ship / diamond). */
function glyphPolygon(d: Track, sizeDeg: number): [number, number, number][] {
  const shape = d.kind === "aircraft" ? PLANE_SHAPE : d.kind === "ship" ? SHIP_SHAPE : DIAMOND_SHAPE;
  return shapeToCoords(d, sizeDeg, shape);
}

export function tracksLayer(
  tracks: Track[],
  opts: {
    labels?: boolean;
    satelliteStyle?: TrackStyle;
    aircraftStyle?: TrackStyle;
    shipStyle?: TrackStyle;
    zoom?: number;
  } = {},
) {
  const satelliteStyle = opts.satelliteStyle ?? { ...DEFAULT_STYLE, icon: "dot" };
  const aircraftStyle = opts.aircraftStyle ?? DEFAULT_STYLE;
  const shipStyle = opts.shipStyle ?? DEFAULT_STYLE;
  const styleFor = (d: Track): TrackStyle =>
    d.kind === "aircraft" ? aircraftStyle : d.kind === "ship" ? shipStyle : satelliteStyle;
  // Arrow size in degrees, scaled so it's ~constant on screen across zooms.
  const markerSizeDeg = Math.min(8, Math.max(0.05, 0.25 * Math.pow(2, 5 - (opts.zoom ?? 4))));

  // Apply each type's display filters up front (markers + labels both honour it).
  const sats = tracks.filter((t) => t.kind === "satellite" && passesFilter(t, satelliteStyle));
  const aircraft = tracks.filter((t) => t.kind === "aircraft" && passesFilter(t, aircraftStyle));
  const ships = tracks.filter((t) => t.kind === "ship" && passesFilter(t, shipStyle));

  // Dots: satellites always; aircraft/ships when their icon mode is "dot".
  const dotLayer = (id: string, data: Track[], style: TrackStyle) =>
    new ScatterplotLayer<Track>({
      id,
      data,
      getPosition: trackPosition,
      getFillColor: (d) => colorFor(d, style),
      getRadius: (d) => (d.kind === "satellite" ? 3 : 2),
      radiusUnits: "pixels",
      radiusMinPixels: 1.5,
      radiusMaxPixels: 6,
      stroked: false,
      opacity: style.opacity ?? 1,
      pickable: true,
      parameters: DEPTH_TEST,
      updateTriggers: { getFillColor: [style.color, style.customColor, data.length] },
    });

  // Directional arrowhead markers as filled triangles (SolidPolygonLayer).
  // Icon/Text layers come back blank under the MapLibre globe, but polygons draw
  // fine (same as alert areas), so this is the reliable way to show heading.
  const markerLayer = (id: string, data: Track[], style: TrackStyle) =>
    new SolidPolygonLayer<Track>({
      id,
      data,
      getPolygon: (d) =>
        style.icon === "glyph" ? glyphPolygon(d, markerSizeDeg) : arrowPolygon(d, markerSizeDeg),
      getFillColor: (d) => colorFor(d, style),
      opacity: style.opacity ?? 1,
      pickable: true,
      parameters: DEPTH_TEST,
      updateTriggers: {
        getPolygon: [data.length, markerSizeDeg, style.icon],
        getFillColor: [style.color, style.customColor, data.length],
      },
    });

  // Distinct ids per layer type: deck.gl errors if one id changes layer class
  // between renders (Scatterplot ↔ Icon), so dot/marker never share an id.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const layers: any[] = [];
  // dot mode → scatter dot; arrow/glyph → heading-oriented filled polygon.
  const trackLayer = (id: string, data: Track[], style: TrackStyle) =>
    style.icon === "dot"
      ? dotLayer(`${id}-dot`, data, style)
      : markerLayer(`${id}-icon`, data, style);

  if (sats.length) layers.push(dotLayer("live-tracks-sat", sats, satelliteStyle));
  if (aircraft.length) layers.push(trackLayer("live-tracks-aircraft", aircraft, aircraftStyle));
  if (ships.length) layers.push(trackLayer("live-tracks-ship", ships, shipStyle));

  if (opts.labels) {
    const labelColor = (d: Track): RGB => colorFor(d, styleFor(d));
    const labelProps = {
      id: "live-track-labels",
      // Spatially thinned (one label per grid cell) so dense traffic stays
      // readable. We do this in JS rather than CollisionFilterExtension because
      // that extension's collision pass mis-culls under _GlobeView (labels
      // vanish entirely). SDF text + outline so it reads over any basemap.
      data: labelSubset([...sats, ...aircraft, ...ships]),
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
      outlineWidth: 3,
      outlineColor: [0, 0, 0, 230],
      fontSettings: { sdf: true, radius: 12 },
      parameters: DEPTH_TEST,
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    layers.push(new TextLayer(labelProps as any));
  }

  return layers;
}

/**
 * Keep only the trails whose live track is currently visible — i.e. present in
 * the snapshot AND passing its type's display filters (speed/altitude/country/
 * on-ground). So when the operator filters markers (e.g. a min-speed), the
 * matching trails drop out too instead of dangling without a plane. Joined by
 * kind+externalId == Track.code, the same key the marker filter uses.
 */
export function filterTrails(
  trails: TrackPath[],
  tracks: Track[],
  aircraftStyle: TrackStyle,
  shipStyle: TrackStyle,
): TrackPath[] {
  const byKey = new Map<string, Track>();
  for (const t of tracks) {
    if (t.kind === "aircraft" || t.kind === "ship") byKey.set(`${t.kind}:${t.code}`, t);
  }
  return trails.filter((tr) => {
    const t = byKey.get(`${tr.kind}:${tr.externalId}`);
    if (!t) return false;
    return passesFilter(t, t.kind === "aircraft" ? aircraftStyle : shipStyle);
  });
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
    parameters: DEPTH_TEST,
    updateTriggers: { getColor: [trails.length, alpha] },
  });
}

/** Satellite orbit rings (one PathLayer over all segments). */
export function orbitLayer(orbits: OrbitSegment[]) {
  return new PathLayer<OrbitSegment>({
    id: "orbit-rings",
    data: orbits,
    getPath: (d) => d.path,
    // Low alpha: with a dense constellation (e.g. Starlink) hundreds of rings
    // overlap, so anything higher stacks into an opaque cyan smear.
    getColor: [56, 189, 248, 40],
    getWidth: 1,
    widthUnits: "pixels",
    widthMinPixels: 1,
    capRounded: true,
    jointRounded: true,
    parameters: DEPTH_TEST,
  });
}
