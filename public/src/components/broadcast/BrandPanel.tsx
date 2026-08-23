"use client";

/**
 * Top-left identity block: the channel mark, a pulsing LIVE badge and a world
 * clock strip. Purely decorative (pointer-inert).
 */
import { useEffect, useState } from "react";
import { DEFAULT_THEME, type BroadcastTheme } from "./config";

const WORLD_CLOCKS = [
  { label: "LONDON", timeZone: "Europe/London" },
  { label: "NEW YORK", timeZone: "America/New_York" },
  { label: "BEIJING", timeZone: "Asia/Shanghai" },
  { label: "TOKYO", timeZone: "Asia/Tokyo" },
  { label: "MOSCOW", timeZone: "Europe/Moscow" },
] as const;

/** Live operator readout for the top-left block: the on-air shot (its kind as the
 *  field label, its target/title as the value) and the weather attribute painted
 *  on the globe. So an aircraft shot reads "AIRCRAFT · Air Force One" and a
 *  country shot reads "COUNTRIES · United Kingdom". */
export interface BrandStatus {
  /** On-air shot kind, used as the readout's field label (e.g. "Aircraft"). */
  shotKind: string | null;
  /** The shot's target/title, used as the value (e.g. "Air Force One", a
   *  country name). Null when nothing's on air. */
  shotTarget: string | null;
  /** Human label for the active weather attribute, or null. */
  attribute: string | null;
}

function StatusReadout({
  status,
  theme,
}: {
  status: BrandStatus;
  theme: BroadcastTheme;
}) {
  const cells = [
    ...(status.shotKind
      ? [{ label: status.shotKind, value: status.shotTarget ?? "—" }]
      : []),
    { label: "MAP", value: status.attribute ?? "—" },
  ];
  return (
    <div
      style={{
        display: "flex",
        alignItems: "stretch",
        gap: 6,
        padding: "5px 11px",
        background:
          "linear-gradient(180deg, rgba(8,13,24,0.72), rgba(5,9,18,0.84))",
        border: theme.panelBorder,
        borderRadius: 7,
        boxShadow: "0 8px 22px rgba(0,0,0,0.34)",
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
        fontFamily: "system-ui, sans-serif",
      }}
    >
      {cells.map((cell, i) => (
        <div
          key={cell.label}
          style={{
            display: "flex",
            alignItems: "baseline",
            gap: 4,
            ...(i > 0
              ? {
                  borderLeft: "1px solid rgba(255,255,255,0.09)",
                  paddingLeft: 7,
                }
              : {}),
          }}
        >
          <span
            style={{
              fontSize: 9.4,
              fontWeight: 800,
              letterSpacing: 0.9,
              color: theme.accent,
              opacity: 0.85,
              textTransform: "uppercase",
            }}
          >
            {cell.label}
          </span>
          <span
            style={{
              fontSize: 12.1,
              fontWeight: 700,
              letterSpacing: 0.3,
              color: "#dce9fb",
              whiteSpace: "nowrap",
              textTransform: "uppercase",
            }}
          >
            {cell.value}
          </span>
        </div>
      ))}
    </div>
  );
}

type WorldClockReading = {
  label: string;
  time: string;
};

function buildWorldClocks(date: Date): WorldClockReading[] {
  return WORLD_CLOCKS.map((clock) => ({
    label: clock.label,
    time: date.toLocaleTimeString("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
      timeZone: clock.timeZone,
    }),
  }));
}

/** City clocks tick each second. Start with labels only so server and client
 *  first-render match; fill the times on mount. */
