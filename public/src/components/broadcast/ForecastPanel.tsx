"use client";

/**
 * "3-DAY FORECAST" — a horizontal strip of daily cards (TODAY / TOMORROW /
 * weekday) sampled from the rolling forecast store (/api/weather/forecast/point,
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
import { compassPoint } from "../../lib/weather-forecast";
import { usePointForecastDays, useAreaForecastDays } from "../../lib/focus/focus-client";
import { SectionTitle } from "./PointHistoryPanel";
import { DEFAULT_THEME, type BroadcastTheme } from "./config";
import { MONO, INK, INK_DIM, GODS_TILE, GODS_TILE_BORDER, accentRule } from "./GodsPanel";
import BroadcastCard, { DeckChromeContext } from "./BroadcastCard";
import { WeatherGlyph, WarnTriangle, WindArrow, Droplet } from "./glyphs";
import { SEVERITY_COLORS } from "@photonsurge/shared/alerts/severity";

/** Common shape DayCard needs, whichever of point/area supplied it. */
interface NormalizedDay {
  date: string;
  label: ForecastDay["label"];
  hi: number | null;
  lo: number | null;
  /** The day's PEAK sustained wind (m/s). A daily MEAN reads as "nothing
   *  happening" on a day that blew hard all afternoon, so the card leads with
   *  the peak and lets the gust chip carry the extreme. */
  wind: number | null;
  gust: number | null;
  /** Bearing the wind blows FROM, when the sampler sent u/v components. */
  dir: number | null;
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
      // windMax is newer than the cached bundles it may arrive in — fall back
      // to the mean rather than blanking the row on a rolling deploy.
      wind: day.windMax ?? day.windAvg,
      gust: day.gustMax,
      dir: day.windDir ?? null,
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
    wind: day.wind?.max ?? day.wind?.mean ?? null,
    gust: day.gust?.max ?? null,
    // Area cards aggregate SPEED over a box, where a single direction would be
    // an average of a whole weather map. No arrow.
    dir: null,
    precipChance: day.precipChance,
    condition: day.condition,
    hazards: day.hazards,
  };
}

/** Beaufort 0 — under this the air is genuinely doing nothing. */
const CALM_MS = 0.5;
/** A gust only earns its own chip once it's this far above the sustained wind. */
const GUST_MARGIN_MS = 2;

export interface WindReading {
  /** Lead number (m/s), rounded to the bake's ~1 m/s resolution. */
  speed: number | null;
  /** Gust worth calling out alongside the lead number. */
  gust: number | null;
  dir: number | null;
  /** Both readings are real and under the calm floor — say so, don't print 0. */
  calm: boolean;
  /** Nothing was sampled: the row has no business showing a number. */
  missing: boolean;
}

/**
 * What a day card should SAY about its wind. Split out (and exported) because
 * the distinction it draws is the whole point: a dead-calm day, a day whose
 * wind never arrived, and a day that only has a gust reading all used to render
 * as the same flat "0 m/s".
 */
export function windReading(day: { wind: number | null; gust: number | null; dir: number | null }): WindReading {
  const { wind, gust } = day;
  const missing = wind == null && gust == null;
  const calm = !missing && (wind ?? 0) < CALM_MS && (gust ?? 0) < CALM_MS;
  const speed = !missing && !calm && wind != null && wind >= CALM_MS ? Math.round(wind) : null;
  const showGust =
    !missing && !calm && gust != null && gust >= CALM_MS && (speed == null || gust >= speed + GUST_MARGIN_MS);
  return { speed, gust: showGust ? Math.round(gust) : null, dir: day.dir, calm, missing };
}

const WEEKDAY_SHORT = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

/**
 * The label a viewer can act on: TODAY, TOMORROW, then the weekday itself —
 * "+2" is a diff, not a day anyone plans around. Read with UTC accessors on the
 * date key so it can't drift with the render machine's clock.
 */
