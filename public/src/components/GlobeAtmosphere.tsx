"use client";

/**
 * Broadcast "beauty" chrome that hugs the globe's on-screen disc: a soft blue
 * atmospheric rim glow around the limb, plus a glowing pedestal ring the globe
 * sits on (the hologram-monitor look of the reference broadcast). Drawn on ONE
 * 2D canvas laid over the WebGL globe, `mix-blend-mode: screen` so it's
 * additive, pointer-inert, and captured by OBS like any page pixel.
 *
 * Why a canvas: the previous DOM/SVG version rotated a 120-tick SVG group via
 * its `transform` attribute every frame the globe turned (an SVG attribute
 * transform re-lays-out the SVG subtree in Blink), ran a SMIL `<animate>` for
 * the sweep (a style invalidation per frame), and resized two masked, blended
 * elements during every push-in — together the thing that left the /watch main
 * thread with a dirty layout on every frame, which the next DOM read then paid
 * for synchronously. A canvas repaint touches no style or layout at all.
 *
 * Position + size come from the live deck viewport each frame via `getDisc()`
 * (see lib/globe-geom): the disc centre + radius in CSS pixels.
 *
 * The pedestal is a flat, wide ellipse centred low on the globe. The globe disc
 * is punched out of it (destination-out), so the ellipse's BACK arc (inside the
 * disc) is hidden — it reads as passing behind the planet — while the front and
 * sides that extend below and around the globe stay visible. The rotating sweep
 * therefore appears to emerge from behind the globe, cross the front, and vanish
 * again. The rim glow is painted after the punch so it stays intact.
 */
import { useEffect, useRef } from "react";
import type { Disc } from "../lib/globe-geom";

/** Soft blue atmosphere: transparent core, bright band at the limb, fade to
 *  space. Stops are fractions of the glow radius (1.6·r); the disc edge sits at
 *  62.5% of it. Same numbers as the old CSS radial-gradient. */
const GLOW_RADIUS_MUL = 1.6;
const GLOW_STOPS: Array<[number, string]> = [
  [0.54, "rgba(0,0,0,0)"],
  [0.59, "rgba(78,140,225,0.10)"],
  [0.625, "rgba(126,190,255,0.34)"],
  [0.68, "rgba(96,160,240,0.14)"],
  [0.78, "rgba(70,130,220,0.05)"],
  [0.88, "rgba(0,0,0,0)"],
];

/** Pedestal ellipse geometry, in multiples of the globe radius r. */
const RING_W = 2.4; // full width
const RING_H = 0.72; // full height (flatness)
const RING_CY = 0.92; // centre drop below the globe centre (≈ the bottom limb)

/** Ruler graduations: total fine ticks around the ring, and how often a major
 *  (longer/brighter) tick lands. 120 ticks = one every 3°; major every 10 = 30°. */
const RING_TICK_COUNT = 120;
const RING_MAJOR_EVERY = 10;
/** Tick inner radii as a fraction of the ring radius (the SVG used 84/91 of 98). */
const TICK_IN_MAJOR = 84 / 98;
const TICK_IN_MINOR = 91 / 98;

/** Ring degrees turned per degree of globe longitude. 1 = locked 1:1 to the
 *  planet's spin so the ticks read as fixed meridian marks. Flip sign to reverse. */
const RING_SPIN_GAIN = 1;

/** Bright sweep travelling around the ring: one lap per period, covering this
 *  fraction of the circumference (the SVG dash was 13 of pathLength 100). */
const SWEEP_PERIOD_MS = 7000;
const SWEEP_FRACTION = 0.13;

/** Backing-store cap: 2× is crisp on any broadcast canvas; more is wasted fill. */
const MAX_DPR = 2;

/** Stroke an ellipse arc (screen space) — the ring, its glow and the sweep. */
function ellipseArc(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  a: number,
  b: number,
  from: number,
  to: number,
  width: number,
  style: string,
) {
  ctx.beginPath();
  ctx.ellipse(cx, cy, a, b, 0, from, to);
  ctx.lineWidth = width;
  ctx.strokeStyle = style;
  ctx.stroke();
}

