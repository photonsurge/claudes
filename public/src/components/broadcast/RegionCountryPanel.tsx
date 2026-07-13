"use client";

/**
 * The per-country slide of a region ("area") spotlight — ONE member country per
 * card, with its own weather and a 72-hour forecast graph. The region deck pushes
 * one of these for each of the region's biggest member countries; the data is
 * composed server-side onto the focus bundle (`FocusRegionCountry`, one worker
 * forecast sample per country at its biggest in-region city), so the card just
 * renders — no per-country fetch at cut time.
 *
 * The 3-hourly today..+72h track is drawn as temperature + wind MiniCharts (the
 * same chart the AREA HISTORY slide uses, pointed at the future) above the current
 * reading. Pure presentation inside the scaled broadcast stage.
 */
import type { FocusRegionCountry } from "../../lib/focus/types";
import { DEFAULT_THEME, type BroadcastTheme } from "./config";
import BroadcastCard from "./BroadcastCard";
import { MiniChart, formatReading, type SparkPoint } from "./PointHistoryPanel";
import { WeatherGlyph } from "./glyphs";

/** ISO-3166 alpha-2 (any case) → flag emoji, or "" for a missing/short code. */
function flagEmoji(cc?: string): string {
  if (!cc || cc.length !== 2) return "";
  const BASE = 0x1f1e6; // regional-indicator "A"
  const up = cc.toUpperCase();
  return String.fromCodePoint(BASE + up.charCodeAt(0) - 65, BASE + up.charCodeAt(1) - 65);
}

export default function RegionCountryPanel({
  country,
  rank,
  total,
  color = "#4a8f6f",
  theme = DEFAULT_THEME,
}: {
  country: FocusRegionCountry;
  /** 1-based position among the region's ranked countries (for the "1/5" tag). */
  rank?: number;
  total?: number;
  color?: string;
  theme?: BroadcastTheme;
}) {
  const steps = country.steps;
  const tempPts: SparkPoint[] = steps.map((s) => ({ t: s.t, value: s.temp }));
  const windPts: SparkPoint[] = steps.map((s) => ({ t: s.t, value: s.wind }));
  const now = steps.find((s) => s.temp != null) ?? steps[0];
  const temps = steps.map((s) => s.temp).filter((v): v is number => v != null);
  const hi = temps.length ? Math.max(...temps) : null;
  const lo = temps.length ? Math.min(...temps) : null;
  const avgTemp = temps.length ? temps.reduce((a, b) => a + b, 0) / temps.length : null;
  const winds = steps.map((s) => s.wind).filter((v): v is number => v != null);
  const avgWind = winds.length ? winds.reduce((a, b) => a + b, 0) / winds.length : null;

  return (
    <BroadcastCard
      accent={color}
      eyebrow="Country"
      headerRight={
        rank && total ? (
          <span style={{ fontSize: 10, fontWeight: 750, letterSpacing: 1, color }}>{`${rank}/${total}`}</span>
        ) : null
      }
      theme={theme}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <span style={{ fontSize: 34, lineHeight: 1 }}>{flagEmoji(country.cc)}</span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div
            style={{
              fontSize: 24,
              fontWeight: 850,
              color: "#fff",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {country.name}
          </div>
          <div style={{ fontSize: 12, fontWeight: 600, color: "#9fb3cc" }}>at {country.sampleName}</div>
        </div>
        {now?.temp != null ? (
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
            <WeatherGlyph condition={now.condition} size={32} />
            <span style={{ fontSize: 32, fontWeight: 850, color: "#f3f7ff", whiteSpace: "nowrap" }}>
              {formatReading(now.temp)}°
            </span>
          </div>
        ) : null}
      </div>

      {tempPts.length >= 2 ? (
        <div style={{ marginTop: 14 }}>
          <MiniChart
            label="TEMP · 72H"
            color="#e66767"
            units="°C"
            points={tempPts}
            avg={avgTemp}
            caption={hi != null && lo != null ? `hi ${formatReading(hi)}° · lo ${formatReading(lo)}°` : ""}
          />
        </div>
      ) : null}

      {windPts.length >= 2 ? (
        <div style={{ marginTop: 14 }}>
          <MiniChart
            label="WIND · 72H"
            color="#9085e9"
            units="m/s"
            points={windPts}
            avg={avgWind}
            caption={avgWind != null ? `avg ${formatReading(avgWind)} m/s` : ""}
          />
        </div>
      ) : null}
    </BroadcastCard>
  );
}
