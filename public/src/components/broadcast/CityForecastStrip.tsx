"use client";

/**
 * The shared "NOW temperature + compact 3-day hi/lo strip" for one city, the
 * exact weather block CityConditionsPanel reads out on a country spotlight. Split
 * out so the distance-ranked "nearest cities" of a quake (QuakeReport) and a
 * volcano (VolcanoNearbyPanel) can hang the same live forecast off each row,
 * plus a small hook that fetches that weather for a set of city ids (the worker
 * per-city cache, /api/cities/weather?ids=…).
 *
 * Values are the archive's native units (temp °C), formatted with the same
 * `formatReading` the rest of the broadcast stage uses.
 */
import { useEffect, useState } from "react";
import { listCityConditionsByIds, type CityCondition, type CityConditionDay } from "../../lib/cities";
import { formatReading } from "./PointHistoryPanel";
import { TILE_BG } from "./config";

/** Fetch worker-cached now + 3-day forecast for `cityIds`, keyed by id for a
 *  per-row lookup. Re-fetches when the id set changes (order-independent). */
export function useCityWeatherByIds(cityIds: string[]): Map<string, CityCondition> {
  const [byId, setById] = useState<Map<string, CityCondition>>(() => new Map());
  const key = [...cityIds].sort().join(",");

  useEffect(() => {
    let cancelled = false;
    if (!cityIds.length) {
      setById(new Map());
      return;
    }
    listCityConditionsByIds(cityIds).then((rows) => {
      if (!cancelled) setById(new Map(rows.map((r) => [r.cityId, r])));
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return byId;
}

/** `YYYY-MM-DD` → a short day label (TODAY / TMRW / weekday). Local-time based;
 *  the cache's `date` is a UTC-derived calendar day, close enough for a chip. */
export function dayLabel(date: string): string {
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
export function DayChip({ day, color }: { day: CityConditionDay; color: string }) {
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
        background: TILE_BG,
      }}
    >
      <span style={{ fontSize: 9.4, fontWeight: 800, letterSpacing: 0.6, color: "#8ea3bf" }}>{dayLabel(day.date)}</span>
      <span style={{ fontSize: 14.3, fontWeight: 850, color: "#f3f7ff", whiteSpace: "nowrap" }}>
        {day.hi != null ? `${formatReading(day.hi)}°` : "—"}
        <span style={{ fontSize: 10.5, fontWeight: 700, color, marginLeft: 3 }}>
          {day.lo != null ? `${formatReading(day.lo)}°` : ""}
        </span>
      </span>
    </div>
  );
}

/** True when this city's cache actually carries a reading worth rendering. */
export function cityHasWeather(c?: CityCondition | null): boolean {
  return !!c && (c.current?.temp != null || (c.daily?.length ?? 0) > 0);
}

/**
 * The compact weather block for one city — a big "NOW" temperature then up to
 * three day chips. Renders nothing when the cache has no reading, so a caller can
 * drop it inline and the row simply carries no weather.
 */
export function CityForecastStrip({ city, color }: { city?: CityCondition | null; color: string }) {
  if (!cityHasWeather(city)) return null;
  const now = city!.current?.temp;
  const days = (city!.daily ?? []).slice(0, 3);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 3 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 4, minWidth: 44 }}>
        <span style={{ fontSize: 19.8, fontWeight: 850, color: "#fff", lineHeight: 1, whiteSpace: "nowrap" }}>
          {now != null ? `${formatReading(now)}°` : "—"}
        </span>
        <span style={{ fontSize: 8.8, fontWeight: 700, letterSpacing: 0.5, color }}>NOW</span>
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
