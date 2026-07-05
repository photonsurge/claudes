"use client";

/**
 * Broadcast "beauty" chrome that hugs the globe's on-screen disc: a soft blue
 * atmospheric rim glow around the limb, plus a glowing pedestal ring the globe
 * sits on (the hologram-monitor look of the reference broadcast). Both are pure
 * DOM/CSS/SVG — GPU-composited, additive (`mix-blend-mode: screen`), and
 * pointer-inert, so they never touch the WebGL pipeline or eat globe clicks.
 *
 * Position + size come from the live deck viewport each frame via `getDisc()`
 * (see lib/globe-geom): the disc centre + radius in CSS pixels, written to the
 * element styles imperatively in a rAF so tracking spin/zoom never re-renders.
 *
 * The pedestal is a flat, wide ellipse centred low on the globe. Its container is
 * masked by a radial hole matching the globe disc, so the ellipse's BACK arc
 * (inside the disc) is hidden — it reads as passing behind the planet — while the
 * front/sides that extend below and around the globe stay visible. The rotating
 * sweep therefore appears to emerge from behind the globe, cross the front, and
 * vanish again.
 */
import { useEffect, useRef } from "react";
import type { Disc } from "../lib/globe-geom";

/** Soft blue atmosphere: transparent core, bright band at the limb, fade to space.
 *  The disc edge sits at 62.5% of this element's half-size (element = 3.2·r). */
const GLOW_GRADIENT = `radial-gradient(circle at center,
  rgba(0,0,0,0) 54%,
  rgba(78,140,225,0.10) 59%,
  rgba(126,190,255,0.34) 62.5%,
  rgba(96,160,240,0.14) 68%,
  rgba(70,130,220,0.05) 78%,
  rgba(0,0,0,0) 88%)`;

/** Pedestal ellipse geometry, in multiples of the globe radius r. */
const RING_W = 2.4; // full width
const RING_H = 0.72; // full height (flatness)
const RING_CY = 0.92; // centre drop below the globe centre (≈ the bottom limb)

/** Ruler graduations: total fine ticks around the ring, and how often a major
 *  (longer/brighter) tick lands. 120 ticks = one every 3°; major every 10 = 30°. */
const RING_TICK_COUNT = 120;
const RING_MAJOR_EVERY = 10;

/** Ring degrees turned per degree of globe longitude. 1 = locked 1:1 to the
 *  planet's spin so the ticks read as fixed meridian marks. Flip sign to reverse. */
const RING_SPIN_GAIN = 1;

