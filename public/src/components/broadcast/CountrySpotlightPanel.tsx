"use client";

/**
 * "TOP CITIES" panel for an on-air country spotlight — the country's biggest
 * cities (population-ranked, scoped to the country's bbox via listCities, same
 * plumbing the region zoom-in cities layer already uses), with a featured slot
 * that cycles through them (photo + Wikipedia blurb when the City doc has one,
 * worker-cached; see enrich:wiki) plus a "PAST YEAR" climate strip for that
 * city — same chart as PointHistoryPanel/EventNearbyPanel, just keyed to
 * whichever city is currently featured. Pure presentation inside the scaled
 * broadcast stage; pointer-inert.
 */
import { useEffect, useState } from "react";
import type { CountryShot } from "@photonsurge/shared/director-countries";
import { listCities, formatPopulation, type City } from "../../lib/cities";
import { useClimateYear } from "../../lib/history-client";
import { MiniChart, buildClimateRows, usePagedSlides, sparkPoints, toPath, CHART_W, formatReading } from "./PointHistoryPanel";

const TOP_CITY_LIMIT = 8;
/** Seconds the featured city holds before the slide advances to the next. */
const FEATURED_HOLD_MS = 7000;
const ROW_SPARK_W = 64;
const ROW_SPARK_H = 24;
const ROW_SPARK_STROKE = 9;

/** One "other top city" row: name/population plus a small past-year
 *  temperature sparkline, fetched independently per row — same shape as
 *  EventNearbyPanel's NearbyCityRow, minus the distance (population rank is
 *  the sort here, not proximity). */
function TopCityRow({ city }: { city: City }) {
  const climate = useClimateYear([city.lng, city.lat], "monthly");
  const tempRow = buildClimateRows(climate.datasets).find((r) => r.variable === "temp");
  const spark = tempRow ? sparkPoints(tempRow.points, ROW_SPARK_H) : null;
  const latest = tempRow ? [...tempRow.points].reverse().find((p) => p.value != null)?.value : null;

  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, padding: "3px 0" }}>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontWeight: 700, color: "#e6eefb", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {city.name}
        </div>
        <div style={{ color: "#8ea3bf", whiteSpace: "nowrap" }}>
          {[formatPopulation(city.population), city.isCapital ? "capital" : null].filter(Boolean).join(" · ")}
        </div>
      </div>
      {spark ? (
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
          {latest != null ? (
            <span style={{ fontSize: 12, fontWeight: 800, color: tempRow!.color }}>{formatReading(latest)}°</span>
          ) : null}
          <svg width={ROW_SPARK_W} height={ROW_SPARK_H} viewBox={`0 0 ${CHART_W} ${ROW_SPARK_H}`} preserveAspectRatio="none">
            <path
              d={toPath(spark.pts)}
              fill="none"
              stroke={tempRow!.color}
              strokeWidth={ROW_SPARK_STROKE}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          </svg>
        </div>
      ) : null}
    </div>
  );
}

