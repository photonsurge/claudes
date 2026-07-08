"use client";

/**
 * Side panel shown when a country row is selected on /countries: flag + photo,
 * region facts, latest area-weather snapshot, Wikipedia blurb, and a link
 * through to the country's full detail page. Mirrors CityEnrichmentCard.
 */
import Link from "next/link";
import { flagEmoji, countryEnrichmentStatus, type CountryWithWeather } from "../../lib/countries";
import { asOf } from "../tracks/styles";

function formatDate(v?: string | Date): string {
  return v ? new Date(v).toLocaleString() : "—";
}

export default function CountryEnrichmentCard({
  country,
  onClose,
}: {
  country: CountryWithWeather;
  onClose: () => void;
}) {
  const status = countryEnrichmentStatus(country);
  const facts = [
    country.capital ? `Capital: ${country.capital}` : undefined,
    country.population ? `Pop. ${country.population.toLocaleString()}` : undefined,
    country.currency,
  ].filter(Boolean);

  return (
    <div style={{ marginTop: 16, border: "1px solid #1b2030", borderRadius: 8, background: "#0c111c", padding: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, gap: 8 }}>
        <strong style={{ fontSize: 14 }}>
          {flagEmoji(country.iso2)} {country.name}
        </strong>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close preview"
          style={{ background: "none", border: "none", color: "#8b95a7", cursor: "pointer", fontSize: 16 }}
        >
          ×
        </button>
      </div>

      {(country.wikiPhoto || country.wikiThumb) && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={country.wikiPhoto || country.wikiThumb}
          alt=""
          style={{ width: "100%", height: 140, objectFit: "cover", borderRadius: 6, background: "#080b11" }}
        />
      )}

      <div style={{ ...asOf, marginTop: 8 }}>
        <span style={{ color: status.color }}>● {status.label}</span>
        {"  ·  "}
        {[country.continent, country.subregion].filter(Boolean).join(" · ") || "—"}
      </div>
      {facts.length > 0 && <div style={asOf}>{facts.join(" · ")}</div>}

      {country.weather && (
        <div style={{ marginTop: 10, border: "1px solid #1b2030", borderRadius: 6, padding: 8 }}>
          <div style={{ ...asOf, textTransform: "uppercase", letterSpacing: 0.6, fontSize: 10, marginTop: 0 }}>
            Latest area-weather ({formatDate(country.weather.generatedAt)})
          </div>
          {country.weather.stats.map((s) => (
            <div key={s.variable} style={asOf}>
              {s.variable}: {s.mean.toFixed(1)}
              {s.units} (min {s.min.toFixed(1)}, max {s.max.toFixed(1)}, n={s.count})
            </div>
          ))}
          {country.weather.hazards.map((h) => (
            <div key={h.hazard} style={{ ...asOf, color: "#f97316" }}>
              ⚠ {h.label}
            </div>
          ))}
        </div>
      )}

      {country.wikiExtract && (
        <div style={{ marginTop: 10 }}>
          <div style={{ ...asOf, textTransform: "uppercase", letterSpacing: 0.6, fontSize: 10 }}>About</div>
          <p style={{ color: "#cbd5e1", fontSize: 12, lineHeight: 1.45, margin: "4px 0 0" }}>{country.wikiExtract}</p>
        </div>
      )}

      <div style={{ display: "flex", gap: 12, marginTop: 10, flexWrap: "wrap" }}>
        <Link href={`/countries/${encodeURIComponent(country.countryId)}`} style={{ color: "#60a5fa", fontSize: 12 }}>
          Open full page →
        </Link>
        {country.wikiTitle && (
          <a
            href={`https://en.wikipedia.org/wiki/${encodeURIComponent(country.wikiTitle.replace(/ /g, "_"))}`}
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
