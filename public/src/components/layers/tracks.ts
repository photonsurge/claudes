import { ScatterplotLayer, PathLayer, TextLayer } from "@deck.gl/layers";
import { CollisionFilterExtension } from "@deck.gl/extensions";
import type { Track } from "../../lib/tracks/types";
import type { OrbitSegment } from "../../lib/tracks/orbit";
import type { TrackPath } from "../../lib/tracks/client";

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
export function tracksLayer(tracks: Track[], opts: { labels?: boolean } = {}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const layers: any[] = [
    new ScatterplotLayer<Track>({
      id: "live-tracks",
      data: tracks,
      getPosition: trackPosition,
      getFillColor: (d) => d.color ?? [255, 255, 255],
      getRadius: (d) => (d.kind === "satellite" ? 3 : 2),
      radiusUnits: "pixels",
      radiusMinPixels: 1.5,
      radiusMaxPixels: 6,
      stroked: false,
      pickable: true,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      parameters: { depthTest: true } as any,
      updateTriggers: { getFillColor: tracks.length },
    }),
  ];

  if (opts.labels) {
    // Extension props (collision*) aren't on TextLayer's typed props, so build
    // the config loosely and cast.
    const labelProps = {
      id: "live-track-labels",
      data: tracks.filter((t) => t.name),
      getPosition: trackPosition,
      getText: (d: Track) => d.name ?? "",
      getColor: (d: Track) => [...(d.color ?? [255, 255, 255]), 230],
      getSize: 11,
      sizeUnits: "pixels",
      getPixelOffset: [8, 0],
      getTextAnchor: "start",
      getAlignmentBaseline: "center",
      fontFamily: "system-ui, sans-serif",
      outlineWidth: 2,
      outlineColor: [0, 0, 0, 200],
      fontSettings: { sdf: true },
      // Hide overlapping labels; more appear as you zoom in.
      extensions: [new CollisionFilterExtension()],
      collisionTestProps: { sizeScale: 2 },
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
