"use client";

/**
 * Broadcast vector glyphs — the on-air chrome's crisp, theme-tintable line/
 * silhouette art, drawn to the same house style as `icons.tsx` (single 24-unit
 * viewBox, stroke or flat-fill, no gradients). These deliberately REPLACE the
 * full-colour emoji the shared data model still carries (`hazardMeta().icon`,
 * the forecast condition emoji): emoji render as garish colour bitmaps that
 * clash with the dark vector HUD, so every emoji that reaches the screen gets
 * mapped to one of these at the render layer instead.
 *
 * Two families:
 *   • WeatherGlyph — the 3-DAY FORECAST condition marks (sun / cloud / rain …).
 *   • KindGlyph    — the targeted-event identity mark shown beside the big
 *                    EVENT reticle title (volcano / quake / storm / plane / ship).
 */
import type { ForecastCondition } from "../../lib/weather-forecast";
import type { SegmentKind } from "@photonsurge/shared/director";
import type { HazardType } from "@photonsurge/shared/alerts/hazard";

const SUN = "#f6c249";
const CLOUD = "#c6d4e8";
const RAIN = "#6aa9f0";
const SNOW = "#dbe9f7";
const BOLT = "#f6c249";

/** A soft cloud silhouette (union of a rounded base + three lobes), optionally
 *  nudged down by `dy` so a sun can peek out above it. */
function Cloud({ color, dy = 0 }: { color: string; dy?: number }) {
  return (
    <g transform={`translate(0 ${dy})`} fill={color}>
      <rect x="4.5" y="13" width="14" height="5" rx="2.5" />
      <circle cx="9" cy="12.5" r="4.1" />
      <circle cx="14" cy="11" r="5" />
      <circle cx="17.5" cy="13.5" r="3.6" />
    </g>
  );
}

/** Sun disc + eight rays, centred on (cx,cy) with disc radius r. */
function Sun({ cx = 12, cy = 12, r = 4.3, color = SUN }: { cx?: number; cy?: number; r?: number; color?: string }) {
  const inner = r + 2.2;
  const outer = r + 5.4;
  const d = (a: number) => {
    const rad = (a * Math.PI) / 180;
    return {
      x1: cx + inner * Math.cos(rad),
      y1: cy + inner * Math.sin(rad),
      x2: cx + outer * Math.cos(rad),
      y2: cy + outer * Math.sin(rad),
    };
  };
  return (
    <g>
      {[0, 45, 90, 135, 180, 225, 270, 315].map((a) => {
        const l = d(a);
        return (
          <line
            key={a}
            x1={l.x1}
            y1={l.y1}
            x2={l.x2}
            y2={l.y2}
            stroke={color}
            strokeWidth="1.6"
            strokeLinecap="round"
          />
        );
      })}
      <circle cx={cx} cy={cy} r={r} fill={color} />
    </g>
  );
}

/** A crisp forecast-condition mark, replacing the emoji CONDITION_GLYPH set. */
export function WeatherGlyph({ condition, size = 26 }: { condition: ForecastCondition; size?: number }) {
  const svg = (children: React.ReactNode) => (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ flex: "none", display: "block" }} aria-hidden>
      {children}
    </svg>
  );
  switch (condition) {
    case "sunny":
      return svg(<Sun cx={12} cy={12} r={4.6} />);
    case "partly-cloudy":
      return svg(
        <>
          <Sun cx={8.5} cy={8.5} r={3.1} />
          <Cloud color={CLOUD} dy={2.5} />
        </>,
      );
    case "cloudy":
      return svg(<Cloud color={CLOUD} />);
    case "rain":
      return svg(
        <>
          <Cloud color={CLOUD} dy={-1.5} />
          {[8, 12, 16].map((x, i) => (
            <line
              key={x}
              x1={x}
              y1={17 + (i === 1 ? 0.5 : 0)}
              x2={x - 1.4}
              y2={21 + (i === 1 ? 0.5 : 0)}
              stroke={RAIN}
              strokeWidth="1.6"
              strokeLinecap="round"
            />
          ))}
        </>,
      );
    case "snow":
      return svg(
        <>
          <Cloud color={CLOUD} dy={-1.5} />
          {[
            [8, 18],
            [12, 20],
            [16, 18],
          ].map(([x, y]) => (
            <circle key={x} cx={x} cy={y} r="1.05" fill={SNOW} />
          ))}
        </>,
      );
    case "storm":
      return svg(
        <>
          <Cloud color={CLOUD} dy={-1.5} />
          <path d="M12.6 16 L9 20.4 L11.5 20.4 L10.4 23.5 L14.6 18.8 L12 18.8 Z" fill={BOLT} />
        </>,
      );
    default:
      return svg(<Cloud color={CLOUD} />);
  }
}

