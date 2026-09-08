/**
 * Pressure H / L markers as label-canvas entries (see lib/high-low.ts for why
 * they no longer ride WeatherLayers' HighLowLayer). The scan runs ONCE per
 * decoded texture, in a Web Worker: on a fine bake it is seconds of blur and
 * neighbourhood passes, and it used to run synchronously inside Globe's render
 * — a 2.4 s frozen frame on air every time the pressure texture changed, at
 * least once a forecast hour (docs/watch-perf-plan.md, round 18). Results are
 * memoised on the texture; `useHighLowLabels` hands them back synchronously
 * once known and re-renders exactly once when a fresh texture's scan lands, so
 * the letters follow the isobars by a beat instead of stalling the frame.
 *
 * Look matches the deck layer it replaced: WeatherLayers' 12px Helvetica Neue,
 * white on a dark outline, the letter centred on the centre and the rounded
 * hPa value directly beneath it.
 */
import { useEffect, useReducer, useRef } from "react";
import type { OverlayLabel } from "../GlobeLabels";
import type { LoadedTexture } from "../../lib/textures";
import { findHighLows, type HighLowPoint, type LngLatBounds, type ScalarImage } from "../../lib/high-low";
import { createHighLowFinder, type HighLowFinder } from "../../lib/high-low-client";
import type { PressureProps } from "./props";

export const HL_TYPE_FONT = '700 13px "Helvetica Neue", Arial, Helvetica, sans-serif';
export const HL_VALUE_FONT = '600 11px "Helvetica Neue", Arial, Helvetica, sans-serif';

/** What the scan reads of `PressureProps["highLow"]`: the search radius, the texture's bounds and byte scale. */
export type HighLowSpec = Pick<PressureProps["highLow"], "radius" | "bounds" | "imageUnscale">;
type HL = HighLowSpec;

const ready = new WeakMap<LoadedTexture, Map<string, OverlayLabel[]>>();
const inflight = new WeakMap<LoadedTexture, Map<string, Promise<OverlayLabel[]>>>();
/** undefined = not tried yet; null = no Worker here (scan on this thread, still off the render). */
let finder: HighLowFinder | null | undefined;

function keyOf(p: HL): string {
  return `${p.radius}|${p.bounds.join(",")}|${p.imageUnscale?.join(",") ?? ""}`;
}

/** No-Worker fallback: the same scan, deferred out of the render that asked for it. */
const findDeferred: HighLowFinder = (img, bounds, unscale, radiusM) =>
  new Promise((resolve, reject) => {
    setTimeout(() => {
      try {
        resolve(findHighLows(img, bounds, unscale, radiusM));
      } catch (err) {
        reject(err);
      }
    }, 0);
  });

export function toHighLowLabels(points: HighLowPoint[]): OverlayLabel[] {
  return points.map((pt, i) => ({
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
}

/** This texture's labels if its scan has finished, else null. */
export function highLowLabelsReady(tex: LoadedTexture, p: HL): OverlayLabel[] | null {
  return ready.get(tex)?.get(keyOf(p)) ?? null;
}

/** Start (or join) the scan for this texture; resolves to its labels. */
export function highLowLabelsFor(tex: LoadedTexture, p: HL): Promise<OverlayLabel[]> {
  const key = keyOf(p);
  const done = ready.get(tex)?.get(key);
  if (done) return Promise.resolve(done);
  let byKey = inflight.get(tex);
  if (!byKey) {
    byKey = new Map();
    inflight.set(tex, byKey);
  }
  const running = byKey.get(key);
  if (running) return running;
  if (finder === undefined) finder = createHighLowFinder();
  const img: ScalarImage = { data: tex.data as ArrayLike<number>, width: tex.width, height: tex.height };
  const pendingByKey = byKey;
  const run = (finder ?? findDeferred)(img, p.bounds as LngLatBounds, p.imageUnscale, p.radius)
    .then((points) => {
      const labels = toHighLowLabels(points);
      let r = ready.get(tex);
      if (!r) {
        r = new Map();
        ready.set(tex, r);
      }
      r.set(key, labels);
      return labels;
    })
    .finally(() => {
      pendingByKey.delete(key);
    });
  byKey.set(key, run);
  return run;
}

const NONE: OverlayLabel[] = [];

/**
 * The H / L labels for `tex` (the pressure texture on screen): the memoised
 * result when known, otherwise `[]` while the worker scans, then one re-render.
 */
export function useHighLowLabels(tex: LoadedTexture | undefined, p: HL | null): OverlayLabel[] {
  const [, bump] = useReducer((n: number) => n + 1, 0);
  const labels = tex && p ? highLowLabelsReady(tex, p) : null;
  const key = p ? keyOf(p) : "";
  // `p` is rebuilt by the caller's memo; the effect keys on its content (`key`).
  const specRef = useRef(p);
  specRef.current = p;
  useEffect(() => {
    const spec = specRef.current;
    if (!tex || !spec || labels) return;
    let live = true;
    highLowLabelsFor(tex, spec).then(
      () => {
        if (live) bump();
      },
      (err) => console.warn("[globe] pressure H/L scan failed", err),
    );
    return () => {
      live = false;
    };
  }, [tex, key, labels]);
  return labels ?? NONE;
}
