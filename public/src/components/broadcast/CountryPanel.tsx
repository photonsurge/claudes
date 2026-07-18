"use client";

/**
 * "THE NATION" — the round-up's opening slide when the tour parks on a country:
 * the place itself. Flag + name headline, a capital/population/currency meta
 * line, the country's Wikipedia hero photo and a short blurb — all from the
 * enriched Country catalog doc (see worker/src/jobs/countries.ts; resolved for
 * the current stop via /api/countries/at). Mirrors TopCitiesPanel's featured
 * block so the country card and its cities read as one system. Self-hides via
 * the caller (no doc → no slide). Pure presentation, pointer-inert.
 */
import type { CountryAt } from "../../lib/countries";
import { flagEmoji } from "../../lib/countries";
import { formatPopulation } from "../../lib/cities";
import { DEFAULT_THEME, type BroadcastTheme } from "./config";
import BroadcastCard from "./BroadcastCard";

export default function CountryPanel({
  country,
  color = "#8a5fd1",
  theme = DEFAULT_THEME,
}: {
  country: CountryAt;
  color?: string;
  theme?: BroadcastTheme;
}) {
  const photo = country.wikiThumb ?? country.wikiPhoto;
  const meta = [
    country.capital ? `Capital ${country.capital}` : null,
    formatPopulation(country.population) ? `Pop. ${formatPopulation(country.population)}` : null,
    country.currency,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <BroadcastCard accent={color} eyebrow="The Nation" theme={theme}>
      {photo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={photo}
          alt={country.name}
          style={{ width: "100%", height: 190, objectFit: "cover", borderRadius: 7, display: "block", marginBottom: 10 }}
        />
      ) : null}

      <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
        <span style={{ fontSize: 33, lineHeight: 1 }}>{flagEmoji(country.iso2)}</span>
        <span style={{ fontSize: 28.6, fontWeight: 800, color: "#fff", lineHeight: 1.05 }}>{country.name}</span>
      </div>

      {meta ? (
        <div style={{ fontSize: 15.4, fontWeight: 600, color: "#aebfd6", marginTop: 5 }}>{meta}</div>
      ) : null}

      {country.wikiExtract ? (
        <div
          style={{
            fontSize: 14.3,
            lineHeight: 1.5,
            color: "#cdd9ec",
            marginTop: 9,
            display: "-webkit-box",
            WebkitLineClamp: 5,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          {country.wikiExtract}
        </div>
      ) : null}
    </BroadcastCard>
  );
}
