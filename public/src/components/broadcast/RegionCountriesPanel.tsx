"use client";

/**
 * "TOP COUNTRIES" — the region ("area") spotlight slide that breaks a multi-
 * country region down into its biggest MEMBER COUNTRIES, each shown with its own
 * live weather and a 72-hour forecast graph. Countries come population-ranked
 * from the enriched Region dossier (`region.countries`, filled by the worker's
 * regions.enrichPlaces), and each is sampled at its biggest in-region city
 * (`region.topCities`) — the 3-hourly today..+72h forecast track there
 * (usePointForecastSteps) is drawn as temperature + wind MiniCharts, the same
 * chart the AREA HISTORY slide uses but pointed at the future instead of the
 * past. A featured slot cycles through the top five (like TopCitiesPanel's
 * featured city), the ranked list below highlighting whichever is on air.
 *
 * Self-hides until the region carries a country dossier with at least one
 * sample-able city. Pure presentation inside the scaled broadcast stage.
 */
import { useEffect, useMemo, useState } from "react";
import type { iRegionModel, iRegionCountry, iRegionCity } from "@photonsurge/shared/db/region-model";
import { usePointForecastSteps } from "../../lib/forecast-client";
import { DEFAULT_THEME, type BroadcastTheme } from "./config";
import BroadcastCard, { CardSection } from "./BroadcastCard";
import { MiniChart, formatReading, type SparkPoint } from "./PointHistoryPanel";
import { WeatherGlyph } from "./glyphs";

/** Seconds the featured country holds before the slide advances to the next. */
const FEATURED_HOLD_MS = 7000;
const TOP_N = 5;

/** ISO-3166 alpha-2 (any case) → flag emoji, or "" for a missing/short code. */
function flagEmoji(cc?: string): string {
  if (!cc || cc.length !== 2) return "";
  const BASE = 0x1f1e6; // regional-indicator "A"
  const up = cc.toUpperCase();
  return String.fromCodePoint(BASE + up.charCodeAt(0) - 65, BASE + up.charCodeAt(1) - 65);
}

/** A top member country paired with the biggest in-region city we can sample its
 *  weather at (null when the dossier carries no city with a coordinate for it). */
export interface RankedCountry {
  country: iRegionCountry;
  sample: iRegionCity | null;
}

/** The region's population-ranked top-N member countries, each matched to its
 *  biggest in-region city (the forecast sample point). */
export function rankedCountries(region: iRegionModel, n = TOP_N): RankedCountry[] {
  const cities = region.topCities ?? [];
  return [...(region.countries ?? [])]
    .sort((a, b) => (b.population ?? 0) - (a.population ?? 0))
    .slice(0, n)
    .map((country) => {
      const cc = country.cc?.toLowerCase();
      const sample =
        cities
          .filter((c) => cc && c.cc && c.cc.toLowerCase() === cc)
          .sort((a, b) => (b.population ?? 0) - (a.population ?? 0))[0] ?? null;
      return { country, sample };
    });
}

/** Whether the region can draw the top-countries slide — at least one member
 *  country has a city we can point a forecast at. */
export function regionCountriesSlideHasContent(region: iRegionModel | null | undefined): boolean {
  if (!region) return false;
  return rankedCountries(region).some((r) => r.sample != null);
}

/** The featured country's live 72h weather — the current reading plus temperature
 *  and wind forecast graphs, sampled at its biggest in-region city. */
function CountryForecast({ ranked }: { ranked: RankedCountry }) {
  const center: [number, number] | null = ranked.sample ? [ranked.sample.lng, ranked.sample.lat] : null;
  const { steps, loading } = usePointForecastSteps(center);

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
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <span style={{ fontSize: 30, lineHeight: 1 }}>{flagEmoji(ranked.country.cc)}</span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div
            style={{
              fontSize: 22,
              fontWeight: 850,
              color: "#fff",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {ranked.country.name}
          </div>
          {ranked.sample ? (
            <div style={{ fontSize: 12, fontWeight: 600, color: "#9fb3cc" }}>at {ranked.sample.name}</div>
          ) : null}
        </div>
        {now?.temp != null ? (
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
            <WeatherGlyph condition={now.condition} size={30} />
            <span style={{ fontSize: 30, fontWeight: 850, color: "#f3f7ff", whiteSpace: "nowrap" }}>
              {formatReading(now.temp)}°
            </span>
          </div>
        ) : null}
      </div>

      {tempPts.length >= 2 ? (
        <div style={{ marginTop: 12 }}>
          <MiniChart
            label="TEMP · 72H"
            color="#e66767"
            units="°C"
            points={tempPts}
            avg={avgTemp}
            caption={hi != null && lo != null ? `hi ${formatReading(hi)}° · lo ${formatReading(lo)}°` : ""}
          />
        </div>
      ) : loading ? (
        <div style={{ marginTop: 12, fontSize: 12, fontWeight: 600, color: "#9fb3cc" }}>Loading forecast…</div>
      ) : null}

      {windPts.length >= 2 ? (
        <div style={{ marginTop: 12 }}>
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
    </div>
  );
}

export default function RegionCountriesPanel({
  region,
  color = "#4a8f6f",
  theme = DEFAULT_THEME,
}: {
  region: iRegionModel;
  color?: string;
  theme?: BroadcastTheme;
}) {
  // Only countries we can actually sample a forecast for earn a place in the cycle.
  const ranked = useMemo(() => rankedCountries(region).filter((r) => r.sample != null), [region]);

  const [slide, setSlide] = useState(0);
  useEffect(() => {
    if (ranked.length <= 1) return;
    const iv = setInterval(() => setSlide((n) => n + 1), FEATURED_HOLD_MS);
    return () => clearInterval(iv);
  }, [ranked.length]);

  if (!ranked.length) return null;
  const activeIdx = slide % ranked.length;

  return (
    <BroadcastCard accent={color} eyebrow="Top Countries" theme={theme}>
      <CountryForecast ranked={ranked[activeIdx]} />

      {/* The ranked five — the on-air country highlighted; the featured block
          above cycles through them in turn. */}
      <CardSection style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {ranked.map((r, i) => (
          <div
            key={r.country.cc}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "3px 6px",
              borderRadius: 6,
              background: i === activeIdx ? "rgba(74,143,111,0.20)" : "transparent",
            }}
          >
            <span style={{ width: 18, fontSize: 13, fontWeight: 800, color: "#8ea3bf", textAlign: "right" }}>{i + 1}</span>
            <span style={{ fontSize: 16 }}>{flagEmoji(r.country.cc)}</span>
            <span
              style={{
                flex: 1,
                minWidth: 0,
                fontWeight: i === activeIdx ? 800 : 600,
                color: i === activeIdx ? "#fff" : "#cdd9ec",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {r.country.name}
            </span>
          </div>
        ))}
      </CardSection>
    </BroadcastCard>
  );
}
