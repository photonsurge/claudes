"use client";

/**
 * Presentational country table for /countries: each name links to the full
 * detail page, a "preview" sub-button selects the row so the page can frame it
 * on the globe. Filtering/selection state lives in the page. Mirrors
 * CitiesTable.tsx (minus TanStack pagination — the catalog is a bounded ~240
 * rows, so it loads and filters client-side in one go).
 */
import Link from "next/link";
import { useMemo, useState } from "react";
import { flagEmoji, countryEnrichmentStatus, type CountryWithWeather } from "../../lib/countries";
import { th, thNum, td } from "../tracks/styles";

const muted = "#8b95a7";
type SortKey = "name" | "continent" | "subregion" | "updated" | "weather";

function weatherSummary(c: CountryWithWeather): string {
  const temp = c.weather?.stats.find((s) => s.variable === "temp");
  return temp ? `${Math.round(temp.mean)}°C` : "—";
}

export default function CountriesTable({
  countries,
  totalCount,
  selectedId,
  onSelect,
  onToggleRoundup,
}: {
  countries: CountryWithWeather[];
  totalCount: number;
  selectedId: string | null;
  onSelect: (country: CountryWithWeather) => void;
  /** Flip a country's AI round-up opt-in. */
  onToggleRoundup: (country: CountryWithWeather, enabled: boolean) => void;
}) {
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [descending, setDescending] = useState(false);
  const rows = useMemo(() => [...countries].sort((a, b) => {
    const result = sortKey === "name" ? a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
      : sortKey === "continent" ? (a.continent ?? "").localeCompare(b.continent ?? "")
        : sortKey === "subregion" ? (a.subregion ?? "").localeCompare(b.subregion ?? "")
          : sortKey === "updated" ? new Date(a.wikiFetchedAt ?? 0).getTime() - new Date(b.wikiFetchedAt ?? 0).getTime()
            : Number(a.weather?.stats.find((s) => s.variable === "temp")?.mean ?? -Infinity)
              - Number(b.weather?.stats.find((s) => s.variable === "temp")?.mean ?? -Infinity);
    return descending ? -result : result;
  }), [countries, descending, sortKey]);
  const sort = (key: SortKey) => { if (key === sortKey) setDescending((value) => !value); else { setSortKey(key); setDescending(key === "updated"); } };
  const header = (key: SortKey, label: string) => <button type="button" onClick={() => sort(key)} style={sortButton}>
    {label} {sortKey === key ? (descending ? "↓" : "↑") : "↕"}
  </button>;
  return (
    <div style={{ overflowX: "auto", border: "1px solid #1b2030", borderRadius: 8, marginTop: 14 }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr style={{ textAlign: "left", color: muted }}>
            <th style={th}>{header("name", "Country")}</th>
            <th style={th}>{header("continent", "Continent")}</th>
            <th style={th}>{header("subregion", "Subregion")}</th>
            <th style={th}>{header("updated", "Enrichment")}</th>
            <th style={thNum}>{header("weather", "Weather")}</th>
            <th style={{ ...thNum, whiteSpace: "nowrap" }} title="AI round-up opt-in">Round-up</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => {
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
                <td style={{ ...td, textAlign: "right" }}>
                  <input
                    type="checkbox"
                    checked={!!c.roundupEnabled}
                    onChange={(e) => onToggleRoundup(c, e.target.checked)}
                    aria-label={`Toggle 12h AI round-up for ${c.name}`}
                    style={{ cursor: "pointer", width: 16, height: 16 }}
                  />
                </td>
              </tr>
            );
          })}
          {countries.length === 0 && (
            <tr>
              <td style={{ ...td, padding: 18, color: muted }} colSpan={6}>
                {totalCount === 0 ? "No countries seeded yet — hit Reseed catalog." : "No countries match this search."}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

const sortButton = { appearance: "none", border: 0, padding: 0, background: "transparent", color: "inherit",
  font: "inherit", fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" } as const;
