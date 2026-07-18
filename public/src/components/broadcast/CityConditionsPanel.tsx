"use client";

/**
 * "CITY CONDITIONS" — the on-air slide of a country spotlight / round-up tour
 * that reads out the framed country's biggest cities WITH LIVE WEATHER: each
 * city's current temperature now and a compact 3-day hi/lo outlook, sourced
 * from the worker's per-city cache (worker/src/jobs/cityWeather.ts) via
 * /api/cities/weather. Sits alongside TopCitiesPanel (which carries the featured
 * photo + past-year climate) as the "what's the weather doing right now across
 * the nation" page. Pure presentation inside the scaled broadcast stage.
 *
 * Values are the archive's native units (temp °C), formatted the same way as
 * ForecastPanel/PointHistoryPanel — the whole broadcast stage reads in °C.
 */
import { useEffect, useState } from "react";
import { listCityConditions, formatPopulation, type CityCondition } from "../../lib/cities";
import BroadcastCard, { CardSection } from "./BroadcastCard";
import { formatReading } from "./PointHistoryPanel";
import { DayChip } from "./CityForecastStrip";

const CITY_LIMIT = 10;

/** One city row — name + population, the "now" temperature, then its 3-day strip. */
function CityRow({ city, color }: { city: CityCondition; color: string }) {
  const now = city.current?.temp;
  const days = (city.daily ?? []).slice(0, 3);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "5px 0" }}>
      <div style={{ minWidth: 0, flex: "1 1 auto" }}>
        <div style={{ fontWeight: 800, color: "#e6eefb", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {city.name}
        </div>
        {formatPopulation(city.population) ? (
          <div style={{ fontSize: 12.1, color: "#8ea3bf", whiteSpace: "nowrap" }}>{formatPopulation(city.population)}</div>
        ) : null}
      </div>
      <div style={{ textAlign: "right", minWidth: 46 }}>
        <div style={{ fontSize: 24.2, fontWeight: 850, color: "#fff", lineHeight: 1, whiteSpace: "nowrap" }}>
          {now != null ? `${formatReading(now)}°` : "—"}
        </div>
        <div style={{ fontSize: 9.4, fontWeight: 700, letterSpacing: 0.5, color }}>NOW</div>
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

export default function CityConditionsPanel({
  bbox,
  color = "#3f8f8f",
}: {
  bbox: [number, number, number, number];
  color?: string;
}) {
  const [cities, setCities] = useState<CityCondition[]>([]);
  // Round so a slow-drifting camera doesn't refetch on every imperceptible bbox
  // change (matches TopCitiesPanel).
  const roundedBbox = bbox.map((v) => v.toFixed(1)).join(",");

  useEffect(() => {
    let cancelled = false;
    listCityConditions(bbox, CITY_LIMIT).then((res) => {
      if (!cancelled) setCities(res);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roundedBbox]);

  // Only cities that actually have a live reading are worth a row here (the
  // photo/climate cities live on TopCitiesPanel); hide the whole slide when the
  // cache has nothing yet for this area.
  const withData = cities.filter((c) => c.current?.temp != null || (c.daily?.length ?? 0) > 0);
  if (!withData.length) return null;

  return (
    <BroadcastCard accent={color} eyebrow="City Conditions">
      <CardSection first style={{ fontSize: 14.3 }}>
        {withData.map((c) => (
          <CityRow key={c.cityId} city={c} color={color} />
        ))}
      </CardSection>
    </BroadcastCard>
  );
}
