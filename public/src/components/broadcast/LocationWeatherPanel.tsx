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

function LocationTile({ location, theme, detailed }: { location: WeatherLocation; theme: BroadcastTheme; detailed: boolean }) {
  const { days, loading } = usePointForecast([location.lng, location.lat]);
  const today = days[0];
  const tomorrow = days[1];
  const hazard = today?.hazards[0];

  return (
    <div
      style={{
        position: "relative",
        minWidth: 0,
        minHeight: 96,
        padding: "7px 9px",
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
            whiteSpace: detailed ? "normal" : "nowrap",
          }}
        >
          {location.label.toUpperCase()}
        </div>
        <div style={{ color: INK_FAINT, fontFamily: MONO, fontSize: 9.5, marginTop: 2 }}>
          {Math.abs(location.lat).toFixed(2)}°{location.lat >= 0 ? "N" : "S"} · {Math.abs(location.lng).toFixed(2)}°{location.lng >= 0 ? "E" : "W"}
        </div>
      </div>

      {today ? (
        <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
          <WeatherGlyph condition={today.condition} size={31} />
          <div>
            <div style={{ color: "#f3f7ff", fontSize: 18, lineHeight: 1.1, fontVariantNumeric: "tabular-nums" }}>
              <div style={{ color: INK_DIM, fontSize: 10, marginBottom: 4 }}>Today’s high / low (°C)</div>
              {temperature(today)}
            </div>
            {!detailed && <div style={{ color: INK_DIM, fontFamily: MONO, fontSize: 9.5, marginTop: 4 }}>
              Tomorrow {temperature(tomorrow)}
            </div>}
          </div>
        </div>
      ) : (
        <div style={{ color: INK_FAINT, fontFamily: MONO, fontSize: 11, paddingTop: 10 }}>
          {loading ? "LOADING FORECAST…" : "FORECAST UNAVAILABLE"}
        </div>
      )}
      {detailed && today && (
        <>
          <div style={{ color: INK_DIM, fontFamily: MONO, fontSize: 11 }}>Conditions: {today.condition.replace(/-/g, " ")}</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, padding: "10px 0", borderTop: `1px solid ${GODS_TILE_BORDER}`, color: INK_DIM, fontSize: 12 }}>
            <div>Wind {today.windAvg == null ? "—" : `${formatReading(today.windAvg)} m/s`}</div>
            <div>Gusts {today.gustMax == null ? "—" : `${formatReading(today.gustMax)} m/s`}</div>
            <div>Chance of rain {today.precipChance == null ? "—" : `${today.precipChance}%`}</div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            {days.slice(1, 3).map((day) => (
              <div key={day.date} style={{ flex: 1, padding: 8, border: `1px solid ${GODS_TILE_BORDER}`, color: INK_DIM, fontSize: 11 }}>
                <div>{day.label}</div>
                <WeatherGlyph condition={day.condition} size={25} />
                <div>High / low (°C)</div>
                <div>{temperature(day)}</div>
                <div>Chance of rain {day.precipChance == null ? "—" : `${day.precipChance}%`}</div>
              </div>
            ))}
          </div>
          {today.hazards.length > 0 && <div style={{ color: theme.accent, fontSize: 11 }}>Forecast risks: {today.hazards.map((item) => item.label).join(" · ")}</div>}
        </>
      )}
    </div>
  );
}

export default function LocationWeatherPanel({
  locations,
  theme = DEFAULT_THEME,
  areaName,
  detailed = false,
}: {
  locations: WeatherLocation[];
  areaName?: string;
  detailed?: boolean;
  theme?: BroadcastTheme;
}) {
  return (
    <GodsPanel width={400} notch={[14, 22]} padding="18px 22px 20px" gap={12} style={{ pointerEvents: "none" }}>
      <GodsPanelHeader
        title={detailed ? "TARGET WEATHER" : areaName ? "CITY WEATHER" : "LOCATION WEATHER"}
        tag={detailed ? "3-DAY OUTLOOK" : areaName ? `${locations.length} CITIES` : `${locations.length} LOCATIONS`}
        accent={theme.accent}
      />
      {areaName && <div style={{ color: INK_DIM, fontSize: 13 }}>{areaName} · largest cities by population</div>}
      {!locations.length && <div style={{ color: INK_FAINT, fontSize: 12 }}>City forecasts unavailable</div>}
      <div style={{ display: "grid", gridTemplateColumns: locations.length === 1 ? "1fr" : "1fr 1fr", gap: 8 }}>
        {locations.map((location, index) => (
          <LocationTile key={`${location.label}:${location.lat}:${location.lng}:${index}`} location={location} theme={theme} detailed={detailed} />
        ))}
      </div>
    </GodsPanel>
  );
}
