"use client";

import { useEffect, useMemo, useState } from "react";
import { DEFAULT_CONTROL_STATE } from "@photonsurge/shared/control";
import { getCity, type City } from "../../lib/cities";
import { HISTORY_WINDOW_HOURS, useClimateYear, usePointHistory } from "../../lib/history-client";
import GlobeView from "../GlobeView";
import { MiniChart, buildClimateRows } from "../broadcast/PointHistoryPanel";
import { cityEnrichmentStatus } from "./CityEnrichmentCard";
import CityUpcomingForecast from "./CityUpcomingForecast";

const muted = "#8b95a7";
const panel = { border: "1px solid #1b2030", borderRadius: 9, background: "#0c111c" } as const;
const HISTORY_COLOR: Record<string, string> = {
  temp: "#e66767",
  humidity: "#199e70",
  wind: "#9085e9",
  gust: "#d55181",
  rain: "#3987e5",
  storm: "#d95926",
  pressure: "#c98500",
  cloud: "#008300",
  snow: "#3987e5",
  sst: "#199e70",
  current: "#9085e9",
  salinity: "#d55181",
  wave: "#3987e5",
  radar: "#d95926",
};
const HISTORY_LABEL: Record<string, string> = {
  temp: "TEMPERATURE",
  humidity: "HUMIDITY",
  wind: "WIND",
  gust: "GUSTS",
  rain: "RAIN RATE",
  storm: "CAPE",
  pressure: "PRESSURE",
  cloud: "CLOUD COVER",
  snow: "SNOW DEPTH",
  sst: "SEA TEMP",
  current: "CURRENT",
  salinity: "SALINITY",
  wave: "WAVE HEIGHT",
  radar: "RADAR",
};

function formatDate(value?: Date): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString();
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt style={{ color: muted, fontSize: 10, textTransform: "uppercase", letterSpacing: ".06em" }}>{label}</dt>
      <dd style={{ margin: "4px 0 0", color: "#e2e8f0", fontSize: 14, overflowWrap: "anywhere" }}>{children ?? "—"}</dd>
    </div>
  );
}

function CityWeatherHistory({ city }: { city: City }) {
  const center: [number, number] = [city.lng, city.lat];
  const point = usePointHistory(center);
  const climate = useClimateYear(center, "monthly");
  const liveCharts = point.series.map((s) => ({
    variable: s.variable,
    units: s.units,
    points: s.series.map((p) => ({ t: p.t, value: p.value ?? p.speed ?? null })),
    avg: s.stats?.avg ?? null,
    caption: s.stats
      ? `avg ${formatHistoryReading(s.stats.avg)} · min ${formatHistoryReading(s.stats.min)} · max ${formatHistoryReading(s.stats.max)}`
      : "",
  }));
  const climateRows = buildClimateRows(climate.datasets);
  const hasCharts = liveCharts.length > 0 || climateRows.length > 0;

  return (
    <section style={{ ...panel, marginTop: 16, padding: 15 }}>
      <div style={{ color: "#cbd5e1", fontSize: 13 }}>Weather history</div>
      <div style={{ color: muted, fontSize: 11, marginTop: 3 }}>
        Point data at {city.lat.toFixed(5)}, {city.lng.toFixed(5)} · recent archive and past-year climate
      </div>
      {!hasCharts ? (
        <div style={{ marginTop: 12, color: muted, fontSize: 13 }}>
          {point.loading || climate.loading ? "Loading weather history…" : "No weather history available for this city yet."}
        </div>
      ) : (
        <>
          {liveCharts.length ? (
            <>
              <div style={historySectionLabel}>Last {HISTORY_WINDOW_HOURS} hours</div>
              <div style={historyGrid}>
                {liveCharts.map((c) => (
                  <div key={c.variable} style={historyCard}>
                    <MiniChart
                      label={HISTORY_LABEL[c.variable] ?? c.variable.toUpperCase()}
                      color={HISTORY_COLOR[c.variable] ?? "#3987e5"}
                      units={c.units}
                      points={c.points}
                      avg={c.avg}
                      caption={c.caption}
                    />
                  </div>
                ))}
              </div>
            </>
          ) : null}
          {climateRows.length ? (
            <>
              <div style={historySectionLabel}>Past year</div>
              <div style={historyGrid}>
                {climateRows.map((row) => (
                  <div key={row.variable} style={historyCard}>
                    <MiniChart
                      label={row.label}
                      color={row.color}
                      units={row.units}
                      points={row.points}
                      avg={row.avg}
                      caption={row.caption}
                    />
                  </div>
                ))}
              </div>
            </>
          ) : null}
        </>
      )}
    </section>
  );
}

function formatHistoryReading(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 100) return String(Math.round(v));
  return (Math.round(v * 10) / 10).toString();
}

