"use client";

/**
 * "SUB-GLOBE" — the little always-on locator planet: a true orthographic
 * hemisphere centred on where the main globe is parked, with a theme-coloured
 * reticle whose ring tightens as the shot pushes in. It lives INSIDE the
 * G.O.D.S. masthead now — BrandPanel sinks it behind GodsBanner's liveCore
 * hole so the banner's rings/ellipse read as its bezel (the old bottom-left
 * corner mount is gone; that space is reserved for sponsor placements).
 *
 * It deliberately does NOT track the live per-frame camera (that never leaves
 * Globe.tsx's rAF loop). It follows the camera ANCHOR (`ControlState.camera`)
 * — the one field that moves exactly when the director cuts / a tour parks on
 * a new stop — and swings there along the great circle with an exponential
 * chase, so a cut reads as a smooth little swing and a hold sits still. A
 * world spin is reproduced deterministically from spinSpeed/spinEpoch (the
 * same arithmetic Globe.tsx runs), so the planet slowly turns in phase with
 * the broadcast without any camera feed.
 *
 * All motion is imperative (refs + canvas + textContent) on a ~12fps interval
 * — nothing here re-renders React per tick.
 */
import { useEffect, useRef, useState } from "react";
import type { Point } from "@photonsurge/shared/geo/simplify";
import { DEFAULT_THEME, type BroadcastTheme } from "./config";
import { loadSubGlobeLand } from "./subglobe-land";
import { createSubGlobeWorker, type SubGlobeWorkerMessage } from "./subglobe-worker-client";
import {
  angularDistanceDeg,
  drawSubGlobe,
  formatLonLat,
  slerpLonLat,
  spinLongitude,
  wrapLng,
  type LonLat,
  type SubGlobeCamera,
  type SubGlobePalette,
} from "./subglobe-render";

/** ~12fps: a locator, not a game — invisible at this size, negligible CPU. */
const TICK_MS = 80;
/** Exponential-chase time constant: ~95% of a swing lands in ~1.3s, matching
 *  the feel of a director cut without tracking its exact easing. */
const CHASE_TAU_MS = 450;
/** Below this the chase snaps — avoids an endless asymptotic dribble. */
const SETTLE_DEG = 0.05;

