/**
 * Main-thread side of high-low.worker.ts: one lazily created worker behind a
 * `find(img, bounds, unscale, radiusM)` promise API. Returns null where Workers
 * are unavailable (jsdom, old CEF); the caller then runs the scan itself.
 *
 * Own module because `new URL(..., import.meta.url)` is what Next bundles the
 * worker from — and what jest cannot parse, so the test config maps this file
 * to a null stub.
 */
import type { HighLowPoint, LngLatBounds, ScalarImage } from "./high-low";
import type { HighLowRequest, HighLowResponse } from "./high-low.worker";

type Pending = { resolve: (p: HighLowPoint[]) => void; reject: (e: Error) => void };
type Typed = Uint8Array | Uint8ClampedArray | Float32Array;

export type HighLowFinder = (
  img: ScalarImage,
  bounds: LngLatBounds,
  unscale: [number, number] | undefined,
  radiusM: number,
) => Promise<HighLowPoint[]>;

export function createHighLowFinder(): HighLowFinder | null {
  if (typeof Worker !== "function") return null;
  let worker: Worker;
  try {
    worker = new Worker(new URL("./high-low.worker.ts", import.meta.url));
  } catch {
    return null;
  }
  const pending = new Map<number, Pending>();
  let nextId = 1;
  worker.onmessage = (e: MessageEvent<HighLowResponse>) => {
    const msg = e.data;
    const p = pending.get(msg.id);
    if (!p) return;
    pending.delete(msg.id);
    if ("error" in msg) p.reject(new Error(msg.error));
    else p.resolve(msg.points);
  };
  worker.onerror = (ev) => {
    for (const [id, p] of pending) {
      pending.delete(id);
      p.reject(new Error(`high/low worker error: ${ev.message || "unknown"}`));
    }
  };
  return (img, bounds, unscale, radiusM) =>
    new Promise<HighLowPoint[]>((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      // The texture stays in use on the main thread (the isobars sample it), so
      // hand the worker a copy and transfer that copy's buffer.
      const data = (img.data as Typed).slice();
      const req: HighLowRequest = { id, data, width: img.width, height: img.height, bounds, unscale, radiusM };
      worker.postMessage(req, [data.buffer]);
    });
}