export default function CityDetail({ id }: { id: string }) {
  const [city, setCity] = useState<City | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    getCity(id).then((result) => {
      if (!active) return;
      if (result.city) setCity(result.city);
      else setError(result.error ?? "City not found.");
    });
    return () => { active = false; };
  }, [id]);

  const previewState = useMemo(() => city ? ({
    ...DEFAULT_CONTROL_STATE,
    activeVariable: null,
    showWind: false,
    showCities: true,
    camera: { center: [city.lng, city.lat] as [number, number], zoom: 5 },
  }) : null, [city]);

  if (!city && !error) return <div style={{ ...panel, padding: 20, color: muted }}>Loading city…</div>;
  if (!city) return <div role="alert" style={{ ...panel, padding: 20, color: "#fca5a5" }}>{error}</div>;

  const status = cityEnrichmentStatus(city);
  const articleUrl = city.wikiTitle
    ? `https://en.wikipedia.org/wiki/${encodeURIComponent(city.wikiTitle.replace(/ /g, "_"))}`
    : null;
  const osmUrl = `https://www.openstreetmap.org/?mlat=${city.lat}&mlon=${city.lng}#map=10/${city.lat}/${city.lng}`;

  return (
    <div>
      <article style={{ ...panel, padding: 20 }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}>
              <h1 style={{ margin: 0, fontSize: 28 }}>{city.name}</h1>
              {city.isCapital && <span style={{ color: "#ffd76a", fontSize: 12 }}>★ capital</span>}
              <span style={{ color: status.color, fontSize: 12 }}>● {status.label}</span>
            </div>
            <div style={{ color: muted, marginTop: 5 }}>
              {[city.region, city.country, city.cc].filter(Boolean).join(" · ") || "Location metadata unavailable"}
            </div>
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            {articleUrl && <a href={articleUrl} target="_blank" rel="noreferrer" style={linkButton}>Wikipedia ↗</a>}
            <a href={osmUrl} target="_blank" rel="noreferrer" style={linkButton}>Open map ↗</a>
          </div>
        </div>

        <CityUpcomingForecast city={city} />

        <div style={{ display: "grid", gridTemplateColumns: (city.wikiPhoto || city.wikiThumb) ? "minmax(260px, .8fr) minmax(0, 1.2fr)" : "1fr", gap: 22, marginTop: 22 }}>
          {(city.wikiPhoto || city.wikiThumb) && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={city.wikiPhoto || city.wikiThumb} alt="" style={{ width: "100%", maxHeight: 380, objectFit: "cover", borderRadius: 8, background: "#080b11" }} />
          )}
          <div>
            <h2 style={{ fontSize: 14, margin: "0 0 12px" }}>City data</h2>
            <dl style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "16px 20px", margin: 0 }}>
              <Field label="Population">{city.population?.toLocaleString() || "—"}</Field>
              <Field label="Coordinates">{city.lat.toFixed(5)}, {city.lng.toFixed(5)}</Field>
              <Field label="Country code">{city.cc || "—"}</Field>
              <Field label="Region">{city.region || "—"}</Field>
              <Field label="Prominence rank">{city.rank ?? "—"}</Field>
              <Field label="Database ID">{city.id}</Field>
              <Field label="Founded">{city.foundedYear ?? "—"}</Field>
              <Field label="Area">{city.areaKm2 ? `${city.areaKm2.toLocaleString()} km²` : "—"}</Field>
              <Field label="Elevation">{city.elevationM != null ? `${city.elevationM.toLocaleString()} m` : "—"}</Field>
            </dl>
            {city.wikiExtract && <p style={{ color: "#cbd5e1", lineHeight: 1.6, fontSize: 14, margin: "20px 0 0" }}>{city.wikiExtract}</p>}
          </div>
        </div>

        {city.wikiGallery && city.wikiGallery.length > 0 && (
          <div style={{ display: "flex", gap: 6, marginTop: 14, overflowX: "auto" }}>
            {city.wikiGallery.map((url) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={url}
                src={url}
                alt=""
                style={{ width: 120, height: 88, objectFit: "cover", borderRadius: 6, background: "#080b11", flexShrink: 0 }}
              />
            ))}
          </div>
        )}

        <h2 style={{ fontSize: 14, margin: "24px 0 12px" }}>Wikipedia enrichment</h2>
        <dl style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "16px 20px", margin: 0 }}>
          <Field label="Result">{status.label}</Field>
          <Field label="Article title">{city.wikiTitle || "—"}</Field>
          <Field label="Last checked">{formatDate(city.wikiFetchedAt)}</Field>
          <Field label="Record updated">{formatDate(city.updated)}</Field>
        </dl>
      </article>

      {previewState && (
        <section style={{ ...panel, marginTop: 16, overflow: "hidden" }}>
          <div style={{ padding: "12px 15px", borderBottom: "1px solid #1b2030", color: "#cbd5e1", fontSize: 13 }}>Location preview</div>
          <div style={{ position: "relative", height: 420 }}>
            <GlobeView state={previewState} manifest={null} cities={[city]} interactive />
          </div>
        </section>
      )}

      <CityWeatherHistory city={city} />

      <details style={{ ...panel, padding: 14, marginTop: 16 }}>
        <summary style={{ color: muted, cursor: "pointer", fontSize: 12 }}>Raw city record</summary>
        <pre style={{ margin: "12px 0 0", color: "#aab4c5", fontSize: 11, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{JSON.stringify(city, null, 2)}</pre>
      </details>
    </div>
  );
}

const linkButton: React.CSSProperties = {
  display: "inline-block",
  padding: "7px 11px",
  borderRadius: 6,
  border: "1px solid #2a3344",
  background: "#1a1f2b",
  color: "#dbeafe",
  textDecoration: "none",
  fontSize: 12,
};

const historySectionLabel: React.CSSProperties = {
  margin: "16px 0 8px",
  color: "#8b95a7",
  fontSize: 11,
  fontWeight: 800,
  letterSpacing: 1,
  textTransform: "uppercase",
};
const historyGrid: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))",
  gap: 12,
};
const historyCard: React.CSSProperties = {
  minWidth: 0,
  padding: 12,
  borderRadius: 8,
  border: "1px solid #1b2030",
  background: "#080c14",
};
