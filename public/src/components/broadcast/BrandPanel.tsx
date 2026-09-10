"use client";

/**
 * Top-left identity block. Purely decorative (pointer-inert). Shot/map status
 * lives in the event deck and masthead, so it is deliberately not repeated
 * beneath the mark.
 */
import { DEFAULT_THEME, type BroadcastTheme } from "./config";
import GodsBanner from "./GodsBanner";
import SubGlobeWidget from "./SubGlobeWidget";
import { UI_SANS } from "../../lib/fonts";

/** GodsBanner viewBox geometry the live core must line up with. */
const BANNER_VIEW_W = 1400;
const BANNER_GLOBE_CX = 176;
const BANNER_GLOBE_CY = 160;
/** Canvas core radius in viewBox units. drawSubGlobe insets its disc 6%
 *  (r = 0.94·half), so 149 paints the planet's limb at ≈140 — exactly under
 *  the banner's dashed r=140 bezel ring, with the r=146/152/158 rings tiered
 *  OUTSIDE the globe as its frame. The svg's mask hole (r=138) sits just
 *  inside the limb so the panel never peeks between disc and ring. */
const BANNER_CORE_R = 149;

/** Camera-anchor bundle that turns the banner's globe into the live locator. */
export interface BrandLiveGlobe {
  center: [number, number];
  zoom: number;
  autoSpin?: boolean;
  spinSpeed?: number;
  spinEpoch?: number;
  accent?: string;
}

/** Globe + satellite-ring monogram used by themes with iconVariant "orbit". */
function OrbitMark({ size, accent }: { size: number; accent: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden>
      <defs>
        <radialGradient id="gods-globe" cx="35%" cy="30%" r="75%">
          <stop offset="0%" stopColor="#bfe6ff" />
          <stop offset="45%" stopColor={accent} />
          <stop offset="100%" stopColor="#08182c" />
        </radialGradient>
      </defs>
      <g transform="rotate(-18 20 21)">
        <ellipse
          cx="20"
          cy="21"
          rx="16"
          ry="5.5"
          fill="none"
          stroke="#a8c6e0"
          strokeWidth="1.6"
          strokeDasharray="36 36"
          strokeDashoffset="18"
          opacity="0.5"
        />
      </g>
      <circle
        cx="20"
        cy="20"
        r="11"
        fill="url(#gods-globe)"
        stroke="#7fd0ff"
        strokeWidth="0.6"
      />
      <path
        d="M9.5 20a10.5 4 0 0 0 21 0"
        fill="none"
        stroke="#123a5c"
        strokeWidth="0.6"
        opacity="0.6"
      />
      <g transform="rotate(-18 20 21)">
        <ellipse
          cx="20"
          cy="21"
          rx="16"
          ry="5.5"
          fill="none"
          stroke="#dff1ff"
          strokeWidth="1.6"
          strokeDasharray="36 36"
          strokeDashoffset="0"
        />
        <rect
          x="27.4"
          y="8.6"
          width="2.6"
          height="2.6"
          rx="0.6"
          fill="#e8f4ff"
        />
      </g>
    </svg>
  );
}

