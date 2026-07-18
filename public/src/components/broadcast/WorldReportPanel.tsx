"use client";

/**
 * WORLD REPORT — the deck's "latest hourly report for the world" slide: a
 * whole-planet snapshot off the freshest model run. The globe-wide area
 * forecast (useAreaForecast over the whole-world bbox, lifted to the deck so it
 * doesn't refetch every rotation) gives today's temperature span, peak gust and
 * peak rainfall anywhere on Earth, plus a four-day TODAY/TOMORROW/+2/+3 outlook
 * strip. The run stamp names which cycle it came from. Pointer-inert like the
 * rest of the chrome.
 */
import type { WeatherManifest } from "@photonsurge/shared/manifest";
import type { WorldWatchItem } from "../../lib/broadcast";
import type { AreaForecastDay } from "../../lib/forecast-client";
import { formatReading } from "./PointHistoryPanel";
import { accentBorderRight, GLASS_BG, type BroadcastTheme } from "./config";
import { hazardMeta } from "../../lib/hazard";
import { SEVERITY_COLORS } from "@photonsurge/shared/alerts/severity";
import { BreakdownChip } from "./worldStat";
import FeedSection from "./FeedSection";

const CONDITION_GLYPH: Record<AreaForecastDay["condition"], string> = {
  sunny: "☀️",
  "partly-cloudy": "⛅",
  cloudy: "☁️",
  rain: "🌧️",
  snow: "🌨️",
  storm: "⛈️",
};

/** "12:00Z GFS"-style stamp for the run the report was built from. */
function runLabel(manifest: WeatherManifest | null): string {
  if (!manifest) return "LATEST RUN";
  const model = manifest.model?.toUpperCase() ?? "";
  const d = manifest.run ? new Date(manifest.run) : null;
  if (!d || Number.isNaN(d.getTime())) return model || "LATEST RUN";
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  const mon = d.toLocaleString("en-US", { month: "short", timeZone: "UTC" }).toUpperCase();
  return `${hh}:00Z · ${day} ${mon}${model ? ` · ${model}` : ""}`;
}

/** One "🌡 HI 47°" extreme cell. */
function Extreme({ icon, label, value, color }: { icon: string; label: string; value: string; color: string }) {
  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 0.8, color: "#8fa0b8" }}>{label}</div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 5, marginTop: 3 }}>
        <span style={{ fontSize: 15.4 }}>{icon}</span>
        <span style={{ fontSize: 22, fontWeight: 800, color, lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>
          {value}
        </span>
      </div>
    </div>
  );
}

function DayCell({ day }: { day: AreaForecastDay }) {
  const hi = day.temp?.max;
  const lo = day.temp?.min;
  const topHazard = day.hazards[0];
  return (
    <div
      style={{
        position: "relative",
        flex: 1,
        minWidth: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 3,
        padding: "8px 4px",
        borderRadius: 8,
        background: "rgba(4,10,20,0.55)",
      }}
    >
      {topHazard ? (
        <div
          title={topHazard.label}
          style={{
            position: "absolute",
            top: -6,
            right: -4,
            fontSize: 12.1,
            lineHeight: 1,
            padding: "3px 4px",
            borderRadius: 999,
            background: SEVERITY_COLORS[topHazard.severityRank] ?? "#f97316",
          }}
        >
          {hazardMeta(topHazard.hazard).icon}
        </div>
      ) : null}
      <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: 0.8, color: "#aebdd2" }}>{day.label}</span>
      <span style={{ fontSize: 24.2, lineHeight: 1 }}>{CONDITION_GLYPH[day.condition]}</span>
      <span style={{ fontSize: 15.4, fontWeight: 850, color: "#f3f7ff" }}>
        {hi != null ? formatReading(hi) : "—"}°
        <span style={{ fontSize: 12.1, fontWeight: 700, color: "#9db0ca", marginLeft: 3 }}>
          {lo != null ? `${formatReading(lo)}°` : ""}
        </span>
      </span>
    </div>
  );
}

export default function WorldReportPanel({
  days,
  loading,
  manifest,
  feed,
  theme,
}: {
  days: AreaForecastDay[];
  loading: boolean;
  manifest: WeatherManifest | null;
  /** The global ACTIVE FEED, integrated into the card (like the drill-down
   *  slides) rather than stacked as a separate panel below it. */
  feed: WorldWatchItem[];
  theme: BroadcastTheme;
}) {
  const today = days[0] ?? null;
  const accent = theme.accent;

  return (
    <div
      style={{
        position: "relative",
        width: 400,
        padding: "20px 24px",
        background: GLASS_BG,
        ...accentBorderRight(theme.panelBorder, `5px solid ${accent}`),
        borderRadius: 16,
        boxShadow: `0 12px 36px rgba(0,0,0,0.5), 0 0 20px ${accent}28`,
        backdropFilter: "blur(11px)",
        WebkitBackdropFilter: "blur(11px)",
        pointerEvents: "none",
        fontFamily: "system-ui, sans-serif",
        display: "flex",
        flexDirection: "column",
        gap: 12,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          fontSize: 14.3,
          fontWeight: 800,
          letterSpacing: 1.8,
          color: "#dfe7f5",
        }}
      >
        <span>WORLD REPORT</span>
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.8, color: accent }}>
          {runLabel(manifest)}
        </span>
      </div>

      {today ? (
        <>
          <div style={{ display: "flex", gap: 14 }}>
            <Extreme
              icon="🌡"
              label="WARMEST"
              value={today.temp ? `${formatReading(today.temp.max)}°` : "—"}
              color="#fca5a5"
            />
            <Extreme
              icon="❄"
              label="COLDEST"
              value={today.temp ? `${formatReading(today.temp.min)}°` : "—"}
              color="#93c5fd"
            />
            <Extreme
              icon="💨"
              label="PEAK GUST"
              value={today.gust ? `${formatReading(today.gust.max)}` : "—"}
              color="#a7f3d0"
            />
            <Extreme
              icon="🌧"
              label="MAX RAIN"
              value={today.rain ? `${formatReading(today.rain.max)}` : "—"}
              color="#7dd3fc"
            />
          </div>

          {today.hazards.length > 0 ? (
            <div style={{ display: "flex", flexWrap: "wrap", rowGap: 6, columnGap: 14 }}>
              {today.hazards.map((h) => (
                <BreakdownChip
                  key={h.hazard}
                  label={h.label}
                  count={1}
                  color={SEVERITY_COLORS[h.severityRank] ?? "#f97316"}
                />
              ))}
            </div>
          ) : null}

          <div style={{ display: "flex", gap: 6 }}>
            {days.slice(0, 4).map((d) => (
              <DayCell key={d.date} day={d} />
            ))}
          </div>
        </>
      ) : (
        <div style={{ fontSize: 14.3, fontWeight: 700, color: "#7f8ea6", padding: "8px 0" }}>
          {loading ? "Building latest world report…" : "No world report available."}
        </div>
      )}

      <FeedSection feed={feed} theme={theme} />
    </div>
  );
}
