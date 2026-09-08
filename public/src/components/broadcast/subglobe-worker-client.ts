"use client";

/**
 * Main-thread side of the SUB-GLOBE painter's Web Worker: the message
 * contract plus the factory. Isolated in its own module because
 * `import.meta.url` (how Next bundles a worker) can't be compiled by the
 * CommonJS test build — jest maps this module to a stub that returns null, so
 * the widget takes its main-thread fallback there.
 */
import type { SubGlobeCamera, SubGlobePalette } from "./subglobe-render";

export interface SubGlobeWorkerConfig {
  accent: string;
  tiltDeg: number;
  panDeg: number;
  palette: SubGlobePalette;
}

export type SubGlobeWorkerMessage =
  | { type: "init"; canvas: OffscreenCanvas; size: number; config: SubGlobeWorkerConfig }
  | { type: "config"; config: SubGlobeWorkerConfig }
  | { type: "paint"; cam: SubGlobeCamera };

/** A painter worker, or null where Workers / OffscreenCanvas aren't available. */
export function createSubGlobeWorker(): Worker | null {
  if (typeof Worker !== "function" || typeof OffscreenCanvas !== "function") return null;
  try {
    return new Worker(new URL("./subglobe.worker.ts", import.meta.url));
  } catch {
    return null;
  }
}
