/**
 * The G.O.D.S. masthead's moving chrome — panel sweep, bezel rings, dashed
 * orbit, status pulse — drawn on a 2D canvas in the banner's 1400×320 viewBox
 * units. Pure drawing code (no React, no DOM) so it can be unit-tested against
 * a recording context.
 *
 * Why not CSS animations on the SVG shapes (the previous version): a CSS
 * animation on an SVG CHILD element is ticked by Blink's main thread — every
 * frame it invalidates the element's style, re-lays-out the SVG root, repaints
 * it and re-layerizes the page. HTML-level opacity/transform animations run on
 * the compositor for free, but nothing inside an <svg> does. Measured on the
 * /watch main thread inside OBS: the five animated shapes here were the last
 * per-frame style + layout + paint + Layerize the page paid for (~3 ms of a
 * 33 ms frame). A canvas repaint touches no style or layout at all.
 *
 * Geometry, colours, dash patterns and periods are the SVG's, verbatim, so the
 * artwork is pixel-for-pixel the same at rest and moves the same way.
 */

export interface BannerMotionOpts {
  /** Main scene colour (dashed ring, ticks, orbit dash, status square). */
  accent: string;
  /** Panel fill / border tone (static rings, the thick sweep arc). */
  border: string;
  /** Title ink — the solid orbit ring and the bright end of the sweep. */
  titleColor: string;
  /** A live globe sits in the aperture: the orbit's back arc ducks behind it. */
  liveCore: boolean;
}

/** Periods — the CSS animations' durations. */
export const SWEEP_MS = 5500;
export const SPIN_MS = 42_000;
export const SPIN_REV_MS = 18_000;
export const DASH_MS = 6000;
export const PULSE_MS = 1800;

/** Planet aperture centre + the orbit rings' tilt, from the SVG. */
const CX = 176;
const CY = 160;
const RING_TILT = (-27 * Math.PI) / 180;

/**
 * gbSweep: `0%{opacity:0} 12%{opacity:1} 100%{opacity:0}`, linear — a quick
 * rise then a long fade as the band crosses the panel.
 */
export function sweepOpacity(phase: number): number {
  const p = Math.min(1, Math.max(0, phase));
  return p < 0.12 ? p / 0.12 : 1 - (p - 0.12) / 0.88;
}

/**
 * gbPulse: `0%,100%{opacity:1} 50%{opacity:.25}`, ease-in-out per leg. The
 * cosine ease stands in for cubic-bezier(.42,0,.58,1) — within a couple of
 * percent, on a 9px square.
 */
export function pulseOpacity(phase: number): number {
  const p = Math.min(1, Math.max(0, phase));
  const leg = p < 0.5 ? p / 0.5 : (1 - p) / 0.5;
  const eased = 0.5 - 0.5 * Math.cos(Math.PI * leg);
  return 1 - 0.75 * eased;
}

/** "#rgb" / "#rrggbb" / "#rrggbbaa" → "rgba(r,g,b,a)"; anything else passes through. */
export function withAlpha(color: string, alpha: number): string {
  const m = /^#([0-9a-f]{3,8})$/i.exec(color.trim());
  if (!m) return color;
  let h = m[1];
  if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join("");
  if (h.length !== 6 && h.length !== 8) return color;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const base = h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
  return `rgba(${r},${g},${b},${+(alpha * base).toFixed(3)})`;
}

/** The panel interior the sweep is clipped to (the SVG's scan-clip path). */
function scanClip(ctx: CanvasRenderingContext2D) {
  ctx.beginPath();
  ctx.moveTo(26, 60);
  ctx.lineTo(1356, 60);
  ctx.lineTo(1384, 86);
  ctx.lineTo(1384, 188);
  ctx.lineTo(1356, 216);
  ctx.lineTo(1156, 216);
  ctx.lineTo(1152, 244);
  ctx.lineTo(362, 244);
  ctx.lineTo(358, 216);
  ctx.lineTo(26, 216);
  ctx.closePath();
}

function strokeCircle(ctx: CanvasRenderingContext2D, r: number, style: string, width: number) {
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.strokeStyle = style;
  ctx.lineWidth = width;
  ctx.stroke();
}

function strokeOrbit(ctx: CanvasRenderingContext2D, rx: number, ry: number, style: string, width: number) {
  ctx.beginPath();
  ctx.ellipse(CX, CY, rx, ry, RING_TILT, 0, Math.PI * 2);
  ctx.strokeStyle = style;
  ctx.lineWidth = width;
  ctx.stroke();
}

