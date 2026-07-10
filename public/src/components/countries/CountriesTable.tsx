"use client";

/**
 * Presentational country table for /countries: each name links to the full
 * detail page, a "preview" sub-button selects the row so the page can frame it
 * on the globe. Filtering/selection state lives in the page. Mirrors
 * CitiesTable.tsx (minus TanStack pagination — the catalog is a bounded ~240
 * rows, so it loads and filters client-side in one go).
 */
import Link from "next/link";
import { flagEmoji, countryEnrichmentStatus, type CountryWithWeather } from "../../lib/countries";
import { th, thNum, td } from "../tracks/styles";

const muted = "#8b95a7";

function weatherSummary(c: CountryWithWeather): string {
  const temp = c.weather?.stats.find((s) => s.variable === "temp");
  return temp ? `${Math.round(temp.mean)}°C` : "—";
}

export default function CountriesTable({
  countries,
  totalCount,
  selectedId,
  onSelect,
}: {
  countries: CountryWithWeather[];
  totalCount: number;
  selectedId: string | null;
  onSelect: (country: CountryWithWeather) => void;
}) {
  return (
    <div style={{ overflowX: "auto", border: "1px solid #1b2030", borderRadius: 8, marginTop: 14 }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr style={{ textAlign: "left", color: muted }}>
            <th style={th}>Country</th>
            <th style={th}>Continent</th>
            <th style={th}>Subregion</th>
            <th style={th}>Enrichment</th>
            <th style={thNum}>Weather</th>
          </tr>
        </thead>
        <tbody>
          {countries.map((c) => {
            const status = countryEnrichmentStatus(c);
            const isSel = selectedId === c.id;
            return (
              <tr key={c.id} style={{ borderTop: "1px solid #1b2030", background: isSel ? "#13192a" : undefined }}>
                <td style={td}>
                  <Link
                    href={`/countries/${encodeURIComponent(c.countryId)}`}
                    style={{ color: "#dbeafe", fontWeight: 600, textDecoration: "none" }}
                  >
                    {flagEmoji(c.iso2)} {c.name}
                  </Link>
                  <button
                    type="button"
                    onClick={() => onSelect(c)}
                    aria-label={`Preview ${c.name}`}
                    style={{ display: "block", border: 0, padding: 0, marginTop: 2, background: "none", color: muted, cursor: "pointer", fontSize: 10 }}
                  >
                    preview on globe
                  </button>
                </td>
                <td style={{ ...td, color: muted }}>{c.continent ?? "—"}</td>
                <td style={{ ...td, color: muted }}>{c.subregion ?? "—"}</td>
                <td style={{ ...td, color: status.color, whiteSpace: "nowrap" }}>● {status.label}</td>
                <td style={{ ...td, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{weatherSummary(c)}</td>
              </tr>
            );
          })}
          {countries.length === 0 && (
            <tr>
              <td style={{ ...td, padding: 18, color: muted }} colSpan={5}>
                {totalCount === 0 ? "No countries seeded yet — hit Reseed catalog." : "No countries match this search."}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