export default function GlobeAtmosphere({
  getDisc,
  enabled,
}: {
  /** Reads the globe's on-screen disc + sub-camera longitude, or null if not ready. */
  getDisc: () => (Disc & { lng: number }) | null;
  enabled: boolean;
}) {
  const glowRef = useRef<HTMLDivElement | null>(null);
  const ringRef = useRef<HTMLDivElement | null>(null);
  const tickGroupRef = useRef<SVGGElement | null>(null);

  // Track the disc every frame, writing styles imperatively (no React churn).
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
      const d = getDisc();
      if (d) {
        const glow = glowRef.current;
        if (glow) {
          const size = d.r * 3.2;
          glow.style.width = `${size}px`;
          glow.style.height = `${size}px`;
          glow.style.left = `${d.cx}px`;
          glow.style.top = `${d.cy}px`;
        }
        const ring = ringRef.current;
        if (ring) {
          const w = d.r * RING_W;
          const h = d.r * RING_H;
          ring.style.width = `${w}px`;
          ring.style.height = `${h}px`;
          ring.style.left = `${d.cx}px`;
          ring.style.top = `${d.cy + d.r * RING_CY}px`;
          // Punch a hole where the globe disc is, so the ellipse's back arc hides
          // behind the planet. Hole centre is the globe centre expressed in the
          // (translate -50%,-50%) container's own coordinates.
          const mx = w / 2;
          const my = h / 2 - d.r * RING_CY;
          const mask = `radial-gradient(circle at ${mx.toFixed(1)}px ${my.toFixed(1)}px, transparent ${(
            d.r - 3
          ).toFixed(1)}px, #000 ${(d.r + 6).toFixed(1)}px)`;
          ring.style.maskImage = mask;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (ring.style as any).webkitMaskImage = mask;
        }
        // Spin the graduation ticks in lock-step with the globe's longitude so
        // they read as meridian marks fixed to the planet, not a static frame.
        const ticks = tickGroupRef.current;
        if (ticks) {
          const rot = d.lng * RING_SPIN_GAIN;
          ticks.setAttribute("transform", `rotate(${rot.toFixed(2)} 100 100)`);
        }
      }
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [enabled, getDisc]);

  if (!enabled) return null;

  return (
    <div style={{ position: "absolute", inset: 0, pointerEvents: "none", overflow: "hidden", zIndex: 1 }}>
      {/* Pedestal ring — a flat ellipse under the globe, masked to sit behind it. */}
      <div
        ref={ringRef}
        style={{ position: "absolute", transform: "translate(-50%, -50%)", mixBlendMode: "screen" }}
      >
        {/* Circles in a square viewBox stretched (preserveAspectRatio="none") into
            the container's ellipse aspect; non-scaling strokes stay even. */}
        <svg
          width="100%"
          height="100%"
          viewBox="0 0 200 200"
          preserveAspectRatio="none"
          style={{ position: "absolute", inset: 0, overflow: "visible" }}
        >
          <defs>
            <filter id="ped-glow" x="-30%" y="-30%" width="160%" height="160%">
              <feGaussianBlur stdDeviation="2.4" />
            </filter>
          </defs>
          {/* Faint base ring (full ellipse; back arc gets masked away). */}
          <circle
            cx="100"
            cy="100"
            r="98"
            fill="none"
            stroke="rgba(120,190,255,0.22)"
            strokeWidth="2"
            vectorEffect="non-scaling-stroke"
            filter="url(#ped-glow)"
          />
          <circle
            cx="100"
            cy="100"
            r="98"
            fill="none"
            stroke="rgba(160,210,255,0.35)"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
          />
          {/* Coordinate / ruler graduations: radial ticks around the ring — a fine
              mark every 3°, a longer + brighter major mark every 30°. Non-scaling
              strokes keep them crisp; the container mask hides ticks behind the globe. */}
          <g ref={tickGroupRef}>
            {Array.from({ length: RING_TICK_COUNT }, (_, i) => {
              const a = (i / RING_TICK_COUNT) * Math.PI * 2;
              const major = i % RING_MAJOR_EVERY === 0;
              const rIn = major ? 84 : 91;
              const cos = Math.cos(a);
              const sin = Math.sin(a);
              return (
                <line
                  key={i}
                  x1={(100 + cos * rIn).toFixed(2)}
                  y1={(100 + sin * rIn).toFixed(2)}
                  x2={(100 + cos * 98).toFixed(2)}
                  y2={(100 + sin * 98).toFixed(2)}
                  stroke={major ? "rgba(195,228,255,0.85)" : "rgba(150,205,255,0.42)"}
                  strokeWidth={major ? 1.6 : 0.9}
                  vectorEffect="non-scaling-stroke"
                />
              );
            })}
          </g>
          {/* Bright sweep travelling around the ring (emerges from behind the globe). */}
          <circle
            cx="100"
            cy="100"
            r="98"
            fill="none"
            stroke="rgba(190,225,255,0.95)"
            strokeWidth="2.2"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
            pathLength={100}
            strokeDasharray="13 87"
            filter="url(#ped-glow)"
          >
            <animate
              attributeName="stroke-dashoffset"
              from="0"
              to="-100"
              dur="7s"
              repeatCount="indefinite"
            />
          </circle>
        </svg>
      </div>

      {/* Atmospheric rim glow around the limb. */}
      <div
        ref={glowRef}
        style={{
          position: "absolute",
          transform: "translate(-50%, -50%)",
          borderRadius: "50%",
          background: GLOW_GRADIENT,
          mixBlendMode: "screen",
        }}
      />
    </div>
  );
}