export default function BrandPanel({
  theme = DEFAULT_THEME,
  compact = false,
  liveGlobe,
  ticker,
  nextCutAt,
  channels,
}: {
  theme?: BroadcastTheme;
  compact?: boolean;
  /** When set, the banner's globe aperture becomes the live locator
   *  sub-globe (canvas layered BEHIND the svg, showing through its hole).
   *  Omitted → the aperture stays an empty bezel (admin previews, tests). */
  liveGlobe?: BrandLiveGlobe;
  /** Lower-notch tape line (e.g. the director's real up-next hint). */
  ticker?: string;
  /** Wall-clock ms the current shot ends — the tape row's NEXT IN countdown. */
  nextCutAt?: number | null;
  /** Status chips — this channel's display name (first chip reads active). */
  channels?: string[];
}) {
  const usesGodsBanner = theme.name === "G.O.D.S.";
  // ×1.5 BroadcastFrame stage scale → 1140 stream px (the design spec's
  // 760 grew 50% on operator request).
  const bannerWidth = compact ? 495 : 760;
  const bannerScale = bannerWidth / BANNER_VIEW_W;
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 8,
        pointerEvents: "none",
      }}
    >
      {usesGodsBanner ? (
        <div style={{ position: "relative" }}>
          {liveGlobe && (
            // Live locator planet sunk BEHIND the banner svg: the svg's
            // liveCore hole lets it show through while every ring/ellipse
            // stays on top as the bezel.
            <div
              style={{
                position: "absolute",
                left: (BANNER_GLOBE_CX - BANNER_CORE_R) * bannerScale,
                top: (BANNER_GLOBE_CY - BANNER_CORE_R) * bannerScale,
              }}
            >
              <SubGlobeWidget
                size={2 * BANNER_CORE_R * bannerScale}
                showReadout={false}
                center={liveGlobe.center}
                zoom={liveGlobe.zoom}
                autoSpin={liveGlobe.autoSpin}
                spinSpeed={liveGlobe.spinSpeed}
                spinEpoch={liveGlobe.spinEpoch}
                accent={liveGlobe.accent}
                theme={theme}
              />
            </div>
          )}
          <GodsBanner
            accent={theme.accent}
            border={theme.godsBorderColor}
            panelTopColor={theme.godsPanelTopColor}
            panelMidColor={theme.godsPanelMidColor}
            panelBottomColor={theme.godsPanelBottomColor}
            titleColor={theme.titleColor}
            textColor={theme.textColor}
            mutedColor={theme.mutedColor}
            dimColor={theme.dimColor}
            label={`${theme.name} ${theme.tagline}`}
            width={bannerWidth}
            liveCore={!!liveGlobe}
            coords={liveGlobe ? { lat: liveGlobe.center[1], lon: liveGlobe.center[0] } : null}
            ticker={ticker}
            nextAt={nextCutAt}
            channels={channels}
            style={{
              // Positioned so the svg stacks OVER the absolute live canvas.
              position: "relative",
              filter: "drop-shadow(0 8px 26px rgba(0,0,0,0.5))",
            }}
          />
        </div>
      ) : (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: compact ? 8 : 11,
            padding: compact ? "7px 11px" : "9px 14px",
            background: theme.panelBg,
            border: theme.panelBorder,
            borderRadius: 12,
            boxShadow: "0 8px 26px rgba(0,0,0,0.45)",
            backdropFilter: "var(--panel-blur, blur(8px))",
            WebkitBackdropFilter: "var(--panel-blur, blur(8px))",
          }}
        >
          {/* Monogram mark */}
          {theme.iconVariant === "orbit" ? (
            <OrbitMark size={compact ? 26 : 34} accent={theme.accent} />
          ) : (
            <svg
              width={compact ? 26 : 34}
              height={compact ? 26 : 34}
              viewBox="0 0 40 40"
              aria-hidden
            >
              <circle
                cx="20"
                cy="20"
                r="18"
                fill="none"
                stroke={theme.accent}
                strokeWidth="2"
              />
              <circle cx="20" cy="20" r="18" fill="rgba(120,190,255,0.06)" />
              <path
                d="M13 12h9a6 6 0 0 1 0 12h-9z M22 24l6 5"
                fill="none"
                stroke="#cfe2ff"
                strokeWidth="2.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          )}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              lineHeight: 1.15,
            }}
          >
            <span
              style={{
                fontSize: compact ? 16.5 : 20.9,
                fontWeight: 800,
                letterSpacing: 1.3,
                color: "#fff",
                fontFamily: UI_SANS,
              }}
            >
              {theme.name}
            </span>
            <span
              style={{
                fontSize: compact ? 9.4 : 11,
                fontWeight: 700,
                letterSpacing: 1.2,
                color: "#8fb6e6",
                opacity: 0.8,
                fontFamily: UI_SANS,
              }}
            >
              {theme.tagline}
            </span>
            {theme.strapline && !compact && (
              <span
                style={{
                  fontSize: 8.8,
                  fontWeight: 600,
                  letterSpacing: 1.4,
                  color: "#5f87ad",
                  opacity: 0.85,
                  marginTop: 1,
                  fontFamily: UI_SANS,
                }}
              >
                {theme.strapline}
              </span>
            )}
          </div>
        </div>
      )}

    </div>
  );
}
