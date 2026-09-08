"use client";

import { useEffect, useId, useState, type CSSProperties } from "react";

export interface GodsBannerProps {
  /** Main scene colour. */
  accent?: string;
  /** Panel fill / border tone. */
  border?: string;
  panelTopColor?: string;
  panelMidColor?: string;
  panelBottomColor?: string;
  title?: string;
  /** Main title ink; defaults to the artwork's off-white. */
  titleColor?: string;
  /** Status/readout ink tokens supplied by the scene theme. */
  textColor?: string;
  mutedColor?: string;
  dimColor?: string;
  /** Left-to-right status chips; the first is treated as active. */
  channels?: string[];
  /** Coordinate readout, e.g. { lat: -15.389, lon: 167.835 }. */
  coords?: { lat: number; lon: number } | null;
  version?: string;
  /** Ticker line in the lower notch; the tape row hides when both this and
   *  `nextAt` are empty. */
  ticker?: string;
  /** Wall-clock ms when the current shot ends (DirectorState.endsAt) — shows
   *  a live "NEXT IN mm:ss" countdown at the tape row's right edge. */
  nextAt?: number | null;
  /** Show the ticking UTC clock + city times at the right of the status row. */
  clock?: boolean;
  /**
   * Punch a transparent hole where the globe sits so a live map/globe layered
   * BEHIND the svg shows through. Hole is r=138 around (176,160) in the
   * 1400x320 viewBox — just inside the dashed r=140 bezel ring the live
   * planet's limb tucks under; BrandPanel owns the matching canvas geometry.
   */
  liveCore?: boolean;
  /** Freeze all motion (screenshots, reduced-motion callers). */
  static?: boolean;
  width?: number | string;
  className?: string;
  style?: CSSProperties;
  label?: string;
}

const KEYFRAMES = `
@keyframes gbSpin{to{transform:rotate(360deg)}}
@keyframes gbSpinRev{to{transform:rotate(-360deg)}}
@keyframes gbSweep{0%{opacity:0;transform:translateX(0)}12%{opacity:1}100%{opacity:0;transform:translateX(940px)}}
@keyframes gbPulse{0%,100%{opacity:1}50%{opacity:.25}}
@keyframes gbDash{to{stroke-dashoffset:-220}}
@media (prefers-reduced-motion: reduce){
  [data-gods-anim]{animation:none !important}
}`;

/** Load once in your app shell: Saira + JetBrains Mono from Google Fonts. */
export const GODS_FONT_HREF =
  "https://fonts.googleapis.com/css2?family=Saira:wght@300;400;500;600&family=JetBrains+Mono:wght@400;500&display=swap";

const SANS = "Saira, 'Helvetica Neue', Helvetica, sans-serif";
const MONO = "'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, monospace";

/** City clocks on the status row's second line, west → east. */
const CITY_CLOCKS: [name: string, tz: string][] = [
  ["LONDON", "Europe/London"],
  ["NEW YORK", "America/New_York"],
  ["BEIJING", "Asia/Shanghai"],
  ["TOKYO", "Asia/Tokyo"],
  ["MOSCOW", "Europe/Moscow"],
];

