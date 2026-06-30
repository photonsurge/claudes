import { ScatterplotLayer, PathLayer, TextLayer, SolidPolygonLayer } from "@deck.gl/layers";
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
 * unreadable blob, preferring aircraft > ship > satellite within a cell. Done in
 * JS (not CollisionFilterExtension) because that extension mis-culls on a globe.
 */
const LABEL_CELL_DEG = 5;
function labelSubset(tracks: Track[]): Track[] {
  const prio = (k: string) => (k === "aircraft" ? 2 : k === "ship" ? 1 : 0);
  const best = new Map<string, Track>();
  for (const t of tracks) {
    if (!t.name) continue;
    const key = `${Math.round(t.position[0] / LABEL_CELL_DEG)}:${Math.round(t.position[1] / LABEL_CELL_DEG)}`;
    const cur = best.get(key);
    if (!cur || prio(t.kind) > prio(cur.kind)) best.set(key, t);
  }
  return [...best.values()];
}

/**
 * A small heading-oriented arrowhead triangle (3 pts, floated above the surface)
 * for one track. Polygons render reliably under the MapLibre globe where Icon /
 * Text layers (texture + font atlases) come back blank, so this is how we draw
 * directional markers. `sizeDeg` is scaled by zoom so the arrow stays roughly a
 * constant size on screen. Authored around the track position, tip toward heading.
 */
function arrowPolygon(d: Track, sizeDeg: number): [number, number, number][] {
  const lng = d.position[0];
  const lat = d.position[1];
  const h = ((d.heading ?? 0) * Math.PI) / 180;
  const cosL = Math.max(0.15, Math.cos((lat * Math.PI) / 180));
  const fLng = Math.sin(h) / cosL;
  const fLat = Math.cos(h); // forward (heading) unit
  const rLng = Math.cos(h) / cosL;
  const rLat = -Math.sin(h); // right unit
  const s = sizeDeg;
  const hw = s * 0.55; // half-width at the base
  const baseLng = lng - fLng * s * 0.5;
  const baseLat = lat - fLat * s * 0.5;
  return [
    [lng + fLng * s, lat + fLat * s, SURFACE_ALT_M], // tip (heading)
    [baseLng + rLng * hw, baseLat + rLat * hw, SURFACE_ALT_M], // right
    [baseLng - rLng * hw, baseLat - rLat * hw, SURFACE_ALT_M], // left
  ];
}

export function tracksLayer(
  tracks: Track[],
  opts: { labels?: boolean; aircraftStyle?: TrackStyle; shipStyle?: TrackStyle; zoom?: number } = {},
) {
  const aircraftStyle = opts.aircraftStyle ?? DEFAULT_STYLE;
  const shipStyle = opts.shipStyle ?? DEFAULT_STYLE;
  // Arrow size in degrees, scaled so it's ~constant on screen across zooms.
  const markerSizeDeg = Math.min(8, Math.max(0.05, 0.25 * Math.pow(2, 5 - (opts.zoom ?? 4))));

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

  // Directional arrowhead markers as filled triangles (SolidPolygonLayer).
  // Icon/Text layers come back blank under the MapLibre globe, but polygons draw
  // fine (same as alert areas), so this is the reliable way to show heading.
  const markerLayer = (id: string, data: Track[], style: TrackStyle) =>
    new SolidPolygonLayer<Track>({
      id,
      data,
      getPolygon: (d) => arrowPolygon(d, markerSizeDeg),
      getFillColor: (d) => colorFor(d, style.color),
      pickable: true,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      parameters: { depthTest: true } as any,
      updateTriggers: {
        getPolygon: [data.length, markerSizeDeg],
        getFillColor: [style.color, data.length],
      },
    });

  // Distinct ids per layer type: deck.gl errors if one id changes layer class
  // between renders (Scatterplot ↔ Icon), so dot/marker never share an id.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const layers: any[] = [];
  // dot mode → scatter dot; arrow/glyph → heading-rotated TextLayer glyph.
  const trackLayer = (id: string, data: Track[], style: TrackStyle) =>
    style.icon === "dot"
      ? dotLayer(`${id}-dot`, data, style.color)
      : markerLayer(`${id}-icon`, data, style);

  if (sats.length) layers.push(dotLayer("live-tracks-sat", sats, "kind"));
  if (aircraft.length) layers.push(trackLayer("live-tracks-aircraft", aircraft, aircraftStyle));
  if (ships.length) layers.push(trackLayer("live-tracks-ship", ships, shipStyle));

  if (opts.labels) {
    const labelColor = (d: Track): RGB =>
      d.kind === "aircraft"
        ? colorFor(d, aircraftStyle.color)
        : d.kind === "ship"
          ? colorFor(d, shipStyle.color)
          : d.color ?? [255, 255, 255];
    const labelProps = {
      id: "live-track-labels",
      // Spatially thinned (one label per grid cell) so dense traffic stays
      // readable. We do this in JS rather than CollisionFilterExtension because
      // that extension's collision pass mis-culls under _GlobeView (labels
      // vanish entirely). SDF text + outline so it reads over any basemap.
      data: labelSubset(tracks),
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
