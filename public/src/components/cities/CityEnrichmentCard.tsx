"use client";

import type { City } from "../../lib/cities";

const muted = "#8b95a7";

function formatDate(value?: Date): string {
  if (!value) return "Not run";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString();
}

export function cityEnrichmentStatus(city: City): { label: string; color: string } {
  if (city.wikiTitle || city.wikiThumb || city.wikiExtract) return { label: "Enriched", color: "#34d399" };
  if (city.wikiFetchedAt) return { label: "Checked — no match", color: "#fbbf24" };
  return { label: "Not enriched", color: muted };
}

export default function CityEnrichmentCard({ city, onClose }: { city: City; onClose: () => void }) {
  const status = cityEnrichmentStatus(city);
  const articleUrl = city.wikiTitle
    ? `https://en.wikipedia.org/wiki/${encodeURIComponent(city.wikiTitle.replace(/ /g, "_"))}`
    : null;

  return (
    <article style={{ marginTop: 16, padding: 14, borderRadius: 8, border: "1px solid #1b2030", background: "#0c111c" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}>
        <div>
          <strong>{city.isCapital ? "★ " : ""}{city.name}</strong>
          <div style={{ color: muted, fontSize: 12, marginTop: 3 }}>{city.country || "Unknown country"}</div>
        </div>
        <button type="button" onClick={onClose} aria-label="Close city details" style={{ border: 0, background: "none", color: muted, cursor: "pointer", fontSize: 18 }}>×</button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: (city.wikiPhoto || city.wikiThumb) ? "110px minmax(0, 1fr)" : "1fr", gap: 12, marginTop: 12 }}>
        {(city.wikiPhoto || city.wikiThumb) && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={city.wikiPhoto || city.wikiThumb} alt="" style={{ width: 110, height: 84, objectFit: "cover", borderRadius: 6, background: "#080b11" }} />
        )}
        <div>
          <div style={{ color: status.color, fontSize: 12 }}>● {status.label}</div>
          <div style={{ color: muted, fontSize: 11, marginTop: 3 }}>Wikipedia checked: {formatDate(city.wikiFetchedAt)}</div>
          {city.wikiTitle && <div style={{ color: "#cbd5e1", fontSize: 12, marginTop: 6 }}>{city.wikiTitle}</div>}
          {(city.foundedYear || city.areaKm2 || city.elevationM) && (
            <div style={{ color: muted, fontSize: 11, marginTop: 4 }}>
              {[
                city.foundedYear ? `founded ${city.foundedYear}` : undefined,
                city.areaKm2 ? `${city.areaKm2.toLocaleString()} km²` : undefined,
                city.elevationM != null ? `${city.elevationM.toLocaleString()} m elevation` : undefined,
              ]
                .filter(Boolean)
                .join(" · ")}
            </div>
          )}
          {city.wikiExtract && <p style={{ color: "#cbd5e1", fontSize: 12, lineHeight: 1.45, margin: "7px 0 0" }}>{city.wikiExtract}</p>}
          {articleUrl && <a href={articleUrl} target="_blank" rel="noreferrer" style={{ color: "#60a5fa", fontSize: 12, display: "inline-block", marginTop: 7 }}>Open Wikipedia ↗</a>}
        </div>
      </div>
      {city.wikiGallery && city.wikiGallery.length > 0 && (
        <div style={{ display: "flex", gap: 4, marginTop: 10, overflowX: "auto" }}>
          {city.wikiGallery.map((url) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={url}
              src={url}
              alt=""
              style={{ width: 60, height: 44, objectFit: "cover", borderRadius: 4, background: "#080b11", flexShrink: 0 }}
            />
          ))}
        </div>
      )}
    </article>
  );
}
