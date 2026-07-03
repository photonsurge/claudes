import { ScatterplotLayer } from "@deck.gl/layers";
import type { Fire } from "@photonsurge/shared/fires/types";
import { DEPTH_TEST } from "./depth";

/**
 * Active-fire overlay (NASA FIRMS). Each detection is a glowing hot-spot: a soft
 * translucent halo under a bright core, coloured amber→red by fire radiative power
 * (FRP) and sized by it too, so intense wildfires read hotter and larger than
 * routine flares. Depth-tested like every globe layer so far-hemisphere fires are
 * occluded by the planet. Not pickable — there can be tens of thousands of points.
 */

/** FRP (MW) → colour. Cool amber for small fires, white-hot red for intense ones. */
export function fireColor(frp: number): [number, number, number] {
  if (frp >= 150) return [255, 70, 30];
  if (frp >= 50) return [255, 100, 25];
  if (frp >= 20) return [255, 140, 25];
  if (frp >= 8) return [255, 180, 40];
  return [255, 214, 90];
}

/** FRP (MW) → core radius in pixels (sqrt so huge fires don't dominate). */
const radiusPx = (frp: number): number => Math.max(2.2, Math.min(22, 2.2 + Math.sqrt(Math.max(0, frp)) * 0.9));

export function fireLayers(fires: Fire[]) {
  return [
    // Soft heat halo — larger, translucent, FRP-tinted.
    new ScatterplotLayer<Fire>({
      id: "fire-glow",
      data: fires,
      getPosition: (d) => [d.lng, d.lat, 0],
      getRadius: (d) => radiusPx(d.frp) * 2.4,
      getFillColor: (d) => [...fireColor(d.frp), 55] as [number, number, number, number],
      radiusUnits: "pixels",
      radiusMinPixels: 2,
      radiusMaxPixels: 90,
      stroked: false,
      pickable: false,
      parameters: DEPTH_TEST,
      updateTriggers: { getFillColor: fires.length, getRadius: fires.length },
    }),
    // Bright core — the fire itself.
    new ScatterplotLayer<Fire>({
      id: "fire-core",
      data: fires,
      getPosition: (d) => [d.lng, d.lat, 0],
      getRadius: (d) => radiusPx(d.frp),
      getFillColor: (d) => [...fireColor(d.frp), 235] as [number, number, number, number],
      radiusUnits: "pixels",
      radiusMinPixels: 1.4,
      radiusMaxPixels: 24,
      stroked: false,
      pickable: false,
      parameters: DEPTH_TEST,
      updateTriggers: { getFillColor: fires.length, getRadius: fires.length },
    }),
  ];
}
