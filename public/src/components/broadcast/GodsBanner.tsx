import { useId, type CSSProperties } from "react";

const DEFAULT_ACCENT = "#20d8ff";

function mixHex(color: string, target: "#000000" | "#ffffff", amount: number): string {
  const match = /^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(color);
  if (!match) return color;
  const targetChannel = target === "#ffffff" ? 255 : 0;
  const channel = (value: string) =>
    Math.round(Number.parseInt(value, 16) * (1 - amount) + targetChannel * amount)
      .toString(16)
      .padStart(2, "0");
  return `#${channel(match[1])}${channel(match[2])}${channel(match[3])}`;
}

export interface GodsBannerProps {
  /** Main scene colour. Omitting it preserves the supplied artwork's cyan. */
  accent?: string;
  /** Optional lighter/deeper palette stops for callers that need exact control. */
  accentSoft?: string;
  accentDeep?: string;
  /** Main title ink; defaults to the artwork's silver. */
  titleColor?: string;
  width?: number | string;
  className?: string;
  style?: CSSProperties;
  label?: string;
  /**
   * Punch a transparent hole where the static sphere sits so a live globe
   * layered BEHIND the svg shows through, keeping every ring/ellipse as a
   * bezel drawn over it. The hole is r=74 around (217,144); see BrandPanel.
   */
  liveCore?: boolean;
}

/**
 * Editable G.O.D.S. masthead artwork rendered as native SVG. Its accent follows
 * the active broadcast scene while every optional colour falls back to the
 * original gods-editable-logo-v2.svg palette.
 */