/** Flat-fill identity silhouettes for the targeted event kinds, tinted to the
 *  segment's kind colour. Missing kinds render nothing (the title just shows
 *  the name, no mark) — only the reticle-eligible kinds are mapped. */
const KIND_PATH: Partial<Record<SegmentKind, (color: string) => React.ReactNode>> = {
  volcano: (c) => <path d="M2 21 L9 7.5 L11.5 11.5 L15 4 L22 21 Z" fill={c} />,
  quake: (c) => (
    <>
      <circle cx="12" cy="12" r="2.6" fill={c} />
      <path d="M6.5 5.5 A9 9 0 0 0 6.5 18.5" fill="none" stroke={c} strokeWidth="1.8" strokeLinecap="round" opacity="0.85" />
      <path d="M17.5 5.5 A9 9 0 0 1 17.5 18.5" fill="none" stroke={c} strokeWidth="1.8" strokeLinecap="round" opacity="0.85" />
    </>
  ),
  storm: (c) => (
    <>
      <circle cx="12" cy="12" r="2" fill={c} />
      <path d="M12 3.5 C17.5 3.5 19.5 7 18.2 11 C17.4 8 14.5 6.4 12 7 Z" fill={c} />
      <path d="M12 20.5 C6.5 20.5 4.5 17 5.8 13 C6.6 16 9.5 17.6 12 17 Z" fill={c} />
    </>
  ),
  flight: (c) => (
    <path
      d="M11.2 2.2 L12.8 2.2 L13.4 10 L21 14.6 L21 16.4 L13.4 14.2 L13.4 19 L15.8 20.7 L15.8 22 L12 20.9 L8.2 22 L8.2 20.7 L10.6 19 L10.6 14.2 L3 16.4 L3 14.6 L10.6 10 Z"
      fill={c}
    />
  ),
  ship: (c) => (
    <>
      <path d="M3 15 L21 15 L18.6 20 L5.4 20 Z" fill={c} />
      <path d="M7.5 15 L7.5 10.5 L14 10.5 L14 15 Z" fill={c} />
      <rect x="15" y="12" width="1.9" height="3" fill={c} />
      <rect x="11" y="6.5" width="1.3" height="4.5" fill={c} />
    </>
  ),
};

/** Identity mark for the on-air event reticle title. */
export function KindGlyph({ kind, color, size = 28 }: { kind: SegmentKind; color: string; size?: number }) {
  const draw = KIND_PATH[kind];
  if (!draw) return null;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ flex: "none", display: "block" }} aria-hidden>
      {draw(color)}
    </svg>
  );
}

/** Warning triangle for the forecast hazard badge (replaces the emoji chip). */
export function WarnTriangle({ size = 11 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ flex: "none", display: "block" }} aria-hidden>
      <path d="M12 3 L22 20 L2 20 Z" fill="#fff" fillOpacity="0.95" />
      <rect x="11" y="9" width="2" height="5.5" rx="1" fill="#111" />
      <circle cx="12" cy="17.2" r="1.15" fill="#111" />
    </svg>
  );
}

