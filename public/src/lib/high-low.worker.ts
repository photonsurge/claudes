/**
 * Pressure H / L worker: runs lib/high-low.ts' scan off the main thread. The
 * scan is a blur + neighbourhood pass over the whole decoded grid — a few
 * hundred milliseconds even after the fold onto the search grid — and it used to
 * run synchronously inside Globe's render, freezing the broadcast for as long
 * as it took every time the pressure texture changed (round 18).
 */
import { findHighLows, type HighLowPoint, type LngLatBounds } from "./high-low";

export type HighLowRequest = {
  id: number;
  data: ArrayLike<number>;
  width: number;
  height: number;
  bounds: LngLatBounds;
  unscale?: [number, number];
  radiusM: number;
};
export type HighLowResponse = { id: number; points: HighLowPoint[] } | { id: number; error: string };

const ctx = self as unknown as {
  onmessage: ((e: MessageEvent<HighLowRequest>) => void) | null;
  postMessage(msg: HighLowResponse): void;
};

ctx.onmessage = (e) => {
  const m = e.data;
  try {
    const points = findHighLows({ data: m.data, width: m.width, height: m.height }, m.bounds, m.unscale, m.radiusM);
    ctx.postMessage({ id: m.id, points });
  } catch (err) {
    ctx.postMessage({ id: m.id, error: err instanceof Error ? err.message : String(err) });
  }
};
