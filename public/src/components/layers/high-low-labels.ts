/**
 * Pressure H / L markers as label-canvas entries (see lib/high-low.ts for why
 * they no longer ride WeatherLayers' HighLowLayer). Computed once per decoded
 * texture and memoised on it, so a rebuild of the globe stack or a director
 * cut never re-scans the grid.
 *
 * Look matches the deck layer it replaces: WeatherLayers' 12px Helvetica Neue,
 * white on a dark outline, the letter centred on the centre and the rounded
 * hPa value directly beneath it.
 */
import type { OverlayLabel } from "../GlobeLabels";
import type { LoadedTexture } from "../../lib/textures";
import { findHighLows, type LngLatBounds } from "../../lib/high-low";
import type { PressureProps } from "./props";

export const HL_TYPE_FONT = '700 13px "Helvetica Neue", Arial, Helvetica, sans-serif';
export const HL_VALUE_FONT = '600 11px "Helvetica Neue", Arial, Helvetica, sans-serif';

const cache = new WeakMap<LoadedTexture, Map<string, OverlayLabel[]>>();

export function highLowOverlayLabels(tex: LoadedTexture, p: PressureProps["highLow"]): OverlayLabel[] {
  const key = `${p.radius}|${p.bounds.join(",")}|${p.imageUnscale?.join(",") ?? ""}`;
  let byKey = cache.get(tex);
  if (!byKey) {
    byKey = new Map();
    cache.set(tex, byKey);
  }
  const hit = byKey.get(key);
  if (hit) return hit;
  const points = findHighLows(
    { data: tex.data as ArrayLike<number>, width: tex.width, height: tex.height },
    p.bounds as LngLatBounds,
    p.imageUnscale,
    p.radius,
  );
  const labels: OverlayLabel[] = points.map((pt, i) => ({
    id: `hl:${pt.type}:${i}`,
    text: pt.type,
    detail: String(Math.round(pt.value)),
    position: [pt.position[0], pt.position[1], 0],
    color: [255, 255, 255],
    minZoom: 0,
    align: "center",
    font: HL_TYPE_FONT,
    detailStyle: "plain",
    detailFont: HL_VALUE_FONT,
  }));
  byKey.set(key, labels);
  return labels;
}