/**
 * Wind direction mark for a forecast day card: an arrow pointing the way the
 * air is TRAVELLING, given the meteorological bearing it blows FROM (a "NW
 * wind" arrow points south-east, which is what a viewer reads off a map).
 */
export function WindArrow({ deg, size = 10, color }: { deg: number | null; size?: number; color: string }) {
  // No bearing (dead calm, or a sampler that sent no components) draws nothing:
  // a placeholder mark beside a real gust number reads as a direction.
  if (deg == null) return null;
  // The arrow points DOWNWIND: a 0° (northerly) wind travels south, and the
  // glyph's untransformed head already points up, so add 180°.
  //
  // Shaft-and-head, not a dart: at the ~11px this renders at on air, a solid
  // dart or triangle reads as a blob whose direction you have to guess, while
  // the shaft gives the eye an axis to read the angle off. Checked at size.
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      style={{ flex: "none", display: "block", transform: `rotate(${deg + 180}deg)` }}
      aria-hidden
    >
      <path d="M12 2.5 L19.5 13 L14.5 13 L14.5 21.5 L9.5 21.5 L9.5 13 L4.5 13 Z" fill={color} />
    </svg>
  );
}

/** Raindrop for the precip-chance row. */
export function Droplet({ size = 9, color }: { size?: number; color: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ flex: "none", display: "block" }} aria-hidden>
      <path d="M12 2.5 C12 2.5 19 11.2 19 15.4 A7 7 0 0 1 5 15.4 C5 11.2 12 2.5 12 2.5 Z" fill={color} />
    </svg>
  );
}

/* ── HazardGlyph ─────────────────────────────────────────────────────────────
 * The alert vocabulary's identity marks. `hazardMeta().icon` in shared carries
 * a full-colour emoji per hazard, and rendering that string put the broadcast
 * at the mercy of the viewing machine's emoji font — the Chromium inside OBS
 * has none, so the ACTIVE FEED drew a .notdef box where every hazard mark
 * belonged. These are the same marks as vectors: one flat 24-unit silhouette
 * per hazard, tinted to the hazard's own colour, so they cost no font, match
 * the dark vector HUD, and render identically on every box.
 * ─────────────────────────────────────────────────────────────────────────── */

/** A hazard mark, or the fixed seismic mark the world feed gives quakes. */
export type HazardGlyphId = HazardType | "quake";

/** Eight rays around a disc — heat. */
function rays(c: string, cx: number, cy: number, inner: number, outer: number) {
  return [0, 45, 90, 135, 180, 225, 270, 315].map((a) => {
    const r = (a * Math.PI) / 180;
    return (
      <line
        key={a}
        x1={cx + inner * Math.cos(r)}
        y1={cy + inner * Math.sin(r)}
        x2={cx + outer * Math.cos(r)}
        y2={cy + outer * Math.sin(r)}
        stroke={c}
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    );
  });
}

/** The cloud used by the sky hazards, as a flat single-colour silhouette. */
function FlatCloud({ c, dy = 0 }: { c: string; dy?: number }) {
  return (
    <g transform={`translate(0 ${dy})`} fill={c}>
      <rect x="4" y="9.5" width="15" height="4.6" rx="2.3" />
      <circle cx="8.6" cy="9.4" r="3.5" />
      <circle cx="13.2" cy="8.1" r="4.3" />
      <circle cx="16.6" cy="10.3" r="3" />
    </g>
  );
}

/** Short slanted strokes under a cloud — rain / drizzle. */
function drops(c: string, xs: number[], y = 16.5, len = 4.2) {
  return xs.map((x) => (
    <line key={x} x1={x} y1={y} x2={x - 1.6} y2={y + len} stroke={c} strokeWidth="1.9" strokeLinecap="round" />
  ));
}

