"use client";

/**
 * LOCATION WEATHER — point forecasts for the places explicitly chosen on the
 * scene's World report admin form. This deliberately replaces the old
 * whole-planet area forecast: a single condition icon or daily high/low has no
 * meaningful interpretation across the entire Earth.
 */
import type { WeatherLocation } from "@photonsurge/shared/control";
import { usePointForecast, type ForecastDay } from "../../lib/forecast-client";
import { DEFAULT_THEME, type BroadcastTheme } from "./config";
import { GODS_TILE, GODS_TILE_BORDER, GodsPanel, GodsPanelHeader, INK_DIM, INK_FAINT, MONO } from "./GodsPanel";
import { WeatherGlyph, WarnTriangle } from "./glyphs";
import { SEVERITY_COLORS } from "@photonsurge/shared/alerts/severity";
import { formatReading } from "./PointHistoryPanel";

function temperature(day: ForecastDay | undefined): string {
  if (!day || day.hiTemp == null || day.loTemp == null) return "—";
  return `${formatReading(day.hiTemp)}° / ${formatReading(day.loTemp)}°`;
}

function LocationTile({ location, theme }: { location: WeatherLocation; theme: BroadcastTheme }) {
  const { days, loading } = usePointForecast([location.lng, location.lat]);
  const today = days[0];
  const tomorrow = days[1];
  const hazard = today?.hazards[0];

  return (
    <div
      style={{
        position: "relative",
        minWidth: 0,
        minHeight: 116,
        padding: "10px 11px",
        background: GODS_TILE,
        border: `1px solid ${GODS_TILE_BORDER}`,
        display: "flex",
        flexDirection: "column",
        gap: 7,
      }}
    >
      {hazard ? (
        <div
          title={hazard.label}
          style={{
            position: "absolute",
            top: -5,
            right: -4,
            width: 19,
            height: 19,
            display: "grid",
            placeItems: "center",
            background: SEVERITY_COLORS[hazard.severityRank] ?? theme.accent,
          }}
        >
          <WarnTriangle size={11} />
        </div>
      ) : null}

      <div style={{ minWidth: 0 }}>
        <div
          style={{
            color: theme.accent,
            fontFamily: MONO,
            fontSize: 12,
            fontWeight: 700,
            letterSpacing: 1.1,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {location.label.toUpperCase()}
        </div>
        <div style={{ color: INK_FAINT, fontFamily: MONO, fontSize: 9.5, marginTop: 2 }}>
          {location.lat.toFixed(2)}, {location.lng.toFixed(2)}
        </div>
      </div>

      {today ? (
        <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
          <WeatherGlyph condition={today.condition} size={31} />
          <div>
            <div style={{ color: "#f3f7ff", fontSize: 18, lineHeight: 1.1, fontVariantNumeric: "tabular-nums" }}>
              {temperature(today)}
            </div>
            <div style={{ color: INK_DIM, fontFamily: MONO, fontSize: 9.5, marginTop: 4 }}>
              TOMORROW {temperature(tomorrow)}
            </div>
          </div>
        </div>
      ) : (
        <div style={{ color: INK_FAINT, fontFamily: MONO, fontSize: 11, paddingTop: 10 }}>
          {loading ? "LOADING FORECAST…" : "FORECAST UNAVAILABLE"}
        </div>
      )}
    </div>
  );
}

export default function LocationWeatherPanel({
  locations,
  theme = DEFAULT_THEME,
}: {
  locations: WeatherLocation[];
  theme?: BroadcastTheme;
}) {
  return (
    <GodsPanel width={400} notch={[14, 22]} padding="18px 22px 20px" gap={12} style={{ pointerEvents: "none" }}>
      <GodsPanelHeader
        title="LOCATION WEATHER"
        tag={`${locations.length} ${locations.length === 1 ? "LOCATION" : "LOCATIONS"}`}
        accent={theme.accent}
      />
      <div style={{ display: "grid", gridTemplateColumns: locations.length === 1 ? "1fr" : "1fr 1fr", gap: 8 }}>
        {locations.map((location, index) => (
          <LocationTile key={`${location.label}:${location.lat}:${location.lng}:${index}`} location={location} theme={theme} />
        ))}
      </div>
    </GodsPanel>
  );
}
