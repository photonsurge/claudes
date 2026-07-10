"use client";

/**
 * Presentational region table for /regions (oceans/continents/EU blocs/UK
 * nations): each name links to the full detail page, a "preview" sub-button
 * selects the row so the page can frame its bbox on the globe. Mirrors
 * CountriesTable.tsx minus the flag/continent/subregion (regions have a
 * `group` instead).
 */
import Link from "next/link";
import { regionEnrichmentStatus, type RegionWithWeather } from "../../lib/regions";
import { th, thNum, td } from "../tracks/styles";

const muted = "#8b95a7";

function weatherSummary(r: RegionWithWeather): string {
  const temp = r.weather?.stats.find((s) => s.variable === "temp");
  return temp ? `${Math.round(temp.mean)}°C` : "—";
}

export default function RegionsTable({
  regions,
  totalCount,
  selectedId,
  onSelect,
}: {
  regions: RegionWithWeather[];
  totalCount: number;
  selectedId: string | null;
  onSelect: (region: RegionWithWeather) => void;
}) {
  return (
    <div style={{ overflowX: "auto", border: "1px solid #1b2030", borderRadius: 8, marginTop: 14 }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr style={{ textAlign: "left", color: muted }}>
            <th style={th}>Region</th>
            <th style={th}>Group</th>
            <th style={th}>Enrichment</th>
            <th style={thNum}>Weather</th>
          </tr>
        </thead>
        <tbody>
          {regions.map((r) => {
            const status = regionEnrichmentStatus(r);
            const isSel = selectedId === r.id;
            return (
              <tr key={r.id} style={{ borderTop: "1px solid #1b2030", background: isSel ? "#13192a" : undefined }}>
                <td style={td}>
                  <Link
                    href={`/regions/${encodeURIComponent(r.regionId)}`}
                    style={{ color: "#dbeafe", fontWeight: 600, textDecoration: "none" }}
                  >
                    {r.name}
                  </Link>
                  <button
                    type="button"
                    onClick={() => onSelect(r)}
                    aria-label={`Preview ${r.name}`}
                    style={{ display: "block", border: 0, padding: 0, marginTop: 2, background: "none", color: muted, cursor: "pointer", fontSize: 10 }}
                  >
                    preview on globe
                  </button>
                </td>
                <td style={{ ...td, color: muted }}>{r.group}</td>
                <td style={{ ...td, color: status.color, whiteSpace: "nowrap" }}>● {status.label}</td>
                <td style={{ ...td, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{weatherSummary(r)}</td>
              </tr>
            );
          })}
          {regions.length === 0 && (
            <tr>
              <td style={{ ...td, padding: 18, color: muted }} colSpan={4}>
                {totalCount === 0 ? "No regions seeded yet — hit Reseed catalog." : "No regions match this search."}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
