"use client";

/**
 * "3-DAY FORECAST" — a horizontal strip of daily hi/lo cards (TODAY/TOMORROW/
 * +2/+3) sampled from the rolling forecast store (/api/weather/forecast/point,
 * or /area over the framed bbox on wide shots). Deliberately NOT another
 * sparkline like PointHistoryPanel's MiniChart — this reads as a classic TV
 * daily-outlook strip, so the two panels stay visually distinct even though
 * they stack in the same slots. A derived hazard badge (from
 * @photonsurge/shared/weather/forecastHazard's threshold rules — a model
 * guess, not a real alert) surfaces on a card when that day crosses a
 * wind/heat/cold/rain/storm floor.
 */
import { usePointForecast, useAreaForecast, type ForecastDay, type AreaForecastDay } from "../../lib/forecast-client";
import { formatReading } from "./PointHistoryPanel";
import { SectionTitle } from "./PointHistoryPanel";
import { DEFAULT_THEME, type BroadcastTheme } from "./config";
import BroadcastCard from "./BroadcastCard";
import { hazardMeta } from "../../lib/hazard";
import { SEVERITY_COLORS } from "@photonsurge/shared/alerts/severity";

const CONDITION_GLYPH: Record<ForecastDay["condition"], string> = {
  sunny: "☀️",
  "partly-cloudy": "⛅",
  cloudy: "☁️",
  rain: "🌧️",
  snow: "🌨️",
  storm: "⛈️",
};

/** Common shape DayCard needs, whichever of point/area supplied it. */
interface NormalizedDay {
  date: string;
  label: ForecastDay["label"];
  hi: number | null;
  lo: number | null;
  wind: number | null;
  gust: number | null;
  precipChance: number | null;
  condition: ForecastDay["condition"];
  hazards: ForecastDay["hazards"];
}

function normalizeDay(day: ForecastDay | AreaForecastDay): NormalizedDay {
  if ("hiTemp" in day) {
    return {
      date: day.date,
      label: day.label,
      hi: day.hiTemp,
      lo: day.loTemp,
      wind: day.windAvg,
      gust: day.gustMax,
      precipChance: day.precipChance,
      condition: day.condition,
      hazards: day.hazards,
    };
  }
  return {
    date: day.date,
    label: day.label,
    hi: day.temp?.max ?? null,
    lo: day.temp?.min ?? null,
    wind: day.wind?.mean ?? null,
    gust: day.gust?.max ?? null,
    precipChance: day.precipChance,
    condition: day.condition,
    hazards: day.hazards,
  };
}

const CARD_W = 92;
const COMPACT_CARD_W = 76;
const STRIP_GAP = 8;

function DayCard({ day, accent, compact }: { day: NormalizedDay; accent: string; compact: boolean }) {
  const topHazard = day.hazards[0];
  const width = compact ? COMPACT_CARD_W : CARD_W;
  return (
    <div
      style={{
        position: "relative",
        width,
        boxSizing: "border-box",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 4,
        padding: "8px 6px",
        borderRadius: 8,
        background: "rgba(4,10,20,0.55)",
      }}
    >
      {topHazard ? (
        <div
          title={topHazard.label}
          style={{
            position: "absolute",
            top: -6,
            right: -4,
            fontSize: 12,
            lineHeight: 1,
            padding: "3px 4px",
            borderRadius: 999,
            background: SEVERITY_COLORS[topHazard.severityRank] ?? accent,
          }}
        >
          {hazardMeta(topHazard.hazard).icon}
        </div>
      ) : null}
      <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: 1, color: "#aebdd2" }}>{day.label}</span>
      <span style={{ fontSize: compact ? 22 : 28, lineHeight: 1 }}>{CONDITION_GLYPH[day.condition]}</span>
      <span style={{ fontSize: compact ? 15 : 18, fontWeight: 850, color: "#f3f7ff" }}>
        {day.hi != null ? formatReading(day.hi) : "—"}°
        <span style={{ fontSize: 12, fontWeight: 700, color: "#9db0ca", marginLeft: 4 }}>
          {day.lo != null ? `${formatReading(day.lo)}°` : ""}
        </span>
      </span>
      <span style={{ fontSize: 10, fontWeight: 700, color: "#91a1b9" }}>
        {day.wind != null ? `${formatReading(day.wind)} m/s` : "—"}
      </span>
      <span style={{ fontSize: 10, fontWeight: 700, color: "#5fb0e6" }}>
        {day.precipChance != null ? `${day.precipChance}%` : ""}
      </span>
    </div>
  );
}

export default function ForecastPanel({
  center,
  bbox = null,
  theme = DEFAULT_THEME,
  compact = false,
}: {
  /** Focus point [lng, lat] — the on-air segment's centre (or camera fallback). */
  center: [number, number] | null;
  /** The framed area on wide shots — switches to area-aggregated cards. */
  bbox?: [number, number, number, number] | null;
  theme?: BroadcastTheme;
  compact?: boolean;
}) {
  const point = usePointForecast(bbox ? null : center);
  const area = useAreaForecast(bbox);
  const days = (bbox ? area.days : point.days).map(normalizeDay);

  if (!days.length) return null;

  return (
    <BroadcastCard
      theme={theme}
      style={{ width: "auto", boxSizing: "border-box", padding: `${compact ? 10 : 14}px 16px` }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: compact ? 6 : 10 }}>
        <SectionTitle title="3-DAY FORECAST" tag={bbox ? "AREA" : "POINT"} accent={theme.accent} />
        <div style={{ display: "flex", flexDirection: "row", gap: STRIP_GAP }}>
          {days.map((d) => (
            <DayCard key={d.date} day={d} accent={theme.accent} compact={compact} />
          ))}
        </div>
      </div>
    </BroadcastCard>
  );
}