export default function SubGlobeWidget({
  center,
  zoom,
  autoSpin = false,
  spinSpeed = 0,
  spinEpoch = 0,
  accent,
  theme = DEFAULT_THEME,
  size = 300,
  tiltDeg = 0,
  panDeg = 0,
  showReadout = true,
  onPosition,
}: {
  /** Camera anchor (ControlState.camera.center) — [lng, lat]. */
  center: [number, number];
  zoom: number;
  autoSpin?: boolean;
  spinSpeed?: number;
  spinEpoch?: number;
  /** Optional reticle override; defaults to the scene theme's minimap accent. */
  accent?: string;
  theme?: BroadcastTheme;
  /** Planet diameter in 1080p design px. */
  size?: number;
  /** Tip the viewpoint this many degrees SOUTH of the camera point, so the
   *  (still-correct) marked location renders above the disc centre — pairs
   *  with the mount sinking the disc off the stage bottom. */
  tiltDeg?: number;
  /** Tip the viewpoint this many degrees WEST, so the mark renders to the
   *  RIGHT of the disc centre — pairs with the mount clipping the left edge. */
  panDeg?: number;
  /** Hide the lon/lat readout line — canvas only (the in-logo variant). */
  showReadout?: boolean;
  /** Called with the position the planet is ACTUALLY showing on every repaint
   *  (≤12.5 Hz, nothing while parked) — the masthead's live LAT/LON/LOC readout
   *  rides this. Keep the handler cheap and non-rendering; it runs on the tick,
   *  not in React. */
  onPosition?: (lng: number, lat: number) => void;
}) {
  const reticle = accent ?? theme.minimapAccentColor;
  const palette: SubGlobePalette = {
    oceanInner: theme.minimapOceanInnerColor,
    oceanOuter: theme.minimapOceanOuterColor,
    land: theme.minimapLandColor,
    landEdge: theme.minimapLandEdgeColor,
    grid: theme.minimapGridColor,
    limb: theme.minimapLimbColor,
  };
  // Fixed 2× backing store — crisp through the 1080p stage scale on a 4K out.
  const canvasPx = size * 2;
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const readoutRef = useRef<HTMLDivElement | null>(null);
  const [land, setLand] = useState<readonly Point[][] | null>(null);

  // Where the planet is currently pointed (imperative — never React state).
  const shownRef = useRef<SubGlobeCamera>({ lng: wrapLng(center[0]), lat: center[1], zoom });
  // Fresh props for the tick without re-subscribing the interval.
  const propsRef = useRef({ center, zoom, autoSpin, spinSpeed, spinEpoch, reticle, land, tiltDeg, panDeg, palette, onPosition });
  propsRef.current = { center, zoom, autoSpin, spinSpeed, spinEpoch, reticle, land, tiltDeg, panDeg, palette, onPosition };

  // Off-main-thread painter: hand the canvas to a Worker (OffscreenCanvas) so a
  // repaint — ~7 ms of coastline projection during a world spin, every tick —
  // never touches the page's main thread. Falls back to painting here when
  // Workers/OffscreenCanvas are unavailable (jsdom, old CEF). A transferred
  // canvas can't be transferred twice, so the <canvas> is keyed on its size and
  // remounts (with a fresh worker) if that ever changes.
  const workerRef = useRef<Worker | null>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || typeof canvas.transferControlToOffscreen !== "function") return;
    const worker = createSubGlobeWorker();
    if (!worker) return;
    const offscreen = canvas.transferControlToOffscreen();
    const p = propsRef.current;
    const init: SubGlobeWorkerMessage = {
      type: "init",
      canvas: offscreen,
      size: canvasPx,
      config: { accent: p.reticle, tiltDeg: p.tiltDeg, panDeg: p.panDeg, palette: p.palette },
    };
    worker.postMessage(init, [offscreen]);
    workerRef.current = worker;
    return () => {
      worker.terminate();
      workerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvasPx]);

  useEffect(() => {
    if (workerRef.current) return; // the worker fetches its own land
    let alive = true;
    loadSubGlobeLand().then((rings) => {
      if (alive) setLand(rings);
    });
    return () => {
      alive = false;
    };
  }, []);

  // One immediate paint per (land, palette/accent) so the corner is never blank
  // between the mount and the first tick.
  useEffect(() => {
    const worker = workerRef.current;
    if (worker) {
      const p = propsRef.current;
      const msg: SubGlobeWorkerMessage = {
        type: "config",
        config: { accent: p.reticle, tiltDeg: p.tiltDeg, panDeg: p.panDeg, palette: p.palette },
      };
      worker.postMessage(msg);
    }
    paint();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    land,
    reticle,
    tiltDeg,
    panDeg,
    palette.oceanInner,
    palette.oceanOuter,
    palette.land,
    palette.landEdge,
    palette.grid,
    palette.limb,
  ]);

  function paint() {
    const p = propsRef.current;
    const worker = workerRef.current;
    if (worker) {
      const msg: SubGlobeWorkerMessage = { type: "paint", cam: { ...shownRef.current } };
      worker.postMessage(msg);
    } else {
      const canvas = canvasRef.current;
      const g = canvas?.getContext("2d");
      if (canvas && g) {
        // jsdom / lost context → no frame, but the readout still renders.
        drawSubGlobe(g, canvasPx, shownRef.current, p.land ?? [], p.reticle, p.tiltDeg, p.panDeg, p.palette);
      }
    }
    if (readoutRef.current) {
      readoutRef.current.textContent = formatLonLat(shownRef.current.lng, shownRef.current.lat);
    }
    p.onPosition?.(shownRef.current.lng, shownRef.current.lat);
  }

  useEffect(() => {
    let last = Date.now();
    const tick = () => {
      const now = Date.now();
      const dt = now - last;
      last = now;
      const p = propsRef.current;
      // Target = anchor, plus the deterministic world-spin longitude when one
      // is running (Globe.tsx's own formula — no live camera feed needed).
      const targetLng = p.autoSpin
        ? spinLongitude(p.center[0], p.spinSpeed, p.spinEpoch, now)
        : wrapLng(p.center[0]);
      const target: LonLat = [targetLng, p.center[1]];
      const shown = shownRef.current;
      const from: LonLat = [shown.lng, shown.lat];
      const gap = angularDistanceDeg(from, target);
      const zoomGap = Math.abs(p.zoom - shown.zoom);
      if (gap < SETTLE_DEG && zoomGap < 0.01) {
        if (gap === 0 && zoomGap === 0) return; // parked — skip the repaint
        shownRef.current = { lng: target[0], lat: target[1], zoom: p.zoom };
      } else {
        // Exponential great-circle chase: a cut swings over in ~1.3s, a spin
        // trails the moving target by an imperceptible constant lag.
        const alpha = 1 - Math.exp(-dt / CHASE_TAU_MS);
        const [lng, lat] = slerpLonLat(from, target, alpha);
        shownRef.current = { lng, lat, zoom: shown.zoom + (p.zoom - shown.zoom) * alpha };
      }
      paint();
    };
    const iv = setInterval(tick, TICK_MS);
    tick();
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, pointerEvents: "none" }}>
      {showReadout && (
        <div
          ref={readoutRef}
          style={{
            fontSize: 12.5,
            fontWeight: 700,
            letterSpacing: 1.6,
            color: theme.mutedColor,
            fontVariantNumeric: "tabular-nums",
            // Bare text over the map, like the syslog lines beneath it.
            textShadow: "0 1px 3px rgba(0,0,0,0.9)",
          }}
        >
          {formatLonLat(shownRef.current.lng, shownRef.current.lat)}
        </div>
      )}
      <canvas
        key={canvasPx}
        ref={canvasRef}
        width={canvasPx}
        height={canvasPx}
        style={{ width: size, height: size, display: "block" }}
      />
    </div>
  );
}
