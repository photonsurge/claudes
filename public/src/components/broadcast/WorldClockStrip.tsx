"use client";

/**
 * The five-city world clock strip (London is the home reading, four world
 * capitals ride along smaller), ticking each second. Docked in the masthead
 * map plate (IntensityMeter's `clocks` slot); `framed` wraps it in its own
 * dark pill for standalone use.
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

export default function WorldClockStrip({
  theme = DEFAULT_THEME,
  scale = 1,
  framed = true,
}: {
  theme?: BroadcastTheme;
  /** Font/spacing multiplier over the strip's design-px base sizes. */
  scale?: number;
  /** Wrap the strip in its own dark pill; off when it's embedded in an
   *  existing plate (the masthead map widget). */
  framed?: boolean;
}) {
  const clocks = useWorldClocks();
  const grid = (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(${WORLD_CLOCKS.length}, minmax(0, 1fr))`,
        gap: 6 * scale,
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
                fontSize: (primary ? 8.8 : 7.2) * scale,
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
                fontSize: (primary ? 13.8 : 11) * scale,
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
  );
  if (!framed) return grid;
  return (
    <div
      style={{
        padding: "7px 12px",
        background:
          "linear-gradient(180deg, rgba(8,13,24,0.72), rgba(5,9,18,0.84))",
        border: theme.panelBorder,
        borderRadius: 10,
        boxShadow: "0 8px 22px rgba(0,0,0,0.34)",
        backdropFilter: "var(--panel-blur, blur(8px))",
        WebkitBackdropFilter: "var(--panel-blur, blur(8px))",
      }}
    >
      {grid}
    </div>
  );
}