function useWorldClocks(): WorldClockReading[] {
  const [clocks, setClocks] = useState<WorldClockReading[]>(() =>
    WORLD_CLOCKS.map((clock) => ({ label: clock.label, time: "" })),
  );
  useEffect(() => {
    const tick = () => setClocks(buildWorldClocks(new Date()));
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, []);
  return clocks;
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
  live = false,
  status = null,
  stripDrop = 0,
}: {
  theme?: BroadcastTheme;
  compact?: boolean;
  /** Show the pulsing LIVE badge — true only while the auto-director is
   *  actively driving the broadcast; an idle/off director isn't "on air". */
  live?: boolean;
  /** Operator readout (on-air shot + active attribute) shown under the mark.
   *  Null hides the strip. */
  status?: BrandStatus | null;
  /** Extra space (pre-scale px) between the banner and the readout/clock strip —
   *  BroadcastFrame threads the top crawl band through this gap, so the strip
   *  lands BELOW the crawl instead of colliding with it. */
  stripDrop?: number;
}) {
  const clocks = useWorldClocks();
  const usesGodsBanner = theme.name === "G.O.D.S.";
  const bannerWidth = compact ? 400 : 620;
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 8,
        pointerEvents: "none",
      }}
    >
      <style>
        {"@keyframes bcast-livepulse{0%,100%{opacity:1}50%{opacity:0.35}}"}
      </style>
      {usesGodsBanner ? (
        <img
          src="/gods_banner_transparent.png"
          alt={`${theme.name} ${theme.tagline}`}
          style={{
            display: "block",
            width: bannerWidth,
            height: "auto",
            // The banner PNG is tightly cropped (no baked frame), so it stacks
            // directly with the readout/clock strip beneath it — no margin fixup.
            filter: "drop-shadow(0 8px 26px rgba(0,0,0,0.5))",
          }}
        />
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
            backdropFilter: "blur(8px)",
            WebkitBackdropFilter: "blur(8px)",
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
                fontFamily: "system-ui, sans-serif",
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
                fontFamily: "system-ui, sans-serif",
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
                  fontFamily: "system-ui, sans-serif",
                }}
              >
                {theme.strapline}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Operator readout + world clocks on one left-aligned strip beneath the
          banner — small, single line, hugging the screen's left edge. stripDrop
          opens a gap for the top crawl band to run between banner and strip. */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          flexWrap: "nowrap",
          marginTop: -6 + stripDrop,
        }}
      >
        {live && (
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "4px 10px 4px 8px",
              clipPath:
                "polygon(6px 0, 100% 0, 100% calc(100% - 6px), calc(100% - 6px) 100%, 0 100%, 0 6px)",
              background:
                "linear-gradient(180deg, rgba(40,6,6,0.95), rgba(20,3,3,0.95))",
              // NB: the glow relies on hex+alpha suffixes, so liveColor should
              // stay a 6-digit hex (the admin swatch only produces those).
              border: `1px solid ${theme.liveColor}8c`,
              fontFamily: "system-ui, sans-serif",
              fontSize: 12.1,
              fontWeight: 800,
              letterSpacing: 1.5,
              color: "#fff",
              textShadow: `0 0 8px ${theme.liveColor}cc`,
              boxShadow: `0 0 14px ${theme.liveColor}73, inset 0 0 8px ${theme.liveColor}33`,
            }}
          >
            <span
              style={{
                width: 7,
                height: 7,
                borderRadius: "50%",
                background: "#fff",
                boxShadow: `0 0 6px ${theme.liveColor}`,
                animation: "bcast-livepulse 1.4s ease-in-out infinite",
              }}
            />
            LIVE
          </div>
        )}
        {status && <StatusReadout status={status} theme={theme} />}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: `repeat(${WORLD_CLOCKS.length}, minmax(0, 1fr))`,
            gap: 6,
            padding: "7px 12px",
            background:
              "linear-gradient(180deg, rgba(8,13,24,0.72), rgba(5,9,18,0.84))",
            border: theme.panelBorder,
            borderRadius: 10,
            boxShadow: "0 8px 22px rgba(0,0,0,0.34)",
            backdropFilter: "blur(8px)",
            WebkitBackdropFilter: "blur(8px)",
          }}
        >
          {clocks.map((clock, i) => {
            // London (the first clock) is the home reading — keep it at full
            // size; the other cities ride along smaller.
            const primary = i === 0;
            return (
              <div
                key={clock.label}
                style={{
                  minWidth: 0,
                  display: "flex",
                  flexDirection: "column",
                  gap: 2,
                  alignItems: "center",
                }}
              >
                <span
                  style={{
                    maxWidth: "100%",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    fontFamily: "system-ui, sans-serif",
                    fontSize: primary ? 8.8 : 7.2,
                    fontWeight: 800,
                    letterSpacing: 0.7,
                    color: theme.accent,
                    opacity: 0.9,
                  }}
                >
                  {clock.label}
                </span>
                <span
                  style={{
                    fontFamily:
                      "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
                    fontSize: primary
                      ? compact
                        ? 11.6
                        : 13.8
                      : compact
                        ? 9.4
                        : 11,
                    fontWeight: 700,
                    letterSpacing: 0,
                    color: "#dce9fb",
                    fontVariantNumeric: "tabular-nums",
                    textShadow: "0 1px 2px rgba(0,0,0,0.8)",
                  }}
                >
                  {clock.time || "--:--:--"}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
