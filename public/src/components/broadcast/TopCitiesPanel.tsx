"use client";

/**
 * "TOP CITIES" — the CITIES slide of an on-air country spotlight or region
 * tour: the area's biggest cities (population-ranked, scoped to a bbox via
 * listCities, same plumbing the region zoom-in cities layer uses), with a
 * featured slot that cycles through them (photo + Wikipedia blurb when the City
 * doc has one, worker-cached; see enrich:wiki) and a clean list of the rest.
 *
 * Deliberately CITIES-ONLY: the per-city past-year climate chart and per-row
 * temperature sparklines this used to also carry moved out — the deck now has
 * dedicated WEATHER (forecast) and CURRENT & RECENT (area history) slides, so
 * stacking climate here as well read as "a bit much". Pure presentation inside
 * the scaled broadcast stage; pointer-inert.
 */
import { useEffect, useState } from "react";
import { listCities, formatPopulation, type City } from "../../lib/cities";
import BroadcastCard, { CardSection } from "./BroadcastCard";

const TOP_CITY_LIMIT = 8;
/** Seconds the featured city holds before the slide advances to the next. */
const FEATURED_HOLD_MS = 7000;

/** One "other city" row — just name + population/capital, no per-row chart. */
function TopCityRow({ city }: { city: City }) {
  const meta = [formatPopulation(city.population), city.isCapital ? "capital" : null].filter(Boolean).join(" · ");
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, padding: "4px 0" }}>
      <span style={{ fontWeight: 700, color: "#e6eefb", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
        {city.name}
      </span>
      {meta ? <span style={{ color: "#8ea3bf", whiteSpace: "nowrap", flexShrink: 0 }}>{meta}</span> : null}
    </div>
  );
}

export default function TopCitiesPanel({
  bbox,
  color = "#3f8f8f",
}: {
  bbox: [number, number, number, number];
  color?: string;
}) {
  const [cities, setCities] = useState<City[]>([]);
  // Round so a slow-drifting camera (tour/weather kinds' zoomDrift) doesn't
  // refetch on every frame's imperceptible bbox change — only re-fetch once
  // the framed area has meaningfully moved.
  const roundedBbox = bbox.map((v) => v.toFixed(1)).join(",");

  useEffect(() => {
    let cancelled = false;
    listCities({ bbox, limit: TOP_CITY_LIMIT }).then((res) => {
      if (!cancelled) setCities(res);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roundedBbox]);

  // Cycle the featured slot through every top city, biggest first, looping.
  const [slide, setSlide] = useState(0);
  useEffect(() => {
    if (cities.length <= 1) return;
    const iv = setInterval(() => setSlide((n) => n + 1), FEATURED_HOLD_MS);
    return () => clearInterval(iv);
  }, [cities.length]);

  if (!cities.length) return null;

  const featured = cities[slide % cities.length];
  const rest = cities.filter((c) => c !== featured);

  return (
    <BroadcastCard accent={color} eyebrow="Top Cities">
      {/* Featured city — photo + short blurb; slot cycles through every top city. */}
      <div>
        {featured.wikiThumb ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={featured.wikiThumb}
            alt={featured.name}
            style={{ width: "100%", height: 175, objectFit: "cover", borderRadius: 7, display: "block", marginBottom: 9 }}
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
              WebkitLineClamp: 4,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {featured.wikiExtract}
          </div>
        ) : null}
      </div>

      {/* The rest of the area's cities — a clean name/population list. */}
      {rest.length ? (
        <CardSection style={{ fontSize: 13 }}>
          {rest.map((c) => (
            <TopCityRow key={c.id} city={c} />
          ))}
        </CardSection>
      ) : null}
    </BroadcastCard>
  );
}
