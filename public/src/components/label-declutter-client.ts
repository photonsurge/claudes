/**
 * Main-thread side of label-declutter.worker.ts: post the index when it
 * changes, post each frame's camera, take the latest decision back. One
 * request in flight at a time; a frame with a busy worker keeps the decision
 * it has. Returns null where Workers are unavailable (jsdom, old CEF) — the
 * caller then declutters inline.
 *
 * Own module because `new URL(..., import.meta.url)` is what Next bundles the
 * worker from — and what jest cannot parse, so the test config maps this file
 * to a null stub.
 */
import type { Decision, FrameParams, LabelIndexData } from "./label-declutter";
import type { DeclutterRequest, DeclutterResponse } from "./label-declutter.worker";

export interface Declutterer {
  setIndex(gen: number, data: LabelIndexData): void;
  request(gen: number, frame: FrameParams): void;
  /** The most recent decision received (with its label generation), if any. */
  take(): DeclutterResponse | null;
  readonly busy: boolean;
  destroy(): void;
}

export type { Decision };

export function createDeclutterer(): Declutterer | null {
  if (typeof Worker !== "function") return null;
  let worker: Worker;
  try {
    worker = new Worker(new URL("./label-declutter.worker.ts", import.meta.url));
  } catch {
    return null;
  }
  let latest: DeclutterResponse | null = null;
  let inflight = false;
  let dead = false;
  worker.onmessage = (e: MessageEvent<DeclutterResponse>) => {
    inflight = false;
    latest = e.data;
  };
  worker.onerror = () => {
    // A crashed worker: never busy, never a decision → the caller declutters inline from here on.
    dead = true;
    inflight = false;
    latest = null;
  };
  const post = (msg: DeclutterRequest) => worker.postMessage(msg);
  return {
    setIndex(gen, data) {
      if (dead) return;
      latest = null;
      post({ type: "index", gen, data });
    },
    request(gen, frame) {
      if (dead || inflight) return;
      inflight = true;
      // A plain array for the matrix: deck's may be a view over a larger buffer.
      post({ type: "frame", gen, frame: { ...frame, m: frame.m ? Array.from(frame.m) : null } });
    },
    take: () => latest,
    get busy() {
      return inflight;
    },
    destroy() {
      dead = true;
      worker.terminate();
    },
  };
}
