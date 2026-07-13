"use client";

/**
 * "NEXT 24H" — the region ("area") spotlight's near-term slide, split out of the
 * 3-day area forecast so the immediate outlook reads on its own page. The steps
 * are composed server-side onto the focus bundle (`regionNearTerm`, the 72h track
 * at the region's biggest city), so this card just reads the next ~24 hours off
 * them: an hour-by-hour strip (glyph · temp · wind per 3h step) above a
 * temperature graph. Self-hides until the bundle carries near-term steps.
 */
import type { ForecastStep } from "../../lib/weather-forecast";
import { DEFAULT_THEME, type BroadcastTheme } from "./config";
import BroadcastCard, { CardSection } from "./BroadcastCard";
import { MiniChart, formatReading, type SparkPoint } from "./PointHistoryPanel";
import { WeatherGlyph } from "./glyphs";

/** How far ahead the near-term window reaches (hours). */
const WINDOW_HOURS = 24;
const HOUR_MS = 3_600_000;

/** One 3-hourly column in the near-term strip. */
function StepColumn({ step }: { step: ForecastStep }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 3,
        flex: "1 1 0",
        minWidth: 0,
      }}
    >
      <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: 0.3, color: "#9fb3cc", whiteSpace: "nowrap" }}>
        {step.hourLabel}
      </span>
      <WeatherGlyph condition={step.condition} size={20} />
      <span style={{ fontSize: 14, fontWeight: 850, color: "#f3f7ff", whiteSpace: "nowrap" }}>
        {step.temp != null ? `${formatReading(step.temp)}°` : "—"}
      </span>
      <span style={{ fontSize: 9, fontWeight: 700, color: "#8ea3bf", whiteSpace: "nowrap" }}>
        {step.wind != null ? `${formatReading(step.wind)}` : ""}
      </span>
    </div>
  );
}

export default function RegionNearTermPanel({
  steps,
  sampleName,
  color = "#4a8f6f",
  theme = DEFAULT_THEME,
}: {
  steps: ForecastStep[];
  /** The city the region near-term was sampled at, for the header chip. */
  sampleName?: string;
  color?: string;
  theme?: BroadcastTheme;
}) {
  // The current 3h bucket through +24h.
  const now = Date.now();
  const near = steps
    .filter((s) => {
      const t = new Date(s.t).getTime();
      return t >= now - 3 * HOUR_MS && t <= now + WINDOW_HOURS * HOUR_MS;
    })
    .slice(0, 9);

  if (near.length < 2) return null;

  const tempPts: SparkPoint[] = near.map((s) => ({ t: s.t, value: s.temp }));
  const temps = near.map((s) => s.temp).filter((v): v is number => v != null);
  const hi = temps.length ? Math.max(...temps) : null;
  const lo = temps.length ? Math.min(...temps) : null;
  const avg = temps.length ? temps.reduce((a, b) => a + b, 0) / temps.length : null;

  return (
    <BroadcastCard
      accent={color}
      eyebrow="Next 24h"
      headerRight={
        sampleName ? (
          <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.6, color: "#9fb3cc" }}>{sampleName}</span>
        ) : null
      }
      theme={theme}
    >
      <CardSection first>
        <div style={{ display: "flex", flexDirection: "row", gap: 4 }}>
          {near.map((s) => (
            <StepColumn key={s.t} step={s} />
          ))}
        </div>
      </CardSection>

      {tempPts.length >= 2 ? (
        <CardSection>
          <MiniChart
            label="TEMP · NEXT 24H"
            color="#e66767"
            units="°C"
            points={tempPts}
            avg={avg}
            caption={hi != null && lo != null ? `hi ${formatReading(hi)}° · lo ${formatReading(lo)}°` : ""}
          />
        </CardSection>
      ) : null}
    </BroadcastCard>
  );
}
