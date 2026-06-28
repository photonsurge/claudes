import { ScatterplotLayer } from "@deck.gl/layers";
import type { Track } from "../../lib/tracks/types";

/**
 * One overlay layer for all live tracks (satellites/aircraft/ships). Coloured by
 * kind, sized a touch larger for satellites. depthTest on so the globe occludes
 * the far side. The page feeds positions; satellites carry true altitude so they
 * sit above the sphere.
 */
export function tracksLayer(tracks: Track[]) {
  return new ScatterplotLayer<Track>({
    id: "live-tracks",
    data: tracks,
    getPosition: (d) => d.position as [number, number, number],
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
  });
}
