"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { DEFAULT_CONTROL_STATE } from "@photonsurge/shared/control";
import { getCity, type City } from "../../lib/cities";
import GlobeView from "../GlobeView";
import PointHistoryPanel from "../broadcast/PointHistoryPanel";
import { cityEnrichmentStatus } from "./CityEnrichmentCard";

const muted = "#8b95a7";
const panel = { border: "1px solid #1b2030", borderRadius: 9, background: "#0c111c" } as const;

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
      <Link href="/cities" style={{ color: "#60a5fa", textDecoration: "none", fontSize: 13 }}>← Cities</Link>

      <article style={{ ...panel, padding: 20, marginTop: 12 }}>
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

      <section style={{ ...panel, marginTop: 16, padding: 15 }}>
        <div style={{ color: "#cbd5e1", fontSize: 13 }}>Weather history</div>
        <div style={{ color: muted, fontSize: 11, marginTop: 3 }}>
          Point data at {city.lat.toFixed(5)}, {city.lng.toFixed(5)} · recent archive and past-year climate
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 12 }}>
          <PointHistoryPanel center={[city.lng, city.lat]} />
        </div>
      </section>

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