function line(ctx: CanvasRenderingContext2D, x: number, y: number, dx: number, dy: number) {
  ctx.moveTo(x, y);
  ctx.lineTo(x + dx, y + dy);
}

/**
 * Paint one frame at wall-clock `t` (ms). The context must already be scaled so
 * that 1 unit = 1 viewBox unit; the canvas is expected clear.
 */
export function drawBannerMotion(ctx: CanvasRenderingContext2D, t: number, o: BannerMotionOpts) {
  const phase = (ms: number) => (((t % ms) + ms) % ms) / ms;

  // ── Panel sweep: a soft gradient band crossing the panel left → right ────
  const sp = phase(SWEEP_MS);
  ctx.save();
  scanClip(ctx);
  ctx.clip();
  const dx = 940 * sp;
  const scan = ctx.createLinearGradient(380 + dx, 0, 490 + dx, 0);
  scan.addColorStop(0, withAlpha(o.accent, 0));
  scan.addColorStop(1, withAlpha(o.titleColor, 0.85));
  ctx.globalAlpha = 0.16 * sweepOpacity(sp);
  ctx.fillStyle = scan;
  ctx.fillRect(380 + dx, 60, 110, 186);
  ctx.restore();

  // ── Globe bezel ──────────────────────────────────────────────────────────
  ctx.save();
  ctx.translate(CX, CY);
  ctx.lineCap = "butt";
  strokeCircle(ctx, 158, o.border, 2.4);
  strokeCircle(ctx, 152, withAlpha(o.border, 0.78), 1.4);
  // Dotted accent ring, one turn per 42 s.
  ctx.save();
  ctx.rotate(Math.PI * 2 * phase(SPIN_MS));
  ctx.setLineDash([2, 9]);
  strokeCircle(ctx, 140, withAlpha(o.accent, 0.5), 1);
  ctx.restore();
  // Thick short arc in the border tone, one turn the other way per 18 s.
  ctx.save();
  ctx.rotate(-Math.PI * 2 * phase(SPIN_REV_MS));
  ctx.setLineDash([36, 230]);
  strokeCircle(ctx, 146, o.border, 6);
  ctx.restore();
  ctx.restore();

  // Aperture ticks: two horizontal marks and four corner slashes.
  ctx.beginPath();
  line(ctx, 8, 160, 22, 0);
  line(ctx, 322, 160, 22, 0);
  ctx.strokeStyle = withAlpha(o.accent, 0.85);
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.beginPath();
  line(ctx, 64, 48, 16, 16);
  line(ctx, 288, 48, -16, 16);
  line(ctx, 64, 272, 16, -16);
  line(ctx, 288, 272, -16, -16);
  ctx.strokeStyle = withAlpha(o.accent, 0.45);
  ctx.lineWidth = 1.6;
  ctx.stroke();

  // ── Orbit rings ──────────────────────────────────────────────────────────
  ctx.save();
  if (o.liveCore) {
    // Hide the arc that is BOTH inside the planet's disc (r=140) AND on the
    // back half of the ring plane (local y<0 in the ring's tilted frame): the
    // far arc ducks behind the globe, the near lower-right arc crosses in
    // front. Even-odd clip = everything minus that half-disc.
    ctx.beginPath();
    ctx.rect(-2000, -2000, 5400, 4400);
    ctx.save();
    ctx.translate(CX, CY);
    ctx.rotate(RING_TILT);
    ctx.moveTo(-140, 0);
    ctx.arc(0, 0, 140, Math.PI, Math.PI * 2);
    ctx.closePath();
    ctx.restore();
    ctx.clip("evenodd");
  }
  strokeOrbit(ctx, 180, 62, withAlpha(o.titleColor, 0.9), 2.4);
  ctx.setLineDash([30, 12]);
  ctx.lineDashOffset = -220 * phase(DASH_MS);
  strokeOrbit(ctx, 173, 55, withAlpha(o.accent, 0.5), 1.1);
  ctx.restore();

  // ── Status pulse square ──────────────────────────────────────────────────
  ctx.globalAlpha = pulseOpacity(phase(PULSE_MS));
  ctx.fillStyle = o.accent;
  ctx.fillRect(384, 144, 9, 9);
  ctx.globalAlpha = 1;
}
