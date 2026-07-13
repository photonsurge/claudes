"use client";

/**
 * The per-country slide of a region ("area") spotlight — ONE member country per
 * card, rich with its own weather. The region deck pushes one for each of the
 * region's biggest member countries; all data is composed server-side onto the
 * focus bundle (`FocusRegionCountry`), so the card just renders — no per-country
 * fetch at cut time.
 *
 * Shows, top to bottom: the flag + current reading; the AI "now" + "next 24h"
 * summaries when the country has a round-up (else skipped); a 3-day daily strip;
 * temperature / wind / rain / cloud 72h graphs; and the country's biggest cities
 * with their own current temp + 3-day chips. Pure presentation inside the scaled
 * broadcast stage.
 */
import type { FocusRegionCountry, FocusRegionCity } from "../../lib/focus/types";
import type { ForecastDay } from "../../lib/weather-forecast";
import { DEFAULT_THEME, type BroadcastTheme } from "./config";
import BroadcastCard, { CardSection } from "./BroadcastCard";
import { MiniChart, formatReading, type SparkPoint } from "./PointHistoryPanel";
import { WeatherGlyph } from "./glyphs";
import { DayChip } from "./CityForecastStrip";

/** ISO-3166 alpha-2 (any case) → flag emoji, or "" for a missing/short code. */
export function flagEmoji(cc?: string): string {
  if (!cc || cc.length !== 2) return "";
  const BASE = 0x1f1e6; // regional-indicator "A"
  const up = cc.toUpperCase();
  return String.fromCodePoint(BASE + up.charCodeAt(0) - 65, BASE + up.charCodeAt(1) - 65);
}

/** One AI summary block (label + prose), self-hiding when there's no text. */
function SummaryBlock({ label, text, color }: { label: string; text?: string; color: string }) {
  if (!text) return null;
  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: 1.2, color, marginBottom: 3 }}>{label}</div>
      <div style={{ fontSize: 13, lineHeight: 1.5, color: "#cdd9ec" }}>{text}</div>
    </div>
  );
}

/** A compact 3-day column (day label · glyph · hi/lo) from the country forecast. */
function DayCell({ day }: { day: ForecastDay }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 3,
        flex: "1 1 0",
        minWidth: 0,
        padding: "6px 3px",
        borderRadius: 7,
        background: "rgba(4,10,20,0.55)",
      }}
    >
      <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: 0.6, color: "#aebdd2" }}>{day.label}</span>
      <WeatherGlyph condition={day.condition} size={22} />
      <span style={{ fontSize: 15, fontWeight: 850, color: "#f3f7ff", whiteSpace: "nowrap" }}>
        {day.hiTemp != null ? `${formatReading(day.hiTemp)}°` : "—"}
        <span style={{ fontSize: 11, fontWeight: 700, color: "#9db0ca", marginLeft: 3 }}>
          {day.loTemp != null ? `${formatReading(day.loTemp)}°` : ""}
        </span>
      </span>
    </div>
  );
}

/** One city row — name + current temp + a 3-day chip strip. */
function CityRow({ city, color }: { city: FocusRegionCity; color: string }) {
  const days = (city.daily ?? []).slice(0, 3);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "4px 0" }}>
      <div style={{ minWidth: 0, flex: "1 1 auto" }}>
        <div style={{ fontWeight: 800, color: "#e6eefb", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {city.name}
        </div>
      </div>
      <div style={{ textAlign: "right", minWidth: 42 }}>
        <div style={{ fontSize: 20, fontWeight: 850, color: "#fff", lineHeight: 1, whiteSpace: "nowrap" }}>
          {city.temp != null ? `${formatReading(city.temp)}°` : "—"}
        </div>
        <div style={{ fontSize: 8, fontWeight: 700, letterSpacing: 0.5, color }}>NOW</div>
      </div>
      {days.length ? (
        <div style={{ display: "flex", gap: 4, flex: "0 0 auto" }}>
          {days.map((d) => (
            <DayChip key={d.date} day={d} color={color} />
          ))}
        </div>
      ) : null}
    </div>
  );
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
  const now = steps.find((s) => s.temp != null) ?? steps[0];

  const series = (pick: (s: (typeof steps)[number]) => number | null): SparkPoint[] =>
    steps.map((s) => ({ t: s.t, value: pick(s) }));
  const avg = (pts: SparkPoint[]): number | null => {
    const vals = pts.map((p) => p.value).filter((v): v is number => v != null);
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  };
  const tempPts = series((s) => s.temp);
  const windPts = series((s) => s.wind);
  const rainPts = series((s) => s.rain);
  const cloudPts = series((s) => s.cloud);
  const temps = tempPts.map((p) => p.value).filter((v): v is number => v != null);
  const hi = temps.length ? Math.max(...temps) : null;
  const lo = temps.length ? Math.min(...temps) : null;

  const days = country.days.slice(0, 3);

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

      {/* AI day/hour summaries — only when the country has a round-up. */}
      {country.summary || country.outlook ? (
        <CardSection>
          <SummaryBlock label="RIGHT NOW" text={country.summary} color={color} />
          <SummaryBlock label="NEXT 24 HOURS" text={country.outlook} color={color} />
        </CardSection>
      ) : null}

      {/* 3-day daily strip. */}
      {days.length ? (
        <CardSection eyebrow="3-Day Forecast">
          <div style={{ display: "flex", flexDirection: "row", gap: 6 }}>
            {days.map((d) => (
              <DayCell key={d.date} day={d} />
            ))}
          </div>
        </CardSection>
      ) : null}

      {/* 72h graphs — temp / wind / rain / cloud, each self-hiding on no data. */}
      {tempPts.length >= 2 ? (
        <CardSection eyebrow="Next 72 Hours">
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <MiniChart
              label="TEMP · 72H"
              color="#e66767"
              units="°C"
              points={tempPts}
              avg={avg(tempPts)}
              caption={hi != null && lo != null ? `hi ${formatReading(hi)}° · lo ${formatReading(lo)}°` : ""}
              height={72}
            />
            <MiniChart label="WIND · 72H" color="#9085e9" units="m/s" points={windPts} avg={avg(windPts)} caption="" height={72} />
            <MiniChart label="RAIN · 72H" color="#3987e5" units="mm" points={rainPts} avg={avg(rainPts)} caption="" height={72} />
            <MiniChart label="CLOUD · 72H" color="#008300" units="%" points={cloudPts} avg={avg(cloudPts)} caption="" height={72} />
          </div>
        </CardSection>
      ) : null}

      {/* The country's biggest cities with their own now + 3-day. */}
      {country.cities.length ? (
        <CardSection eyebrow="Cities">
          {country.cities.map((c) => (
            <CityRow key={c.cityId} city={c} color={color} />
          ))}
        </CardSection>
      ) : null}
    </BroadcastCard>
  );
}
