"use client";

/**
 * "TOP CITIES" — the CITIES slide of an on-air country spotlight or region
 * tour: the area's biggest cities (population-ranked, scoped to a bbox via
 * listCities, same plumbing the region zoom-in cities layer uses), with a
 * featured slot that cycles through them (photo + Wikipedia blurb when the City
 * doc has one, worker-cached; see enrich:wiki) and a clean list of the rest.
 *
 * Place context only: weather forecasts live in the top-right report.
 */
import { useEffect, useState } from "react";
import { formatPopulation, type City } from "../../lib/cities";
import { useTopCities } from "../../lib/focus/focus-client";
import BroadcastCard, { CardSection } from "./BroadcastCard";

/** Seconds the featured city holds before the slide advances to the next. */
const FEATURED_HOLD_MS = 7000;

/** Other cities: clearly labelled population and capital status. */
function TopCityRow({ city }: { city: City }) {
  const meta = [city.population != null ? `Population ${formatPopulation(city.population)}` : null, city.isCapital ? "capital" : null].filter(Boolean).join(" · ");
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, padding: "4px 0" }}>
      {city.wikiThumb || city.wikiPhoto ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={city.wikiThumb || city.wikiPhoto} alt={`${city.name} city view`}
          style={{ width: 64, height: 44, objectFit: "cover", borderRadius: 4, flexShrink: 0 }} />
      ) : null}
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontWeight: 700, color: "#e6eefb", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {city.name}
        </div>
        {meta ? <div style={{ color: "#8ea3bf", whiteSpace: "nowrap" }}>{meta}</div> : null}
      </div>
    </div>
  );
}

export default function TopCitiesPanel({
  bbox,
  cc,
  color = "#3f8f8f",
}: {
  bbox: [number, number, number, number];
  cc?: string;
  color?: string;
}) {
  // Top cities in view, climate baked in — served from the one /api/focus bundle
  // when it frames this bbox, else a live bbox fetch (rounded dedup + cap inside).
  const cities = useTopCities(bbox, cc);

  // Cycle the featured slot through every top city, biggest first, looping.
  const [slide, setSlide] = useState(0);
  useEffect(() => {
    if (cities.length <= 1) return;
    const iv = setInterval(() => setSlide((n) => n + 1), FEATURED_HOLD_MS);
    return () => clearInterval(iv);
  }, [cities.length]);

  if (!cities.length) return null;

  const featured = cities[slide % cities.length];
  const rest = cities.filter((c) => c !== featured).slice(0, 4);

  return (
    <BroadcastCard accent={color} eyebrow="City Guide">
      {/* Featured city — photo + short blurb; slot cycles through every top city. */}
      <div>
        {featured.wikiPhoto || featured.wikiThumb ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={featured.wikiPhoto || featured.wikiThumb}
            alt={`${featured.name} city view`}
            style={{ width: "100%", height: 190, objectFit: "cover", borderRadius: 7, display: "block", marginBottom: 9 }}
          />
        ) : null}
        <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
          <span style={{ fontSize: 24.2, fontWeight: 800, color: "#fff" }}>{featured.name}</span>
          {formatPopulation(featured.population) ? (
            <span style={{ fontSize: 15.4, fontWeight: 700, color }}>Population {formatPopulation(featured.population)}</span>
          ) : null}
        </div>
        <div style={{ fontSize: 15.4, fontWeight: 600, color: "#aebfd6", marginTop: 2 }}>
          {[featured.country, featured.isCapital ? "capital" : null].filter(Boolean).join(" · ")}
        </div>
        {featured.wikiExtract ? (
          <div
            style={{
              fontSize: 14.3,
              lineHeight: 1.5,
              color: "#cdd9ec",
              marginTop: 7,
              display: "-webkit-box",
              WebkitLineClamp: 3,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {featured.wikiExtract}
          </div>
        ) : null}
      </div>

      {/* Other major cities in the area. */}
      {rest.length ? (
        <CardSection style={{ fontSize: 14.3 }}>
          {rest.map((c) => (
            <TopCityRow key={c.id} city={c} />
          ))}
        </CardSection>
      ) : null}
    </BroadcastCard>
  );
}
