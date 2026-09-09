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
import { useContext } from "react";
import { type ForecastDay, type AreaForecastDay } from "../../lib/forecast-client";
import { usePointForecastDays, useAreaForecastDays } from "../../lib/focus/focus-client";
import { formatReading } from "./PointHistoryPanel";
import { SectionTitle } from "./PointHistoryPanel";
import { DEFAULT_THEME, type BroadcastTheme } from "./config";
import { MONO, INK, INK_DIM, GODS_TILE, GODS_TILE_BORDER, accentRule } from "./GodsPanel";
import BroadcastCard, { DeckChromeContext } from "./BroadcastCard";
import { WeatherGlyph, WarnTriangle } from "./glyphs";
import { SEVERITY_COLORS } from "@photonsurge/shared/alerts/severity";

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

function DayCard({
  day,
  theme,
  compact,
  fill = false,
}: {
  day: NormalizedDay;
  theme: BroadcastTheme;
  compact: boolean;
  /** Fill an equal share of the row instead of a fixed width (embedded strip). */
  fill?: boolean;
}) {
  const topHazard = day.hazards[0];
  const width = compact ? COMPACT_CARD_W : CARD_W;
  return (
    <div
      style={{
        position: "relative",
        boxSizing: "border-box",
        ...(fill ? { flex: "1 1 0", minWidth: 0 } : { width }),
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 4,
        padding: fill ? "8px 3px" : "8px 6px",
        background: GODS_TILE,
        border: `1px solid ${GODS_TILE_BORDER}`,
      }}
    >
      {topHazard ? (
        <div
          title={topHazard.label}
          style={{
            position: "absolute",
            top: -6,
            right: -4,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 18,
            height: 18,
            background: SEVERITY_COLORS[topHazard.severityRank] ?? theme.accent,
            boxShadow: "0 1px 4px rgba(0,0,0,0.45)",
          }}
        >
          <WarnTriangle size={11} />
        </div>
      ) : null}
      <span style={{ fontFamily: MONO, fontSize: fill ? 10 : 10.5, letterSpacing: 1, color: INK_DIM }}>
        {day.label}
      </span>
      <div style={{ height: fill ? 22 : compact ? 24 : 30, display: "flex", alignItems: "center" }}>
        <WeatherGlyph condition={day.condition} size={fill ? 22 : compact ? 24 : 30} />
      </div>
      <span
        style={{
          fontSize: fill ? 15.4 : compact ? 16.5 : 19.8,
          fontWeight: 500,
          color: theme.textColor,
          whiteSpace: "nowrap",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {day.hi != null ? formatReading(day.hi) : "—"}°
        <span style={{ fontSize: fill ? 11.6 : 13.2, fontWeight: 400, color: INK_DIM, marginLeft: fill ? 3 : 4 }}>
          {day.lo != null ? `${formatReading(day.lo)}°` : ""}
        </span>
      </span>
      <span style={{ fontFamily: MONO, fontSize: fill ? 9.5 : 10.5, color: INK_DIM }}>
        {day.wind != null ? `${formatReading(day.wind)} m/s` : "—"}
      </span>
      <span style={{ fontFamily: MONO, fontSize: fill ? 9.5 : 10.5, color: theme.accent }}>
        {day.precipChance != null ? `${day.precipChance}%` : ""}
      </span>
    </div>
  );
}

/** Small inline spinner while the forecast fetch is in flight (embedded strip). */
function ForecastSpinner({ accent }: { accent: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 2px", opacity: 0.85 }}>
      <style>{"@keyframes fc-spin{to{transform:rotate(360deg)}}"}</style>
      <svg
        width={15}
        height={15}
        viewBox="0 0 40 40"
        aria-hidden
        style={{ animation: "fc-spin 1.1s linear infinite", willChange: "transform" }}
      >
        <circle cx="20" cy="20" r="17" fill="none" stroke="rgba(255,255,255,0.14)" strokeWidth="5" />
        <circle
          cx="20"
          cy="20"
          r="17"
          fill="none"
          stroke={accent}
          strokeWidth="5"
          strokeLinecap="round"
          strokeDasharray="80 200"
        />
      </svg>
      <span style={{ fontSize: 12.1, fontWeight: 700, letterSpacing: 0.4, color: "#aebdd2" }}>Loading forecast…</span>
    </div>
  );
}

export default function ForecastPanel({
  center,
  bbox = null,
  daysOverride,
  theme = DEFAULT_THEME,
  compact = false,
  variant = "card",
  glass = false,
}: {
  /** Focus point [lng, lat] — the on-air segment's centre (or camera fallback). */
  center: [number, number] | null;
  /** The framed area on wide shots — switches to area-aggregated cards. */
  bbox?: [number, number, number, number] | null;
  /** Pre-fetched day cards to render INSTEAD of fetching — used where the forecast
   *  is already on the focus bundle (e.g. an Areas-tour stop, whose moving centre
   *  the area bundle can't cover). When set, center/bbox are ignored (no fetch). */
  daysOverride?: (ForecastDay | AreaForecastDay)[];
  theme?: BroadcastTheme;
  compact?: boolean;
  /** "card" (own BroadcastCard shell), "inline" (full-width section inside a
   *  detail card), or "monitor" (compact bare section inside LocalWeatherPanel). */
  variant?: "card" | "inline" | "monitor";
  /** No-accent see-through glass shell (reticle-attached instances) — see
   *  BroadcastCard's `glass`. */
  glass?: boolean;
}) {
  // Disable both fetches when caller supplies days directly (fetch-free embed).
  const point = usePointForecastDays(daysOverride || bbox ? null : center);
  const area = useAreaForecastDays(daysOverride ? null : bbox);
  const src = bbox ? area : point;
  const days = (daysOverride ?? src.days).map(normalizeDay);
  // Inside the on-air deck the fixed-size template owns the shell, so fill the
  // full card width with the day strip (like RoundupStatsPanel's tiles) rather
  // than the compact, left-clustered fixed-width cards used off-deck.
  const inDeck = useContext(DeckChromeContext) != null;

  // Inline: a bare section (matching ViewingOverlay's section styling) that shows
  // a spinner while the fetch is in flight, then the fill-width day strip. Hides
  // itself only once loading has finished with nothing to show.
  if (variant === "inline" || variant === "monitor") {
    if (!days.length && !src.loading) return null;
    const monitor = variant === "monitor";
    return (
      <div
        style={
          monitor
            ? { display: "flex", flexDirection: "column", gap: 6 }
            : { marginTop: 11, paddingTop: 11, borderTop: "1px solid rgba(120,140,170,0.15)" }
        }
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: monitor ? 10 : 8,
            marginBottom: monitor ? 0 : 7,
          }}
        >
          <span
            style={{
              fontSize: monitor ? 12.5 : 11.3,
              fontWeight: monitor ? 600 : 800,
              letterSpacing: monitor ? 2.2 : 1,
              color: monitor ? INK : undefined,
              opacity: monitor ? 1 : 0.8,
              whiteSpace: "nowrap",
            }}
          >
            3-DAY FORECAST
          </span>
          {monitor && <div style={{ flex: 1, minWidth: 20, height: 1, background: accentRule(theme.accent) }} />}
          <span
            style={{
              marginLeft: monitor ? 0 : "auto",
              fontFamily: monitor ? MONO : undefined,
              fontSize: monitor ? 9.5 : 12.1,
              letterSpacing: monitor ? 1 : undefined,
              color: monitor ? theme.accent : undefined,
              opacity: monitor ? 1 : 0.7,
            }}
          >
            {bbox ? "AREA" : "POINT"}
          </span>
        </div>
        {days.length ? (
          <div style={{ display: "flex", flexDirection: "row", gap: monitor ? 6 : 5 }}>
            {(monitor ? days.slice(0, 3) : days).map((d) => (
              <DayCard key={d.date} day={d} theme={theme} compact fill={!monitor} />
            ))}
          </div>
        ) : (
          <ForecastSpinner accent={theme.accent} />
        )}
      </div>
    );
  }

  if (!days.length) return null;

  return (
    <BroadcastCard
      theme={theme}
      glass={glass}
      style={inDeck ? undefined : { width: "auto", boxSizing: "border-box", padding: `${compact ? 10 : 14}px 16px` }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: compact ? 6 : 10 }}>
        <SectionTitle title="3-DAY FORECAST" tag={bbox ? "AREA" : "POINT"} accent={theme.accent} />
        <div style={{ display: "flex", flexDirection: "row", gap: STRIP_GAP }}>
          {days.map((d) => (
            <DayCard key={d.date} day={d} theme={theme} compact={compact} fill={inDeck} />
          ))}
        </div>
      </div>
    </BroadcastCard>
  );
}