export default function GodsBanner({
  accent: accentProp,
  accentSoft: accentSoftProp,
  accentDeep: accentDeepProp,
  titleColor,
  width = "100%",
  className,
  style,
  label = "G.O.D.S. Global Orbital Detection System",
  liveCore = false,
}: GodsBannerProps) {
  const instanceId = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const id = (name: string) => `gods-${name}-${instanceId}`;
  const accent = accentProp ?? DEFAULT_ACCENT;
  // Supplying just a scene accent recolours the whole luminous family. With no
  // scene colour, retain the editable source's original three-tone cyan ramp.
  const accentSoft = accentSoftProp ?? (accentProp ? mixHex(accent, "#ffffff", 0.35) : "#68eaff");
  const accentDeep = accentDeepProp ?? (accentProp ? mixHex(accent, "#000000", 0.55) : "#083a72");
  const titleTop = titleColor ? mixHex(titleColor, "#ffffff", 0.35) : "#ffffff";
  const titleMid = titleColor ?? "#e6edf0";
  const titleBottom = titleColor ? mixHex(titleColor, "#000000", 0.35) : "#8ea2aa";

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={width}
      height="auto"
      viewBox="0 0 1948 291"
      role="img"
      aria-label={label}
      className={className}
      style={style}
    >
      <defs>
        <linearGradient id={id("frame-metal")} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#d6eef5" />
          <stop offset="0.18" stopColor="#355b68" />
          <stop offset="0.52" stopColor="#0a1d25" />
          <stop offset="0.82" stopColor="#426b78" />
          <stop offset="1" stopColor="#d5f0f7" />
        </linearGradient>
        <linearGradient id={id("title-silver")} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={titleTop} />
          <stop offset="0.55" stopColor={titleMid} />
          <stop offset="1" stopColor={titleBottom} />
        </linearGradient>
        <radialGradient id={id("globe-fill")} cx="45%" cy="38%" r="68%">
          <stop offset="0" stopColor={accentSoft} />
          <stop offset="0.35" stopColor={accent} />
          <stop offset="0.7" stopColor={accentDeep} />
          <stop offset="1" stopColor="#010c18" />
        </radialGradient>
        <filter id={id("cyan-glow")} x="-80%" y="-80%" width="260%" height="260%">
          <feGaussianBlur stdDeviation="4" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <filter id={id("soft-glow")} x="-100%" y="-100%" width="300%" height="300%">
          <feGaussianBlur stdDeviation="8" />
        </filter>
      </defs>

      <g data-layer="outer-frame">
        <path
          d="M67 2 H1857 L1893 18 L1943 68 L1944 174 L1910 213 L1877 226 H1261 L1208 273 H589 L573 289 H69 L40 266 L3 214 L3 71 L28 35 Z"
          fill={`url(#${id("frame-metal")})`}
          stroke="#bce8f5"
          strokeWidth="2"
        />
        <path
          d="M73 15 H1849 L1881 29 L1927 75 V165 L1899 198 L1869 211 H1252 L1198 259 H574 L558 275 H77 L52 255 L18 207 V80 L40 48 Z"
          fill="#07151e"
          stroke="#163c4d"
          strokeWidth="2"
        />
      </g>

      <g data-layer="top-panel">
        <path
          d="M330 28 H1855 L1889 39 L1920 73 V159 L1889 193 H399 L361 174 H330 Z"
          fill="#020912"
          stroke={accentDeep}
          strokeWidth="2"
        />
        <path d="M352 40 H1850" stroke={accent} strokeWidth="3" opacity="0.9" filter={`url(#${id("cyan-glow")})`} />
        <path d="M1787 197 H1860" stroke={accent} strokeWidth="4" filter={`url(#${id("cyan-glow")})`} />
        <circle cx="1787" cy="197" r="4" fill={accent} filter={`url(#${id("cyan-glow")})`} />
        <g fill={accent} opacity="0.9">
          {[1810, 1820, 1830, 1840, 1850, 1860].map((x) => (
            <rect key={x} x={x} y="177" width="3" height="7" />
          ))}
        </g>
      </g>

      <g data-layer="globe">
        {liveCore ? (
          // Annulus: outer disc + r=74 hole (evenodd) so the live canvas
          // layered behind the svg shows through; the inner rim's stroke
          // doubles as a bezel masking the canvas disc's edge.
          <path
            d="M94 144a123 123 0 1 0 246 0a123 123 0 1 0-246 0M143 144a74 74 0 1 0 148 0a74 74 0 1 0-148 0"
            fillRule="evenodd"
            fill="#02101a"
            stroke="#274b5b"
            strokeWidth="5"
          />
        ) : (
          <circle cx="217" cy="144" r="123" fill="#02101a" stroke="#274b5b" strokeWidth="5" />
        )}
        <circle cx="217" cy="144" r="112" fill="none" stroke={accent} strokeWidth="1.8" opacity="0.72" />
        <circle cx="217" cy="144" r="99" fill="none" stroke={accentDeep} strokeWidth="1.2" strokeDasharray="3 8" opacity="0.85" />
        <g stroke={accent} filter={`url(#${id("cyan-glow")})`}>
          {liveCore ? (
            // Crosshair stops at the hole edge instead of streaking across
            // the live globe.
            <>
              <line x1="217" y1="18" x2="217" y2="66" strokeWidth="2" />
              <line x1="217" y1="222" x2="217" y2="270" strokeWidth="2" />
              <line x1="60" y1="144" x2="139" y2="144" strokeWidth="2" />
              <line x1="295" y1="144" x2="364" y2="144" strokeWidth="2" />
            </>
          ) : (
            <>
              <line x1="217" y1="18" x2="217" y2="270" strokeWidth="2" />
              <line x1="60" y1="144" x2="364" y2="144" strokeWidth="2" />
            </>
          )}
        </g>
        {!liveCore && (
          <>
            <circle cx="217" cy="144" r="76" fill={`url(#${id("globe-fill")})`} stroke={accentSoft} strokeWidth="1.2" />
            <g fill="none" stroke={accentSoft} opacity="0.4">
              <ellipse cx="217" cy="144" rx="74" ry="24" />
              <ellipse cx="217" cy="144" rx="74" ry="48" />
              <ellipse cx="217" cy="144" rx="35" ry="75" />
              <ellipse cx="217" cy="144" rx="58" ry="75" />
              <line x1="143" y1="144" x2="291" y2="144" />
            </g>
            <g data-layer="continents" fill={accentSoft} opacity="0.88">
              <path d="M191 83 l15 -8 22 2 8 8 19 3 6 7 -12 8 -13 -2 -7 10 -13 1 -8 -7 -8 3 -9 -9 z" />
              <path d="M170 98 l9 -5 11 4 -1 10 8 8 -5 9 -14 2 -9 12 -12 -3 -1 -11 8 -8 -3 -9 z" />
              <path d="M211 120 l18 -4 12 7 9 1 9 11 -5 10 -12 2 -7 8 -11 -1 -5 -11 -11 -5 z" />
              <path d="M239 151 l12 -3 13 8 5 12 -8 8 -6 17 -12 5 -6 -14 -9 -10 5 -11 z" />
              <path d="M181 150 l12 -5 12 5 -1 12 -8 8 -3 18 -11 10 -7 -14 3 -13 -5 -8 z" />
            </g>
          </>
        )}
        <ellipse cx="217" cy="144" rx="119" ry="43" transform="rotate(-29 217 144)" fill="none" stroke="#e9fbff" strokeWidth="3.1" />
        <ellipse cx="217" cy="144" rx="116" ry="40" transform="rotate(-29 217 144)" fill="none" stroke={accent} strokeWidth="1.2" opacity="0.8" />
        {!liveCore && (
          <>
            <circle cx="225" cy="171" r="4" fill="#ffffff" />
            <circle cx="225" cy="171" r="12" fill={accentSoft} opacity="0.75" filter={`url(#${id("soft-glow")})`} />
          </>
        )}
      </g>

      <g data-layer="lower-panel">
        <path
          d="M401 178 H1217 L1258 211 H1212 L1174 254 H587 L567 272 H348 L382 236 Z"
          fill="#04111a"
          stroke={accentDeep}
          strokeWidth="2"
        />
        <path d="M397 179 H1210" stroke={accent} strokeWidth="1.7" opacity="0.75" />
        <path d="M718 218 H1190" stroke={accent} strokeWidth="2.3" filter={`url(#${id("cyan-glow")})`} />
        <circle cx="718" cy="218" r="5" fill={accent} filter={`url(#${id("cyan-glow")})`} />
        <path d="M1190 213 v10" stroke={accentDeep} strokeWidth="3" />
        <g transform="translate(426 204) skewX(-28)" fill={accent}>
          <rect width="38" height="20" rx="2" />
          <rect x="47" width="38" height="20" rx="2" />
          <rect x="94" width="38" height="20" rx="2" />
        </g>
        <g stroke={accent} opacity="0.55">
          <path d="M365 250 h42" />
          <path d="M377 258 h30" />
          <path d="M389 266 h18" />
        </g>
      </g>

      <g data-layer="text" style={{ userSelect: "none" }}>
        <text
          x="417"
          y="139"
          fill={`url(#${id("title-silver")})`}
          fontFamily='"Orbitron", "Eurostile", "Bank Gothic", "Arial Narrow", sans-serif'
          fontSize="58"
          fontWeight="500"
          letterSpacing="13"
        >
          GLOBAL ORBITAL DETECTION SYSTEM
        </text>
        <text
          x="590"
          y="226"
          fill={accent}
          fontFamily='"Orbitron", "Eurostile", "Bank Gothic", "Arial Narrow", sans-serif'
          fontSize="31"
          fontWeight="600"
          letterSpacing="9"
        >
          G.O.D.S.
        </text>
      </g>

      <g data-layer="micro-detail" fill={accent} opacity="0.8">
        <rect x="344" y="27" width="30" height="2" />
        <rect x="382" y="27" width="8" height="2" />
        <rect x="398" y="27" width="5" height="2" />
        <rect x="407" y="27" width="3" height="2" />
        <rect x="1820" y="34" width="35" height="3" />
        <rect x="1858" y="34" width="7" height="3" />
      </g>
    </svg>
  );
}
