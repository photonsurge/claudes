"use client";

/**
 * "3-DAY FORECAST" (area variant) — the country / region weather slide. The old
 * area-aggregate ForecastPanel collapsed a whole nation into a single hi/lo,
 * which read as a meaningless number and left most of the card empty. Instead
 * this pages the framed area's TOP FIVE cities, each with its live NOW
 * temperature and a compact 3-day hi/lo strip — the same per-city worker cache
 * CityConditionsPanel reads (listCityConditions / /api/cities/weather), capped
 * to the five biggest so the slide reads as a tight national outlook.
 *
 * Point (single-location) forecasts still use ForecastPanel directly; this is
 * only the bbox / area slot. Pure presentation inside the scaled broadcast
 * stage; self-hides when the cache has no readings for the area yet.
 */
import { useEffect, useState } from "react";
import { listCityConditions, listCityConditionsByCc, formatPopulation, type CityCondition } from "../../lib/cities";
import BroadcastCard, { CardSection } from "./BroadcastCard";
import { formatReading } from "./PointHistoryPanel";
import { DayChip } from "./CityForecastStrip";

/** The five biggest cities is the whole point of this slide — a tight outlook. */
const CITY_LIMIT = 5;

/** One city row — name + population, its "now" temperature, then a 3-day strip. */
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

export default function CityForecastPanel({
  bbox,
  cc,
  color = "#3f8f8f",
}: {
  bbox: [number, number, number, number];
  /** A country spotlight passes its ISO code so the five cities are the
   *  country's OWN biggest (by `cc`), not whatever fell inside the bbox. */
  cc?: string;
  color?: string;
}) {
  const [cities, setCities] = useState<CityCondition[]>([]);
  // Round so a slow-drifting camera doesn't refetch on every imperceptible bbox
  // change (matches CityConditionsPanel / TopCitiesPanel).
  const roundedBbox = bbox.map((v) => v.toFixed(1)).join(",");

  useEffect(() => {
    let cancelled = false;
    const p = cc ? listCityConditionsByCc(cc, CITY_LIMIT) : listCityConditions(bbox, CITY_LIMIT);
    p.then((res) => {
      if (!cancelled) setCities(res);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roundedBbox, cc]);

  // Only cities that actually carry a live reading earn a row; hide the whole
  // slide when the per-city cache has nothing yet for this area.
  const withData = cities.filter((c) => c.current?.temp != null || (c.daily?.length ?? 0) > 0);
  if (!withData.length) return null;

  return (
    <BroadcastCard accent={color} eyebrow="3-Day Forecast">
      <CardSection first style={{ fontSize: 14.3 }}>
        {withData.map((c) => (
          <CityRow key={c.cityId} city={c} color={color} />
        ))}
      </CardSection>
    </BroadcastCard>
  );
}
