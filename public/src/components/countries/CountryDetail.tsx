"use client";

/**
 * /countries/[id] body: the full country record — flag header, region facts,
 * latest area-weather + recent-history trend charts, a boundary-glow globe
 * preview, Wikipedia enrichment and gallery. Mirrors CityDetail.tsx, but the
 * weather signal is the country's polygon-masked area-weather history rather
 * than a single point forecast.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { DEFAULT_CONTROL_STATE } from "@photonsurge/shared/control";
import { flagEmoji, getCountry, countryEnrichmentStatus, type CountryDetail as CountryDetailData } from "../../lib/countries";
import { areaWeatherSeries } from "../../lib/area-weather";
import GlobeView, { type GlobeHandle } from "../GlobeView";
import { MiniChart } from "../broadcast/PointHistoryPanel";

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

export default function CountryDetail({ id }: { id: string }) {
  const [data, setData] = useState<CountryDetailData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const globe = useRef<GlobeHandle | null>(null);

  useEffect(() => {
    let active = true;
    getCountry(id).then((result) => {
      if (!active) return;
      if (result.detail) setData(result.detail);
      else setError(result.error ?? "Country not found.");
    });
    return () => { active = false; };
  }, [id]);

  const country = data?.country ?? null;

  const previewState = useMemo(() => country ? ({
    ...DEFAULT_CONTROL_STATE,
    activeVariable: null,
    showWind: false,
    showCities: false,
    camera: {
      center: [(country.bbox[0] + country.bbox[2]) / 2, (country.bbox[1] + country.bbox[3]) / 2] as [number, number],
      zoom: 3,
    },
  }) : null, [country]);

  // Frame the whole country once the record (and its bbox) lands.
  useEffect(() => {
    if (country) globe.current?.fitBounds(country.bbox);
  }, [country]);

  if (!country && !error) return <div style={{ ...panel, padding: 20, color: muted }}>Loading country…</div>;
  if (!country) return <div role="alert" style={{ ...panel, padding: 20, color: "#fca5a5" }}>{error}</div>;

  const status = countryEnrichmentStatus(country);
  const series = areaWeatherSeries(data?.history ?? []);
  const latest = data?.weather ?? null;
  const articleUrl = country.wikiTitle
    ? `https://en.wikipedia.org/wiki/${encodeURIComponent(country.wikiTitle.replace(/ /g, "_"))}`
    : null;

  return (
    <div>
      <article style={{ ...panel, padding: 20 }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}>
              <h1 style={{ margin: 0, fontSize: 28 }}>{flagEmoji(country.iso2)} {country.name}</h1>
              <span style={{ color: status.color, fontSize: 12 }}>● {status.label}</span>
            </div>
            <div style={{ color: muted, marginTop: 5 }}>
              {[country.continent, country.subregion].filter(Boolean).join(" · ") || "Region metadata unavailable"}
            </div>
          </div>
          {articleUrl && <a href={articleUrl} target="_blank" rel="noreferrer" style={linkButton}>Wikipedia ↗</a>}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: (country.wikiPhoto || country.wikiThumb) ? "minmax(260px, .8fr) minmax(0, 1.2fr)" : "1fr", gap: 22, marginTop: 22 }}>
          {(country.wikiPhoto || country.wikiThumb) && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={country.wikiPhoto || country.wikiThumb} alt="" style={{ width: "100%", maxHeight: 380, objectFit: "cover", borderRadius: 8, background: "#080b11" }} />
          )}
          <div>
            <h2 style={{ fontSize: 14, margin: "0 0 12px" }}>Country data</h2>
            <dl style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "16px 20px", margin: 0 }}>
              <Field label="Capital">{country.capital || "—"}</Field>
              <Field label="Population">{country.population?.toLocaleString() || "—"}</Field>
              <Field label="Currency">{country.currency || "—"}</Field>
              <Field label="Continent">{country.continent || "—"}</Field>
              <Field label="Subregion">{country.subregion || "—"}</Field>
              <Field label="ISO codes">{[country.iso2?.toUpperCase(), country.iso3?.toUpperCase()].filter(Boolean).join(" · ") || "—"}</Field>
              <Field label="Catalog ID">{country.countryId}</Field>
              <Field label="Bounding box">{country.bbox.map((n) => n.toFixed(1)).join(", ")}</Field>
            </dl>
            {country.wikiExtract && <p style={{ color: "#cbd5e1", lineHeight: 1.6, fontSize: 14, margin: "20px 0 0" }}>{country.wikiExtract}</p>}
          </div>
        </div>

        {country.wikiGallery && country.wikiGallery.length > 0 && (
          <div style={{ display: "flex", gap: 6, marginTop: 14, overflowX: "auto" }}>
            {country.wikiGallery.map((url) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={url} src={url} alt="" style={{ width: 120, height: 88, objectFit: "cover", borderRadius: 6, background: "#080b11", flexShrink: 0 }} />
            ))}
          </div>
        )}

        <h2 style={{ fontSize: 14, margin: "24px 0 12px" }}>Wikipedia enrichment</h2>
        <dl style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "16px 20px", margin: 0 }}>
          <Field label="Result">{status.label}</Field>
          <Field label="Article title">{country.wikiTitle || "—"}</Field>
          <Field label="Last checked">{formatDate(country.wikiFetchedAt)}</Field>
        </dl>
      </article>

      {previewState && (
        <section style={{ ...panel, marginTop: 16, overflow: "hidden" }}>
          <div style={{ padding: "12px 15px", borderBottom: "1px solid #1b2030", color: "#cbd5e1", fontSize: 13 }}>Location preview</div>
          <div style={{ position: "relative", height: 420 }}>
            <GlobeView ref={globe} state={previewState} manifest={null} cities={[]} glowCountryIso={country.iso2 ?? null} interactive />
          </div>
        </section>
      )}

      <section style={{ ...panel, marginTop: 16, padding: 15 }}>
        <div style={{ color: "#cbd5e1", fontSize: 13 }}>Area-weather</div>
        <div style={{ color: muted, fontSize: 11, marginTop: 3 }}>
          {latest
            ? `Latest snapshot ${formatDate(latest.generatedAt)} · polygon-masked over the whole country`
            : "No area-weather snapshot yet — run the hourly job or hit Refresh weather on the catalog page."}
        </div>
        {latest && latest.hazards.length > 0 && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
            {latest.hazards.map((h) => (
              <span key={h.hazard} style={{ color: "#f97316", border: "1px solid #7c3a12", borderRadius: 5, padding: "2px 8px", fontSize: 12 }}>
                ⚠ {h.label}
              </span>
            ))}
          </div>
        )}
        {series.length > 0 && (
          <>
            <div style={historySectionLabel}>Recent trend</div>
            <div style={historyGrid}>
              {series.map((s) => (
                <div key={s.variable} style={historyCard}>
                  <MiniChart label={s.label} color={s.color} units={s.units} points={s.points} avg={s.avg} caption={s.caption} />
                </div>
              ))}
            </div>
          </>
        )}
      </section>

      <details style={{ ...panel, padding: 14, marginTop: 16 }}>
        <summary style={{ color: muted, cursor: "pointer", fontSize: 12 }}>Raw country record</summary>
        <pre style={{ margin: "12px 0 0", color: "#aab4c5", fontSize: 11, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
          {JSON.stringify({ ...country, geometry: country.geometry ? "[geometry omitted]" : undefined }, null, 2)}
        </pre>
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
