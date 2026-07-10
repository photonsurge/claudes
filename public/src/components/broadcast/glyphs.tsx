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
