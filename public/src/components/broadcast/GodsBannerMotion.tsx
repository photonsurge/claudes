"use client";

/**
 * The masthead's moving chrome on ONE 2D canvas laid over the static panel
 * artwork (see banner-motion.ts for why it isn't CSS-animated SVG any more).
 * Sized to its box by a ResizeObserver so the per-frame paint never reads
 * layout; repaints on requestAnimationFrame (the OBS source's own cadence), or
 * once when frozen (`static` banners, prefers-reduced-motion, jsdom).
 */
import { useEffect, useRef } from "react";
import { drawBannerMotion, type BannerMotionOpts } from "./banner-motion";

const VIEW_W = 1400;
/** Backing-store cap: 2× is crisp on any broadcast canvas; more is wasted fill. */
const MAX_DPR = 2;

export default function GodsBannerMotion({
  accent,
  border,
  titleColor,
  liveCore,
  frozen = false,
}: BannerMotionOpts & { frozen?: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sizeRef = useRef({ w: 0, h: 0 });
  const optsRef = useRef<BannerMotionOpts>({ accent, border, titleColor, liveCore });
  optsRef.current = { accent, border, titleColor, liveCore };
  // The still-frame painter, for callers outside the rAF loop (colour/size
  // changes while frozen). A no-op until the canvas effect installs it.
  const paintRef = useRef<() => void>(() => {});

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let ctx: CanvasRenderingContext2D | null = null;
    try {
      ctx = canvas.getContext("2d");
    } catch {
      ctx = null;
    }
    if (!ctx) return;
    const g = ctx;
    const reduced =
      typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    const still = frozen || reduced;

    const paint = () => {
      const { w, h } = sizeRef.current;
      if (!w || !h) return;
      const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
      const bw = Math.round(w * dpr);
      const bh = Math.round(h * dpr);
      if (canvas.width !== bw || canvas.height !== bh) {
        canvas.width = bw;
        canvas.height = bh;
      }
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, bw, bh);
      // 1 unit = 1 viewBox unit: the box keeps the SVG's aspect, so width alone
      // sets the scale.
      const s = (w / VIEW_W) * dpr;
      g.setTransform(s, 0, 0, s, 0, 0);
      drawBannerMotion(g, still ? 0 : Date.now(), optsRef.current);
    };
    paintRef.current = paint;

    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver === "function") {
      ro = new ResizeObserver((entries) => {
        const e = entries[entries.length - 1];
        if (!e) return;
        sizeRef.current = { w: e.contentRect.width, h: e.contentRect.height };
        if (still) paint();
      });
      ro.observe(canvas);
    } else {
      sizeRef.current = { w: canvas.clientWidth, h: canvas.clientHeight };
      if (still) paint();
    }

    let raf = 0;
    if (!still) {
      const loop = () => {
        paint();
        raf = requestAnimationFrame(loop);
      };
      raf = requestAnimationFrame(loop);
    }
    return () => {
      cancelAnimationFrame(raf);
      ro?.disconnect();
      paintRef.current = () => {};
    };
  }, [frozen]);

  // A theme change on a frozen banner still has to show: the loop (when
  // running) picks the new colours up next frame by itself.
  useEffect(() => {
    if (frozen) paintRef.current();
  }, [frozen, accent, border, titleColor, liveCore]);

  return (
    <canvas
      ref={canvasRef}
      data-gods-motion=""
      data-live-core={liveCore ? "" : undefined}
      aria-hidden="true"
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        display: "block",
        pointerEvents: "none",
      }}
    />
  );
}