function useClocks(enabled: boolean) {
  const [value, setValue] = useState({ utc: "", cities: "" });
  useEffect(() => {
    if (!enabled) return;
    const p = (n: number) => String(n).padStart(2, "0");
    const at = (tz: string) =>
      new Date().toLocaleTimeString("en-GB", { timeZone: tz, hour12: false });
    const tick = () => {
      const d = new Date();
      setValue({
        utc: `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())} UTC`,
        cities: CITY_CLOCKS.map(([name, tz]) => `${name} ${at(tz)}`).join(" · "),
      });
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [enabled]);
  return value;
}

/** "mm:ss" until `nextAt` (clamped at 00:00), empty when no target. */
function useCountdown(nextAt?: number | null) {
  const [label, setLabel] = useState("");
  useEffect(() => {
    if (!nextAt) {
      setLabel("");
      return;
    }
    const tick = () => {
      const s = Math.max(0, Math.ceil((nextAt - Date.now()) / 1000));
      setLabel(`${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`);
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [nextAt]);
  return label;
}

/**
 * G.O.D.S. masthead. 1400x320 viewBox, thin HUD chrome matching the map UI,
 * oversized globe aperture on the left. Pass liveCore to punch the globe hole
 * and layer the real globe canvas behind the svg (BrandPanel does exactly
 * that with SubGlobeWidget).
 */
export default function GodsBanner({
  accent = "#3fd0ff",
  border = "#1d4354",
  panelTopColor = "#0e1e29",
  panelMidColor = "#081420",
  panelBottomColor = "#0a1a24",
  title = "GLOBAL ORBITAL DETECTION SYSTEM",
  titleColor = "#e9f3f7",
  textColor = "#c4d6de",
  mutedColor = "#a8c0cb",
  dimColor = "#6f9aaa",
  channels = [],
  coords = null,
  version,
  ticker = "",
  nextAt = null,
  clock = true,
  liveCore = false,
  static: frozen = false,
  width = "100%",
  className,
  style,
  label = "Global Orbital Detection System",
}: GodsBannerProps) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const id = (name: string) => `gb-${name}-${uid}`;
  const times = useClocks(clock);
  const countdown = useCountdown(nextAt);
  const anim = (value: string): CSSProperties => (frozen ? {} : { animation: value });
  const PANEL =
    "M24 58 H1358 L1386 86 V190 L1358 218 H1178 L1154 246 H360 L336 218 H24 Z";

  // Two stacked SVGs sharing one viewBox. The ANIMATED chrome (panel sweep,
  // bezel rings, dashed orbit, status pulse) lives in the lower one, which has
  // no text; the text (title, status chips, coords, clocks, tape row) in the
  // upper one. Why: a CSS animation on an SVG child re-lays-out its whole SVG
  // root every frame, and with this banner's dozen letter-spaced <text> runs
  // in the same root that relayout cost the /watch main thread ~13 ms a frame
  // (a measured 16 % of it). Split, the per-frame relayout touches ~25 plain
  // shapes; the text SVG only relayouts when the clock/countdown ticks (1 Hz).
  // The wrapper carries the accessible name so the banner is still one image.
  return (
    <div
      role="img"
      aria-label={label}
      className={className}
      style={{ position: "relative", width, ...style }}
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 1400 320"
        width="100%"
        aria-hidden="true"
        style={{ display: "block" }}
      >
        <defs>
          <style>{KEYFRAMES}</style>
          <linearGradient id={id("panel")} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={panelTopColor} />
            <stop offset="0.5" stopColor={panelMidColor} />
            <stop offset="1" stopColor={panelBottomColor} />
          </linearGradient>
          <linearGradient id={id("scan")} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor={accent} stopOpacity="0" />
            <stop offset="1" stopColor={titleColor} stopOpacity="0.85" />
          </linearGradient>
          <clipPath id={id("panel-clip")}>
            <path d={PANEL} />
          </clipPath>
          <clipPath id={id("scan-clip")}>
            <path d="M26 60 H1356 L1384 86 V188 L1356 216 H1156 L1152 244 H362 L358 216 H26 Z" />
          </clipPath>
          {liveCore && (
            <>
              {/* The live-core hole: the panel spans the globe area, so it
                  carries this mask or the aperture would just show its opaque
                  fill. */}
              <mask id={id("hole")}>
                <rect x="0" y="0" width="1400" height="320" fill="#ffffff" />
                <circle cx="176" cy="160" r="138" fill="#000000" />
              </mask>
            </>
          )}
        </defs>

        <g data-layer="panel" mask={liveCore ? `url(#${id("hole")})` : undefined}>
          <path d={PANEL} fill={`url(#${id("panel")})`} stroke={border} strokeWidth="2.4" />
          <g clipPath={`url(#${id("panel-clip")})`} opacity="0.14" stroke={accent} strokeWidth="1">
            <path d="M400 58 V218 M500 58 V218 M600 58 V218 M700 58 V218 M800 58 V218 M900 58 V218 M1000 58 V218 M1100 58 V218 M1200 58 V218 M1300 58 V218" />
          </g>
          <g clipPath={`url(#${id("scan-clip")})`}>
            <rect
              data-gods-anim=""
              x="380"
              y="60"
              width="110"
              height="186"
              fill={`url(#${id("scan")})`}
              opacity="0.16"
              style={anim("gbSweep 5.5s linear infinite")}
            />
          </g>
        </g>

        <g data-layer="globe-bezel" fill="none">
          <circle cx="176" cy="160" r="158" stroke={border} strokeWidth="2.4" />
          <circle cx="176" cy="160" r="152" stroke={border} strokeWidth="1.4" opacity="0.78" />
          <circle
            data-gods-anim=""
            cx="176"
            cy="160"
            r="140"
            stroke={accent}
            strokeWidth="1"
            strokeDasharray="2 9"
            opacity="0.5"
            style={{ transformOrigin: "176px 160px", ...anim("gbSpin 42s linear infinite") }}
          />
          <circle
            data-gods-anim=""
            cx="176"
            cy="160"
            r="146"
            stroke={border}
            strokeWidth="6"
            strokeDasharray="36 230"
            style={{ transformOrigin: "176px 160px", ...anim("gbSpinRev 18s linear infinite") }}
          />
          <g stroke={accent} strokeWidth="2" opacity="0.85">
            <path d="M8 160 h22" />
            <path d="M322 160 h22" />
          </g>
          <g stroke={accent} strokeWidth="1.6" opacity="0.45">
            <path d="M64 48 l16 16" />
            <path d="M288 48 l-16 16" />
            <path d="M64 272 l16 -16" />
            <path d="M288 272 l-16 -16" />
          </g>
          {/* Keep the entire orbit visible over the live globe. Occluding its
              back half looked like broken artwork after stream compression. */}
          <g>
            <ellipse cx="176" cy="160" rx="180" ry="62" transform="rotate(-27 176 160)" stroke={titleColor} strokeWidth="2.4" opacity="0.9" />
            <ellipse
              data-gods-anim=""
              cx="176"
              cy="160"
              rx="173"
              ry="55"
              transform="rotate(-27 176 160)"
              stroke={accent}
              strokeWidth="1.1"
              opacity="0.5"
              strokeDasharray="30 12"
              style={anim("gbDash 6s linear infinite")}
            />
          </g>
        </g>

        {/* Status pulse dot — animated, so it lives here with the other motion. */}
        <g data-layer="status-pulse">
          <rect data-gods-anim="" x="384" y="144" width="9" height="9" fill={accent} style={anim("gbPulse 1.8s ease-in-out infinite")} />
        </g>
      </svg>

      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 1400 320"
        aria-hidden="true"
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", display: "block" }}
      >
        <defs>
          <linearGradient id={id("hairline")} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor={accent} stopOpacity="0.06" />
            <stop offset="0.3" stopColor={accent} stopOpacity="0.8" />
            <stop offset="1" stopColor={accent} stopOpacity="0.06" />
          </linearGradient>
        </defs>

        {(ticker || countdown) && (
          <g data-layer="ticker" style={{ userSelect: "none" }}>
            <path d="M382 232 l9 -6 v12 z" fill={accent} opacity="0.8" />
            <text x="402" y="236" fill={dimColor} fontFamily={MONO} fontSize="14" letterSpacing="1.4">
              {ticker}
            </text>
            {/* Countdown to the next cut replaces the tape filler while live —
                both anchored right so a long up-next line can't collide. */}
            <text x="1146" y="236" textAnchor="end" fill={countdown ? mutedColor : dimColor} fontFamily={MONO} fontSize="13" letterSpacing="1.4">
              {countdown
                ? `NEXT IN ${countdown}`
                : version
                  ? `VIGIL TAPE · 24 H · ${version}`
                  : "VIGIL TAPE · 24 H"}
            </text>
          </g>
        )}

        <g data-layer="title" style={{ userSelect: "none" }}>
          <text x="340" y="113" fill={titleColor} fontFamily={SANS} fontSize="56" fontWeight="600" letterSpacing="0">
            {title}
          </text>
          <path d="M384 138 H1340" stroke={`url(#${id("hairline")})`} strokeWidth="1.6" />
          <g stroke={accent} opacity="0.4" strokeWidth="1">
            <path d="M384 138 v-7 M434 138 v-4 M484 138 v-4 M534 138 v-7 M584 138 v-4 M634 138 v-4 M684 138 v-7 M734 138 v-4 M784 138 v-4 M834 138 v-7 M884 138 v-4 M934 138 v-4 M984 138 v-7 M1034 138 v-4 M1084 138 v-4 M1134 138 v-7 M1184 138 v-4 M1234 138 v-4 M1284 138 v-7 M1334 138 v-4" />
          </g>
        </g>

        <g data-layer="status" style={{ userSelect: "none" }}>
          {channels.map((channel, i) => (
            <text
              key={channel}
              x={408 + i * 154}
              y="159"
              fill={i === 0 ? accent : mutedColor}
              fontFamily={SANS}
              fontSize="30"
              fontWeight={i === 0 ? 600 : 500}
              letterSpacing="4.5"
            >
              {channel}
            </text>
          ))}
          <path d="M846 157 H884" stroke={border} strokeWidth="1.4" />
          {coords && (
            <>
              <text x="892" y="163" fill={dimColor} fontFamily={MONO} fontSize="18" fontWeight="500" letterSpacing="1">
                LAT
              </text>
              <text x="938" y="163" fill={textColor} fontFamily={MONO} fontSize="18" fontWeight="500" letterSpacing="1">
                {coords.lat.toFixed(3)}
              </text>
              <text x="1028" y="163" fill={dimColor} fontFamily={MONO} fontSize="18" fontWeight="500" letterSpacing="1">
                LON
              </text>
              <text x="1074" y="163" fill={textColor} fontFamily={MONO} fontSize="18" fontWeight="500" letterSpacing="1">
                {coords.lon.toFixed(3)}
              </text>
            </>
          )}
          {clock && (
            <>
              <path d="M1184 150 v16" stroke={border} strokeWidth="1.4" />
              <text x="1340" y="163" textAnchor="end" fill={textColor} fontFamily={MONO} fontSize="18" fontWeight="500" letterSpacing="1">
                {times.utc}
              </text>
              <text x="1340" y="184" textAnchor="end" fill={mutedColor} fontFamily={MONO} fontSize="17" fontWeight="500" letterSpacing="0.8">
                {times.cities}
              </text>
            </>
          )}
        </g>
      </svg>
    </div>
  );
}