export default function CountrySpotlightPanel({
  country,
  color = "#3f8f8f",
}: {
  country: CountryShot;
  color?: string;
}) {
  const [cities, setCities] = useState<City[]>([]);

  useEffect(() => {
    let cancelled = false;
    listCities({ bbox: country.bbox, limit: TOP_CITY_LIMIT }).then((res) => {
      if (!cancelled) setCities(res);
    });
    return () => {
      cancelled = true;
    };
    // country.bbox is a stable array reference from the COUNTRY_SHOTS catalog
    // (looked up once by id), so the id alone is enough to re-fetch on switch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [country.id]);

  // Cycle the featured slot through every top city, biggest first, looping.
  const [slide, setSlide] = useState(0);
  useEffect(() => {
    if (cities.length <= 1) return;
    const iv = setInterval(() => setSlide((n) => n + 1), FEATURED_HOLD_MS);
    return () => clearInterval(iv);
  }, [cities.length]);

  const featured = cities.length ? cities[slide % cities.length] : undefined;

  // A single cheap fetch (cached per rounded lat/lng) — safe to re-request on
  // every slide tick since it just tracks the currently-featured city. Must
  // run unconditionally (before the early return below) per rules-of-hooks.
  const featuredCenter = featured ? ([featured.lng, featured.lat] as [number, number]) : null;
  const climate = useClimateYear(featuredCenter, "monthly");
  const climateRows = buildClimateRows(climate.datasets);
  // One chart at a time (same timer-driven slideshow as PointHistoryPanel)
  // instead of stacking temp/humidity/rain all at once.
  const climateSlide = usePagedSlides(climateRows, 1);

  if (!cities.length) return null;

  const rest = cities.filter((c) => c !== featured);

  return (
    <div
      style={{
        width: 440,
        background: "rgba(8,13,22,0.82)",
        border: `1px solid ${color}44`,
        borderLeft: `3px solid ${color}`,
        borderRadius: 8,
        backdropFilter: "blur(4px)",
        WebkitBackdropFilter: "blur(4px)",
        fontFamily: "system-ui, sans-serif",
        color: "#e6eefb",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          fontSize: 11,
          fontWeight: 800,
          letterSpacing: 1.4,
          color: "#9fb3cc",
          padding: "10px 16px 7px",
        }}
      >
        ▸ TOP CITIES
      </div>

      {/* Featured city — photo + blurb; slot cycles through every top city. */}
      {featured ? (
        <div style={{ padding: "0 16px 13px" }}>
          {featured.wikiThumb ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={featured.wikiThumb}
              alt={featured.name}
              style={{
                width: "100%",
                height: 175,
                objectFit: "cover",
                borderRadius: 7,
                display: "block",
                marginBottom: 9,
              }}
            />
          ) : null}
          <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
            <span style={{ fontSize: 22, fontWeight: 800, color: "#fff" }}>{featured.name}</span>
            {formatPopulation(featured.population) ? (
              <span style={{ fontSize: 14, fontWeight: 700, color }}>{formatPopulation(featured.population)}</span>
            ) : null}
          </div>
          <div style={{ fontSize: 14, fontWeight: 600, color: "#aebfd6", marginTop: 2 }}>
            {[featured.country, featured.isCapital ? "capital" : null].filter(Boolean).join(" · ")}
          </div>
          {featured.wikiExtract ? (
            <div
              style={{
                fontSize: 13,
                lineHeight: 1.5,
                color: "#cdd9ec",
                marginTop: 7,
                display: "-webkit-box",
                WebkitLineClamp: 8,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
              }}
            >
              {featured.wikiExtract}
            </div>
          ) : null}
        </div>
      ) : null}

      {/* Featured city's past-year climate — same chart PointHistoryPanel/
          EventNearbyPanel draw, keyed to this city. One variable at a time
          (timer-paged), not all three stacked. */}
      {climateRows.length ? (
        <div style={{ borderTop: "1px solid rgba(120,140,170,0.14)", padding: "9px 16px 4px", display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: 1.2, color: "#9fb3cc" }}>
              ▸ {featured?.name.toUpperCase()} · PAST YEAR
            </span>
            {climateSlide.pageCount > 1 ? (
              <span style={{ fontSize: 9, fontWeight: 750, letterSpacing: 1.05, color }}>
                {climateSlide.page + 1}/{climateSlide.pageCount}
              </span>
            ) : null}
          </div>
          {climateSlide.visible.map((row) => (
            <MiniChart
              key={row.variable}
              label={row.label}
              color={row.color}
              units={row.units}
              points={row.points}
              avg={row.avg}
              caption={row.caption}
            />
          ))}
        </div>
      ) : null}

      {/* Other top cities — name/population plus each city's own past-year
          temperature sparkline (TopCityRow), fetched per row. */}
      {rest.length ? (
        <div style={{ borderTop: "1px solid rgba(120,140,170,0.14)", padding: "8px 16px 10px", fontSize: 13 }}>
          {rest.map((c) => (
            <TopCityRow key={c.id} city={c} />
          ))}
        </div>
      ) : null}
    </div>
  );
}
