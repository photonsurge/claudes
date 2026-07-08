"use client";

import type { City } from "../../lib/cities";
import { usePointForecast, type ForecastDay } from "../../lib/forecast-client";

const muted = "#8b95a7";

function formatTemp(value: number | null): string {
  return value == null ? "--" : `${Math.round(value)}°`;
}

function forecastMeta(day: ForecastDay): string {
  const rain = day.precipChance != null ? `${day.precipChance}% rain` : "rain --";
  const wind = day.windAvg != null ? `${day.windAvg.toFixed(1)} m/s wind` : "wind --";
  return `${rain} · ${wind}`;
}

export default function CityUpcomingForecast({
  city,
  compact = false,
}: {
  city: Pick<City, "name" | "lat" | "lng">;
  compact?: boolean;
}) {
  const forecast = usePointForecast([city.lng, city.lat]);

  return (
    <section
      aria-label={`Upcoming forecast for ${city.name}`}
      style={{
        marginTop: compact ? 12 : 18,
        border: "1px solid #223047",
        borderRadius: 8,
        background: "#0a1220",
        padding: compact ? 10 : 14,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
        <strong style={{ color: "#e2e8f0", fontSize: compact ? 13 : 15 }}>Upcoming forecast</strong>
        <span style={{ color: muted, fontSize: 10 }}>
          {city.lat.toFixed(2)}, {city.lng.toFixed(2)}
        </span>
      </div>

      {forecast.loading && forecast.days.length === 0 && (
        <div style={{ color: muted, fontSize: 12, marginTop: 8 }}>Loading forecast...</div>
      )}
      {!forecast.loading && forecast.days.length === 0 && (
        <div style={{ color: muted, fontSize: 12, marginTop: 8 }}>No upcoming forecast available for this city.</div>
      )}
      {forecast.days.length > 0 && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: `repeat(auto-fit, minmax(${compact ? 116 : 140}px, 1fr))`,
            gap: 8,
            marginTop: 10,
          }}
        >
          {forecast.days.map((day) => (
            <div key={day.date} style={{ border: "1px solid #1b2030", borderRadius: 6, background: "#070c15", padding: compact ? 8 : 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 6, alignItems: "baseline" }}>
                <strong style={{ color: "#bfdbfe", fontSize: 11 }}>{day.label}</strong>
                <span style={{ color: "#93c5fd", fontSize: 10, textTransform: "capitalize", whiteSpace: "nowrap" }}>
                  {day.condition.replace(/-/g, " ")}
                </span>
              </div>
              <div style={{ color: "#f8fafc", fontSize: compact ? 18 : 22, fontWeight: 750, marginTop: 6 }}>
                {formatTemp(day.hiTemp)} <span style={{ color: muted, fontSize: compact ? 12 : 13 }}>{formatTemp(day.loTemp)}</span>
              </div>
              <div style={{ color: muted, fontSize: compact ? 10 : 11, marginTop: 4 }}>{forecastMeta(day)}</div>
              {day.hazards.length > 0 && (
                <div style={{ color: "#fbbf24", fontSize: 10, marginTop: 4 }}>{day.hazards[0].label}</div>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
