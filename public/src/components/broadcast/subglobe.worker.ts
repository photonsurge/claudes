/**
 * SUB-GLOBE painter, off the main thread. SubGlobeWidget hands its canvas over
 * as an OffscreenCanvas and posts the chased camera every ~80 ms tick; this
 * worker fetches + simplifies the land once and paints each frame here.
 *
 * Why: during a world spin the locator repaints on every tick, and one paint
 * (a few thousand coastline vertices projected, horizon-clipped and filled)
 * measured ~7 ms on the OBS renderer's main thread — ~9 % of it at 12.5 Hz,
 * competing with deck.gl for the frame budget. On a worker it costs the page
 * nothing; the pixels land in the same <canvas>.
 */
import { drawSubGlobe, type SubGlobeCamera } from "./subglobe-render";
import { loadSubGlobeLand } from "./subglobe-land";
import type { Point } from "@photonsurge/shared/geo/simplify";
import type { SubGlobeWorkerConfig, SubGlobeWorkerMessage } from "./subglobe-worker-client";

let ctx: OffscreenCanvasRenderingContext2D | null = null;
let size = 0;
let land: readonly Point[][] = [];
let config: SubGlobeWorkerConfig | null = null;
let cam: SubGlobeCamera | null = null;

function paint() {
  if (!ctx || !config || !cam) return;
  // drawSubGlobe only uses the 2D API surface both context flavours share.
  drawSubGlobe(
    ctx as unknown as CanvasRenderingContext2D,
    size,
    cam,
    land,
    config.accent,
    config.tiltDeg,
    config.panDeg,
    config.palette,
  );
}

self.onmessage = (e: MessageEvent<SubGlobeWorkerMessage>) => {
  const m = e.data;
  if (m.type === "init") {
    ctx = m.canvas.getContext("2d");
    size = m.size;
    config = m.config;
    loadSubGlobeLand().then((rings) => {
      land = rings;
      paint();
    });
  } else if (m.type === "config") {
    config = m.config;
    paint();
  } else if (m.type === "paint") {
    cam = m.cam;
    paint();
  }
};
