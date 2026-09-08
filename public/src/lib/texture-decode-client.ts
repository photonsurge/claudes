/**
 * Main-thread side of texture-decode.worker.ts: a small pool of decode
 * workers behind one `decode(url)` promise API. Returns null where Workers or
 * OffscreenCanvas are unavailable (jsdom, old CEF), in which case textures.ts
 * falls back to WeatherLayers' main-thread loader.
 *
 * Kept in its own module because `new URL(..., import.meta.url)` is what Next
 * bundles the worker from — and what jest cannot parse, so the test config
 * maps this file to a null stub.
 */
import type { TextureData } from "weatherlayers-gl";
import type { TextureDecodeRequest, TextureDecodeResponse } from "./texture-decode.worker";

/** Two workers: enough to overlap a nest's decode with the next fetch. */
const POOL_SIZE = 2;

type Pending = { resolve: (t: TextureData) => void; reject: (e: Error) => void };

export type TextureDecoder = (url: string) => Promise<TextureData>;

export function createTextureDecoder(): TextureDecoder | null {
  if (
    typeof Worker !== "function" ||
    typeof OffscreenCanvas !== "function" ||
    typeof createImageBitmap !== "function"
  ) {
    return null;
  }
  let workers: Worker[];
  try {
    workers = Array.from(
      { length: POOL_SIZE },
      () => new Worker(new URL("./texture-decode.worker.ts", import.meta.url)),
    );
  } catch {
    return null;
  }
  const pending = new Map<number, Pending>();
  let nextId = 1;
  let rr = 0;
  for (const w of workers) {
    w.onmessage = (e: MessageEvent<TextureDecodeResponse>) => {
      const msg = e.data;
      const p = pending.get(msg.id);
      if (!p) return;
      pending.delete(msg.id);
      if ("error" in msg) p.reject(new Error(msg.error));
      else p.resolve({ data: new Uint8ClampedArray(msg.data), width: msg.width, height: msg.height } as TextureData);
    };
    w.onerror = (ev) => {
      // A crashed worker fails everything queued on it; callers retry through
      // the cache's "drop on failure" path.
      for (const [id, p] of pending) {
        pending.delete(id);
        p.reject(new Error(`texture decode worker error: ${ev.message || "unknown"}`));
      }
    };
  }
  return (url) =>
    new Promise<TextureData>((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      const req: TextureDecodeRequest = { id, url };
      workers[rr++ % workers.length].postMessage(req);
    });
}
