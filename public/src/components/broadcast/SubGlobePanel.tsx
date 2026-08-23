"use client";

/**
 * "SUB-GLOBE" — the little locator planet in the left-column deck: a true
 * orthographic hemisphere centred on where the main globe is parked, with a
 * kind-accent reticle whose ring tightens as the shot pushes in.
 *
 * It deliberately does NOT track the live per-frame camera (that never leaves
 * Globe.tsx's rAF loop). It follows the camera ANCHOR (`ControlState.camera`) —
 * the one field that moves exactly when the director cuts / a tour parks on a
 * new stop — and swings there along the great circle with an exponential
 * chase, so a cut reads as a smooth little swing and a hold sits still. A
 * world spin is reproduced deterministically from spinSpeed/spinEpoch (the
 * same arithmetic Globe.tsx runs), so the planet slowly turns in phase with
 * the broadcast without any camera feed.
 *
 * All motion is imperative (refs + canvas + textContent) on a ~12fps interval
 * that only runs while this is the deck's active slide (DeckSlideActiveContext
 * — every slide stays mounted), so an off-screen slide costs nothing and
 * nothing here ever re-renders React per tick.
 */
import { useContext, useEffect, useRef, useState } from "react";
import type { Point } from "@photonsurge/shared/geo/simplify";
import BroadcastCard, { DeckSlideActiveContext } from "./BroadcastCard";
import { useBroadcastTheme } from "./theme-context";
import type { BroadcastTheme } from "./config";
import { loadSubGlobeLand } from "./subglobe-land";
import {
  angularDistanceDeg,
  drawSubGlobe,
  formatLonLat,
  slerpLonLat,
  spinLongitude,
  wrapLng,
  type LonLat,
  type SubGlobeCamera,
} from "./subglobe-render";

/** CSS square the planet paints into (card body is CARD_W − 2×20 = 380). */
const VIEW_PX = 360;
/** Fixed 2× backing store — crisp through the 1080p stage scale on a 4K out. */
const CANVAS_PX = VIEW_PX * 2;
/** ~12fps: a locator, not a game — invisible at this size, negligible CPU. */
const TICK_MS = 80;
/** Exponential-chase time constant: ~95% of a swing lands in ~1.3s, matching
 *  the feel of a director cut without tracking its exact easing. */
const CHASE_TAU_MS = 450;
/** Below this the chase snaps — avoids an endless asymptotic dribble. */
const SETTLE_DEG = 0.05;

export default function SubGlobePanel({
  center,
  zoom,
  autoSpin = false,
  spinSpeed = 0,
  spinEpoch = 0,
  color,
  theme: propTheme,
}: {
  /** Camera anchor (ControlState.camera.center) — [lng, lat]. */
  center: [number, number];
  zoom: number;
  autoSpin?: boolean;
  spinSpeed?: number;
  spinEpoch?: number;
  /** On-air kind accent — the reticle colour. */
  color?: string;
  theme?: BroadcastTheme;
}) {
  const theme = useBroadcastTheme(propTheme);
  const active = useContext(DeckSlideActiveContext);
  const accent = color ?? theme.accent;
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const readoutRef = useRef<HTMLDivElement | null>(null);
  const [land, setLand] = useState<readonly Point[][] | null>(null);

  // Where the sub-globe is currently pointed (imperative — never React state).
  const shownRef = useRef<SubGlobeCamera>({ lng: wrapLng(center[0]), lat: center[1], zoom });
  // Fresh props for the tick without re-subscribing the interval.
  const propsRef = useRef({ center, zoom, autoSpin, spinSpeed, spinEpoch, accent, land });
  propsRef.current = { center, zoom, autoSpin, spinSpeed, spinEpoch, accent, land };

  useEffect(() => {
    let alive = true;
    loadSubGlobeLand().then((rings) => {
      if (alive) setLand(rings);
    });
    return () => {
      alive = false;
    };
  }, []);

  // One immediate paint per (land, accent) so the slide is never blank while it
  // fades in — the tick loop below only runs while the slide is on air.
  useEffect(() => {
    paint();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [land, accent]);

  function paint() {
    const canvas = canvasRef.current;
    const g = canvas?.getContext("2d");
    if (!canvas || !g) return; // jsdom / lost context — card still renders
    const p = propsRef.current;
    drawSubGlobe(g, CANVAS_PX, shownRef.current, p.land ?? [], p.accent);
    if (readoutRef.current) {
      readoutRef.current.textContent = formatLonLat(shownRef.current.lng, shownRef.current.lat);
    }
  }

  useEffect(() => {
    if (!active) return;
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
  }, [active]);

  return (
    <BroadcastCard eyebrow="SUB-GLOBE" accent={accent} theme={theme}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
        <canvas
          ref={canvasRef}
          width={CANVAS_PX}
          height={CANVAS_PX}
          style={{ width: VIEW_PX, height: VIEW_PX, display: "block" }}
        />
        <div
          ref={readoutRef}
          style={{
            fontSize: 13.5,
            fontWeight: 700,
            letterSpacing: 1.6,
            color: theme.mutedColor,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {formatLonLat(shownRef.current.lng, shownRef.current.lat)}
        </div>
      </div>
    </BroadcastCard>
  );
}
