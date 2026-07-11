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
import { listCityConditions, formatPopulation, type CityCondition, type CityConditionDay } from "../../lib/cities";
import BroadcastCard, { CardSection } from "./BroadcastCard";
import { formatReading } from "./PointHistoryPanel";

const CITY_LIMIT = 10;

/** `YYYY-MM-DD` → a short day label (TODAY / TMRW / weekday). Local-time based;
 *  the cache's `date` is a UTC-derived calendar day, close enough for a chip. */
function dayLabel(date: string): string {
  const d = new Date(`${date}T00:00:00`);
  if (Number.isNaN(d.getTime())) return date.slice(5);
  const today = new Date();
  const dayMs = 24 * 60 * 60 * 1000;
  const diff = Math.round((d.setHours(0, 0, 0, 0) - today.setHours(0, 0, 0, 0)) / dayMs);
  if (diff <= 0) return "TODAY";
  if (diff === 1) return "TMRW";
  return ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"][new Date(`${date}T00:00:00`).getDay()];
}

/** One day chip — label over hi/lo. */
function DayChip({ day, color }: { day: CityConditionDay; color: string }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 1,
        minWidth: 40,
        padding: "3px 4px",
        borderRadius: 6,
        background: "rgba(4,10,20,0.5)",
      }}
    >
      <span style={{ fontSize: 8.5, fontWeight: 800, letterSpacing: 0.6, color: "#8ea3bf" }}>{dayLabel(day.date)}</span>
      <span style={{ fontSize: 13, fontWeight: 850, color: "#f3f7ff", whiteSpace: "nowrap" }}>
        {day.hi != null ? `${formatReading(day.hi)}°` : "—"}
        <span style={{ fontSize: 9.5, fontWeight: 700, color, marginLeft: 3 }}>
          {day.lo != null ? `${formatReading(day.lo)}°` : ""}
        </span>
      </span>
    </div>
  );
}

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
          <div style={{ fontSize: 11, color: "#8ea3bf", whiteSpace: "nowrap" }}>{formatPopulation(city.population)}</div>
        ) : null}
      </div>
      <div style={{ textAlign: "right", minWidth: 46 }}>
        <div style={{ fontSize: 22, fontWeight: 850, color: "#fff", lineHeight: 1, whiteSpace: "nowrap" }}>
          {now != null ? `${formatReading(now)}°` : "—"}
        </div>
        <div style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: 0.5, color }}>NOW</div>
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
      <CardSection first style={{ fontSize: 13 }}>
        {withData.map((c) => (
          <CityRow key={c.cityId} city={c} color={color} />
        ))}
      </CardSection>
    </BroadcastCard>
  );
}