/** Three trailing air streams with curled ends — wind / dust. */
function streams(c: string) {
  return (
    <path
      d="M2.5 7.5 H11 C13.4 7.5 13.4 4.3 11 4.3 M2.5 12 H16.5 C19.2 12 19.2 15.6 16.5 15.6 M2.5 16.6 H9.5"
      fill="none"
      stroke={c}
      strokeWidth="1.9"
      strokeLinecap="round"
    />
  );
}

/**
 * One silhouette per hazard. Every `HazardType` is present on purpose — the
 * table is exhaustively typed (not Partial), so adding a hazard to the shared
 * vocabulary without drawing it is a compile error rather than a blank box.
 */
const HAZARD_PATH: Record<HazardGlyphId, (c: string) => React.ReactNode> = {
  // A sun, not a flame — "fire" owns the flame, and the two must not read alike.
  heat: (c) => (
    <>
      <circle cx="12" cy="12" r="4.4" fill={c} />
      {rays(c, 12, 12, 6.6, 9.6)}
    </>
  ),
  cold: (c) => (
    <g stroke={c} strokeWidth="1.9" strokeLinecap="round">
      <line x1="12" y1="3" x2="12" y2="21" />
      <line x1="4.2" y1="7.5" x2="19.8" y2="16.5" />
      <line x1="4.2" y1="16.5" x2="19.8" y2="7.5" />
      <g strokeWidth="1.6">
        <path d="M9.2 5.4 L12 7.2 L14.8 5.4" fill="none" />
        <path d="M9.2 18.6 L12 16.8 L14.8 18.6" fill="none" />
      </g>
    </g>
  ),
  wind: (c) => streams(c),
  tornado: (c) => (
    <g fill={c}>
      <path d="M2.5 4 H21.5 L17.6 8.2 H6.4 Z" />
      <path d="M7 10.2 H17 L14.4 14 H9.6 Z" />
      <path d="M10 16 H14 L12.7 21.4 H11.3 Z" />
    </g>
  ),
  thunderstorm: (c) => (
    <>
      <FlatCloud c={c} dy={-1.2} />
      <path d="M13.4 13.4 L9.2 19 H11.9 L10.6 23 L15.4 16.9 H12.6 Z" fill={c} />
    </>
  ),
  rain: (c) => (
    <>
      <FlatCloud c={c} dy={-1.4} />
      {drops(c, [8.6, 12.4, 16.2])}
    </>
  ),
  flood: (c) => (
    <>
      <path d="M8 4.5 L16 4.5 L16 14 L8 14 Z" fill={c} opacity="0.5" />
      <path d="M6 3.4 L18 3.4 L12 8.2 Z" fill={c} opacity="0.5" />
      <path
        d="M2 15.5 C5 13.6 7 17.4 10 15.5 C13 13.6 15 17.4 18 15.5 C20 14.2 21 15 22 15.5 M2 19.6 C5 17.7 7 21.5 10 19.6 C13 17.7 15 21.5 18 19.6 C20 18.3 21 19.1 22 19.6"
        fill="none"
        stroke={c}
        strokeWidth="1.9"
        strokeLinecap="round"
      />
    </>
  ),
  "snow-ice": (c) => (
    <>
      <FlatCloud c={c} dy={-1.4} />
      <g stroke={c} strokeWidth="1.6" strokeLinecap="round">
        <line x1="8.8" y1="16.2" x2="8.8" y2="20.4" />
        <line x1="6.9" y1="17.3" x2="10.7" y2="19.3" />
        <line x1="10.7" y1="17.3" x2="6.9" y2="19.3" />
        <line x1="15.6" y1="16.2" x2="15.6" y2="20.4" />
        <line x1="13.7" y1="17.3" x2="17.5" y2="19.3" />
        <line x1="17.5" y1="17.3" x2="13.7" y2="19.3" />
      </g>
    </>
  ),
  fog: (c) => (
    <g stroke={c} strokeWidth="2.1" strokeLinecap="round">
      <line x1="3.5" y1="7" x2="19" y2="7" />
      <line x1="5.8" y1="11" x2="21" y2="11" />
      <line x1="3.5" y1="15" x2="18" y2="15" />
      <line x1="6.6" y1="19" x2="20.4" y2="19" />
    </g>
  ),
  fire: (c) => (
    <path
      d="M12.4 2 C15.4 6.6 19 8.6 19 13.4 C19 17.6 15.9 21.4 12 21.4 C8.1 21.4 5 17.6 5 13.4 C5 10.8 6.3 9.1 8 7.4 C8.2 10 9.4 11.2 10.4 11.8 C11.2 8.6 10.9 5.2 12.4 2 Z"
      fill={c}
    />
  ),
  dust: (c) => (
    <>
      {streams(c)}
      <g fill={c}>
        <circle cx="15.4" cy="7.5" r="1.15" />
        <circle cx="19" cy="8.6" r="0.95" />
        <circle cx="13.2" cy="16.6" r="1.05" />
        <circle cx="17.4" cy="19.4" r="0.95" />
      </g>
    </>
  ),
  // A respirator, the one mark people read instantly as "don't breathe this".
  // Drawn as an outline: a filled mask read as a bowl, and punching the pleats
  // out needed a hard-coded tile colour that would break on a themed panel.
  air: (c) => (
    <g stroke={c} strokeWidth="1.9" fill="none" strokeLinecap="round" strokeLinejoin="round">
      {/* Ear loops sit OUTSIDE the body: drawn rising from the top corners they
          closed into a handle and the mark read as a basket. */}
      <path d="M6 9.6 C3 9.6 3 15.4 6 15.4" />
      <path d="M18 9.6 C21 9.6 21 15.4 18 15.4" />
      <path d="M6 8.4 H18 V13.6 C18 16.9 15.4 19.2 12 19.2 C8.6 19.2 6 16.9 6 13.6 Z" />
      <path d="M6.3 12.2 H17.7" strokeWidth="1.5" />
      <path d="M6.9 15.4 H17.1" strokeWidth="1.5" />
    </g>
  ),
  coastal: (c) => (
    <>
      {/* Read as a cross-section: open water on the left, the beach rising to
          land on the right. A free-floating crest just merged with the swell. */}
      <path d="M8.4 21.4 C12.4 13.4 16.4 11.2 23 11.2 L23 21.4 Z" fill={c} opacity="0.85" />
      <path
        d="M1 13.6 C3.2 11.9 4.9 14.9 7.1 13.2 M1 17.2 C3.2 15.5 4.9 18.5 7.1 16.8 M1 20.8 C3 19.2 4.6 21.8 6.6 20.4"
        fill="none"
        stroke={c}
        strokeWidth="1.9"
        strokeLinecap="round"
      />
    </>
  ),
  marine: (c) => (
    <g stroke={c} strokeWidth="1.9" fill="none" strokeLinecap="round">
      <circle cx="12" cy="4.9" r="2.1" />
      <line x1="12" y1="7.4" x2="12" y2="20.4" />
      <line x1="7.4" y1="10" x2="16.6" y2="10" />
      <path d="M4.6 14.2 C4.6 18.4 8 20.8 12 20.8 C16 20.8 19.4 18.4 19.4 14.2" />
    </g>
  ),
  avalanche: (c) => (
    <>
      <path d="M2 20.5 L10 6.5 L14.2 13.6 L16.4 10 L22 20.5 Z" fill={c} opacity="0.55" />
      <path d="M9.4 8.4 C11 12.4 13.4 15.4 17.6 17.6 C13.2 18.4 9 17 6 14 Z" fill={c} />
    </>
  ),
  cyclone: (c) => (
    <>
      <circle cx="12" cy="12" r="2.4" fill={c} />
      <path d="M12 2.5 C19 2.5 21.5 7.2 19.3 12.2 C18.7 8 15.4 5.6 12 6.5 Z" fill={c} />
      <path d="M12 21.5 C5 21.5 2.5 16.8 4.7 11.8 C5.3 16 8.6 18.4 12 17.5 Z" fill={c} />
    </>
  ),
  drought: (c) => (
    <>
      <circle cx="12" cy="6.2" r="3.3" fill={c} />
      {rays(c, 12, 6.2, 5, 7)}
      {/* Parched ground: a shallow band, the cracks being the gaps between its
          slabs. Taller slabs read as a row of buildings. */}
      <g fill={c}>
        <path d="M1.5 15.8 L7.6 15.8 L6.7 21 L1.5 21 Z" />
        <path d="M8.9 15.8 L15.1 15.8 L15.9 21 L7.9 21 Z" />
        <path d="M16.4 15.8 L22.5 15.8 L22.5 21 L17.1 21 Z" />
      </g>
    </>
  ),
  volcano: (c) => (
    <>
      <path d="M2 21 L9 7.5 L11.5 11.5 L15 4 L22 21 Z" fill={c} />
      <circle cx="15.4" cy="3.2" r="1.5" fill={c} opacity="0.6" />
      <circle cx="18.4" cy="5" r="1.1" fill={c} opacity="0.45" />
    </>
  ),
  tsunami: (c) => (
    <>
      <path
        d="M2.6 17.6 C2.6 10.2 8 5.4 14 5.4 C18.4 5.4 21.4 8 21.4 11.4 C21.4 14 19.6 15.8 17.4 15.8 C15.6 15.8 14.4 14.6 14.4 13.2 C14.4 12 15.2 11.2 16.2 11.2 C13.6 8.8 8.6 10.6 7.4 17.6 Z"
        fill={c}
      />
      <path
        d="M2 20.6 C5 18.7 7 22.5 10 20.6 C13 18.7 15 22.5 18 20.6 C20 19.3 21 20.1 22 20.6"
        fill="none"
        stroke={c}
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </>
  ),
  landslide: (c) => (
    <>
      <path d="M2 21 L2 12.6 C7.4 12.6 11.6 9 14 3.4 L14 21 Z" fill={c} opacity="0.5" />
      <g fill={c}>
        <circle cx="16.4" cy="11.6" r="2.1" />
        <circle cx="20.4" cy="15.4" r="1.6" />
        <circle cx="16" cy="18.4" r="2.6" />
        <circle cx="21" cy="20.2" r="1.35" />
      </g>
    </>
  ),
  other: (c) => (
    <>
      <path d="M12 3 L22 20.4 L2 20.4 Z" fill={c} />
      <rect x="11" y="9.4" width="2" height="5.6" rx="1" fill="#0b1420" />
      <circle cx="12" cy="17.6" r="1.15" fill="#0b1420" />
    </>
  ),
  // The world feed's fixed seismic mark — an epicentre and its wavefronts.
  quake: (c) => (
    <>
      <circle cx="12" cy="12" r="2.6" fill={c} />
      <path d="M6.5 5.5 A9 9 0 0 0 6.5 18.5" fill="none" stroke={c} strokeWidth="1.9" strokeLinecap="round" opacity="0.85" />
      <path d="M17.5 5.5 A9 9 0 0 1 17.5 18.5" fill="none" stroke={c} strokeWidth="1.9" strokeLinecap="round" opacity="0.85" />
    </>
  ),
};

/**
 * The hazard's identity mark. Replaces `hazardMeta(id).icon` everywhere that
 * string would otherwise reach the DOM — pass the hazard's own colour so the
 * mark carries the same severity read the emoji's colours used to.
 */
export function HazardGlyph({
  id,
  color,
  size = 22,
}: {
  id: HazardGlyphId;
  color: string;
  size?: number;
}) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ flex: "none", display: "block" }} aria-hidden>
      {HAZARD_PATH[id](color)}
    </svg>
  );
}