export function dayCardLabel(day: { label: string; date: string }): string {
  if (day.label === "TODAY" || day.label === "TOMORROW") return day.label;
  const d = new Date(`${day.date}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? day.label : WEEKDAY_SHORT[d.getUTCDay()];
}

/** The heading names the span the strip ACTUALLY shows — the monitor variant
 *  runs three cards, the deck card four, and the extended outlook more, so a
 *  hard-coded "3-DAY" was a caption that could disagree with its own data. */
export function stripTitle(dayCount: number): string {
  return `${Math.max(1, dayCount)}-DAY FORECAST`;
}

/** Whole degrees. The 8-bit temp bake resolves to ~0.6°C, so the tenth of a
 *  degree the old card printed was decoration, and it cost the row its width. */
const degrees = (v: number | null): string => (v != null ? `${Math.round(v)}°` : "—");

const CARD_W = 92;
const COMPACT_CARD_W = 76;
const STRIP_GAP = 8;

function DayCard({
  day,
  theme,
  compact,
  fill = false,
  today = false,
}: {
  day: NormalizedDay;
  theme: BroadcastTheme;
  compact: boolean;
  /** Fill an equal share of the row instead of a fixed width (embedded strip). */
  fill?: boolean;
  /** The leading card — gets the accent rule so the eye lands on "now" first. */
  today?: boolean;
}) {
  const topHazard = day.hazards[0];
  const width = compact ? COMPACT_CARD_W : CARD_W;
  const wind = windReading(day);
  const scale = fill ? 0.94 : compact ? 1 : 1.2;
  return (
    <div
      style={{
        position: "relative",
        boxSizing: "border-box",
        ...(fill ? { flex: "1 1 0", minWidth: 0 } : { width }),
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 3,
        padding: fill ? "7px 3px 6px" : "8px 6px 7px",
        background: GODS_TILE,
        border: `1px solid ${GODS_TILE_BORDER}`,
        // The on-air plate carries no shadow (it reads as a grey box over the
        // globe) — the leading day is marked with an accent rule instead.
        borderTop: today ? `2px solid ${theme.accent}` : `1px solid ${GODS_TILE_BORDER}`,
      }}
    >
      {topHazard ? (
        <div
          title={topHazard.label}
          style={{
            position: "absolute",
            top: 0,
            right: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 16,
            height: 16,
            background: SEVERITY_COLORS[topHazard.severityRank] ?? theme.accent,
          }}
        >
          <WarnTriangle size={10} />
        </div>
      ) : null}
      <span
        style={{
          fontFamily: MONO,
          fontSize: 10 * (fill ? 1 : compact ? 1.05 : 1.1),
          letterSpacing: 1.2,
          color: today ? INK : INK_DIM,
        }}
      >
        {dayCardLabel(day)}
      </span>
      <div style={{ height: 22 * scale, display: "flex", alignItems: "center" }}>
        <WeatherGlyph condition={day.condition} size={22 * scale} />
      </div>
      <span
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: 4,
          whiteSpace: "nowrap",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        <span style={{ fontSize: 17 * scale, fontWeight: 600, color: theme.textColor }}>{degrees(day.hi)}</span>
        <span style={{ fontSize: 12 * scale, fontWeight: 400, color: INK_DIM }}>{degrees(day.lo)}</span>
      </span>
      <span
        title={compassPoint(wind.dir) ? `${compassPoint(wind.dir)} wind` : undefined}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 3,
          fontFamily: MONO,
          fontSize: 9.5 * (fill ? 1 : compact ? 1.05 : 1.1),
          color: INK_DIM,
          whiteSpace: "nowrap",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {wind.missing ? (
          "—"
        ) : wind.calm ? (
          "CALM"
        ) : (
          <>
            <WindArrow deg={wind.dir} size={11 * (fill ? 1 : 1.05)} color={INK} />
            {wind.speed != null ? <span style={{ color: INK }}>{wind.speed}</span> : null}
            {wind.gust != null ? <span style={{ color: theme.accent }}>G{wind.gust}</span> : null}
            <span style={{ opacity: 0.75 }}>m/s</span>
          </>
        )}
      </span>
      {day.precipChance != null ? (
        <span
          style={{
            display: "flex",
            alignItems: "center",
            gap: 3,
            fontFamily: MONO,
            fontSize: 9.5 * (fill ? 1 : compact ? 1.05 : 1.1),
            color: day.precipChance > 0 ? theme.accent : INK_DIM,
            opacity: day.precipChance > 0 ? 1 : 0.6,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          <Droplet size={8.5} color={day.precipChance > 0 ? theme.accent : INK_DIM} />
          {day.precipChance}%
        </span>
      ) : null}
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
    const shown = monitor ? days.slice(0, 3) : days;
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
            {stripTitle(shown.length)}
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
        {shown.length ? (
          <div style={{ display: "flex", flexDirection: "row", gap: monitor ? 6 : 5 }}>
            {shown.map((d, i) => (
              <DayCard key={d.date} day={d} theme={theme} compact fill={!monitor} today={i === 0} />
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
        <SectionTitle title={stripTitle(days.length)} tag={bbox ? "AREA" : "POINT"} accent={theme.accent} />
        <div style={{ display: "flex", flexDirection: "row", gap: STRIP_GAP }}>
          {days.map((d, i) => (
            <DayCard key={d.date} day={d} theme={theme} compact={compact} fill={inDeck} today={i === 0} />
          ))}
        </div>
      </div>
    </BroadcastCard>
  );
}
