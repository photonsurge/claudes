"use client";

/**
 * Side panel shown when a region row is selected on /regions: photo, group,
 * latest bbox-averaged area-weather snapshot, Wikipedia blurb, and a link
 * through to the region's full detail page. Mirrors CountryEnrichmentCard.
 */
import Link from "next/link";
import { regionEnrichmentStatus, type RegionWithWeather } from "../../lib/regions";
import { asOf } from "../tracks/styles";

function formatDate(v?: string | Date): string {
  return v ? new Date(v).toLocaleString() : "—";
}

export default function RegionEnrichmentCard({
  region,
  onClose,
}: {
  region: RegionWithWeather;
  onClose: () => void;
}) {
  const status = regionEnrichmentStatus(region);

  return (
    <div style={{ marginTop: 16, border: "1px solid #1b2030", borderRadius: 8, background: "#0c111c", padding: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, gap: 8 }}>
        <strong style={{ fontSize: 14 }}>{region.name}</strong>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close preview"
          style={{ background: "none", border: "none", color: "#8b95a7", cursor: "pointer", fontSize: 16 }}
        >
          ×
        </button>
      </div>

      {(region.wikiPhoto || region.wikiThumb) && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={region.wikiPhoto || region.wikiThumb}
          alt=""
          style={{ width: "100%", height: 140, objectFit: "cover", borderRadius: 6, background: "#080b11" }}
        />
      )}

      <div style={{ ...asOf, marginTop: 8 }}>
        <span style={{ color: status.color }}>● {status.label}</span>
        {"  ·  "}
        {region.group}
      </div>

      {region.weather && (
        <div style={{ marginTop: 10, border: "1px solid #1b2030", borderRadius: 6, padding: 8 }}>
          <div style={{ ...asOf, textTransform: "uppercase", letterSpacing: 0.6, fontSize: 10, marginTop: 0 }}>
            Latest area-weather ({formatDate(region.weather.generatedAt)})
          </div>
          {region.weather.stats.map((s) => (
            <div key={s.variable} style={asOf}>
              {s.variable}: {s.mean.toFixed(1)}
              {s.units} (min {s.min.toFixed(1)}, max {s.max.toFixed(1)}, n={s.count})
            </div>
          ))}
          {region.weather.hazards.map((h) => (
            <div key={h.hazard} style={{ ...asOf, color: "#f97316" }}>
              ⚠ {h.label}
            </div>
          ))}
        </div>
      )}

      {region.wikiExtract && (
        <div style={{ marginTop: 10 }}>
          <div style={{ ...asOf, textTransform: "uppercase", letterSpacing: 0.6, fontSize: 10 }}>About</div>
          <p style={{ color: "#cbd5e1", fontSize: 12, lineHeight: 1.45, margin: "4px 0 0" }}>{region.wikiExtract}</p>
        </div>
      )}

      <div style={{ display: "flex", gap: 12, marginTop: 10, flexWrap: "wrap" }}>
        <Link href={`/regions/${encodeURIComponent(region.regionId)}`} style={{ color: "#60a5fa", fontSize: 12 }}>
          Open full page →
        </Link>
        {region.wikiTitle && (
          <a
            href={`https://en.wikipedia.org/wiki/${encodeURIComponent(region.wikiTitle.replace(/ /g, "_"))}`}
            target="_blank"
            rel="noreferrer"
            style={{ color: "#60a5fa", fontSize: 12 }}
          >
            Wikipedia ↗
          </a>
        )}
      </div>
    </div>
  );
}