export default function GlobeAtmosphere({
  getDisc,
  enabled,
}: {
  /** Reads the globe's on-screen disc + sub-camera longitude, or null if not ready. */
  getDisc: () => (Disc & { lng: number }) | null;
  enabled: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
  // Host size, kept current by a ResizeObserver so the per-frame tick never
  // reads clientWidth/Height (a layout-forcing read) itself.
  const sizeRef = useRef<{ w: number; h: number }>({ w: 0, h: 0 });

  useEffect(() => {
    if (!enabled) return;
    const host = hostRef.current;
    if (!host) return;
    sizeRef.current = { w: host.clientWidth, h: host.clientHeight };
    if (typeof ResizeObserver !== "function") return;
    const ro = new ResizeObserver((entries) => {
      const e = entries[entries.length - 1];
      if (e) sizeRef.current = { w: e.contentRect.width, h: e.contentRect.height };
    });
    ro.observe(host);
    return () => ro.disconnect();
  }, [enabled]);

  // Repaint every frame from the live disc (the sweep moves with the clock, so
  // there's always something to draw). No DOM style is ever written here.
  useEffect(() => {
    if (!enabled) return;
    let raf = 0;
    const loop = () => {
      // deck.gl can throw an internal assertion from getViewports()/project()
      // mid-transition (e.g. between view changes) — getDisc() isn't wrapped
      // itself, so guard here: an uncaught throw would otherwise skip the
      // reschedule below and permanently freeze this overlay for the session.
      try {
        tick();
      } catch {
        /* transient — try again next frame */
      }
      raf = requestAnimationFrame(loop);
    };
    const tick = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const { w, h } = sizeRef.current;
      if (!w || !h) return;
      const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
      const bw = Math.round(w * dpr);
      const bh = Math.round(h * dpr);
      if (canvas.width !== bw || canvas.height !== bh) {
        canvas.width = bw;
        canvas.height = bh;
        canvas.style.width = `${w}px`;
        canvas.style.height = `${h}px`;
      }
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const d = getDisc();
      if (!d) return;
      const { cx, cy, r } = d;

      // ── Pedestal ring ────────────────────────────────────────────────────
      const rcy = cy + r * RING_CY;
      const a = (r * RING_W) / 2;
      const b = (r * RING_H) / 2;
      ctx.lineCap = "butt";
      // Faint base ring: a wide soft halo standing in for the SVG's blur, then
      // the crisp line.
      ellipseArc(ctx, cx, rcy, a, b, 0, Math.PI * 2, 6, "rgba(120,190,255,0.09)");
      ellipseArc(ctx, cx, rcy, a, b, 0, Math.PI * 2, 2, "rgba(120,190,255,0.22)");
      ellipseArc(ctx, cx, rcy, a, b, 0, Math.PI * 2, 1, "rgba(160,210,255,0.35)");

      // Coordinate / ruler graduations: radial ticks around the ring — a fine
      // mark every 3°, a longer + brighter major mark every 30° — rotating in
      // lock-step with the globe's longitude so they read as meridian marks
      // fixed to the planet, not a static frame.
      const rot = (d.lng * RING_SPIN_GAIN * Math.PI) / 180;
      ctx.beginPath();
      ctx.lineWidth = 0.9;
      ctx.strokeStyle = "rgba(150,205,255,0.42)";
      for (let i = 0; i < RING_TICK_COUNT; i++) {
        if (i % RING_MAJOR_EVERY === 0) continue;
        const t = (i / RING_TICK_COUNT) * Math.PI * 2 + rot;
        const c = Math.cos(t);
        const s = Math.sin(t);
        ctx.moveTo(cx + a * TICK_IN_MINOR * c, rcy + b * TICK_IN_MINOR * s);
        ctx.lineTo(cx + a * c, rcy + b * s);
      }
      ctx.stroke();
      ctx.beginPath();
      ctx.lineWidth = 1.6;
      ctx.strokeStyle = "rgba(195,228,255,0.85)";
      for (let i = 0; i < RING_TICK_COUNT; i += RING_MAJOR_EVERY) {
        const t = (i / RING_TICK_COUNT) * Math.PI * 2 + rot;
        const c = Math.cos(t);
        const s = Math.sin(t);
        ctx.moveTo(cx + a * TICK_IN_MAJOR * c, rcy + b * TICK_IN_MAJOR * s);
        ctx.lineTo(cx + a * c, rcy + b * s);
      }
      ctx.stroke();

      // Bright sweep travelling around the ring (emerges from behind the globe).
      const phase = (Date.now() % SWEEP_PERIOD_MS) / SWEEP_PERIOD_MS;
      const from = phase * Math.PI * 2;
      const to = from + SWEEP_FRACTION * Math.PI * 2;
      ctx.lineCap = "round";
      ellipseArc(ctx, cx, rcy, a, b, from, to, 7, "rgba(190,225,255,0.22)");
      ellipseArc(ctx, cx, rcy, a, b, from, to, 2.2, "rgba(190,225,255,0.95)");

      // Punch the globe disc out of the ring so its back arc hides behind the
      // planet (soft-edged, like the old radial-gradient mask).
      ctx.globalCompositeOperation = "destination-out";
      const hole = ctx.createRadialGradient(cx, cy, Math.max(0, r - 3), cx, cy, r + 6);
      hole.addColorStop(0, "rgba(0,0,0,1)");
      hole.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = hole;
      ctx.beginPath();
      ctx.arc(cx, cy, r + 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalCompositeOperation = "source-over";

      // ── Atmospheric rim glow around the limb (on top, unmasked) ──────────
      const gr = r * GLOW_RADIUS_MUL;
      const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, gr);
      for (const [stop, color] of GLOW_STOPS) glow.addColorStop(stop, color);
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(cx, cy, gr, 0, Math.PI * 2);
      ctx.fill();
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [enabled, getDisc]);

  if (!enabled) return null;

  return (
    <div
      ref={hostRef}
      style={{ position: "absolute", inset: 0, pointerEvents: "none", overflow: "hidden", zIndex: 1 }}
    >
      <canvas
        ref={canvasRef}
        style={{ position: "absolute", left: 0, top: 0, mixBlendMode: "screen" }}
      />
    </div>
  );
}
