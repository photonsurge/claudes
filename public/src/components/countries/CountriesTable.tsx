"use client";

/**
 * Admin country list: filter by continent / name, click a row to preview its
 * Wikipedia photo/blurb + population/capital/currency and latest area-weather
 * snapshot, trigger a manual reseed/enrich/weather-refresh run. Mirrors
 * VolcanoesTable.tsx (public/src/components/volcanoes/VolcanoesTable.tsx).
 */
import { useMemo, useState } from "react";
import { useCountries, flagEmoji, type CountryWithWeather } from "../../lib/countries";
import { primary, select, th, thNum, td, toolbar, asOf } from "../tracks/styles";

async function runJob(id: string): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch("/api/admin/jobs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id }),
  });
  const body = await res.json().catch(() => ({}));
  return { ok: !!body.ok, error: body.error };
}

function wikiStatus(c: CountryWithWeather): { label: string; color: string } {
  if (c.wikiTitle || c.wikiThumb || c.wikiExtract) return { label: "Enriched", color: "#34d399" };
  if (c.wikiFetchedAt) return { label: "Checked — no match", color: "#fbbf24" };
  return { label: "Not enriched", color: "#8b95a7" };
}

function weatherSummary(c: CountryWithWeather): string {
  const temp = c.weather?.stats.find((s) => s.variable === "temp");
  if (!temp) return "—";
  return `${Math.round(temp.mean)}°C`;
}

function formatDate(v?: string | Date): string {
  return v ? new Date(v).toLocaleString() : "—";
}

export default function CountriesTable() {
  const countries = useCountries(true);
  const [continent, setContinent] = useState("");
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<CountryWithWeather | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const continents = useMemo(
    () => [...new Set(countries.map((c) => c.continent).filter(Boolean))].sort() as string[],
    [countries],
  );

  const rows = useMemo(
    () =>
      countries
        .filter((c) => (continent ? c.continent === continent : true))
        .filter((c) => (q.trim() ? c.name.toLowerCase().includes(q.trim().toLowerCase()) : true))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [countries, continent, q],
  );

  const trigger = async (id: string, label: string) => {
    setBusy(id);
    setNote(null);
    const res = await runJob(id);
    setNote(res.ok ? `${label} queued.` : `${label} failed: ${res.error}`);
    setBusy(null);
  };

  return (
    <div>
      <div style={{ ...toolbar, justifyContent: "space-between", marginBottom: 12 }}>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <button type="button" onClick={() => trigger("countries-seed", "Reseed")} style={primary} disabled={busy === "countries-seed"}>
            {busy === "countries-seed" ? "…" : "Reseed catalog"}
          </button>
          <button type="button" onClick={() => trigger("countries-enrich", "Enrich")} style={primary} disabled={busy === "countries-enrich"}>
            {busy === "countries-enrich" ? "…" : "Enrich all (Wikipedia)"}
          </button>
          <button type="button" onClick={() => trigger("area-weather-run", "Weather refresh")} style={primary} disabled={busy === "area-weather-run"}>
            {busy === "area-weather-run" ? "…" : "Refresh weather now"}
          </button>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search name"
            style={{ ...select, minWidth: 180 }}
          />
          <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13 }}>
            Continent
            <select value={continent} onChange={(e) => setContinent(e.target.value)} style={select}>
              <option value="">All</option>
              {continents.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {note && <div style={asOf}>{note}</div>}
      <div style={asOf}>
        {rows.length} of {countries.length} countries
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: selected ? "minmax(0, 1.4fr) minmax(280px, 1fr)" : "1fr",
          gap: 16,
          marginTop: 8,
        }}
      >
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: "left", color: "#8b95a7" }}>
                <th style={th}>Country</th>
                <th style={th}>Continent</th>
                <th style={th}>Subregion</th>
                <th style={th}>Wiki</th>
                <th style={thNum}>Weather</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => {
                const wiki = wikiStatus(c);
                const isSel = selected?.id === c.id;
                return (
                  <tr
                    key={c.id}
                    onClick={() => setSelected(c)}
                    style={{ borderTop: "1px solid #1b2030", cursor: "pointer", background: isSel ? "#13192a" : undefined }}
                  >
                    <td style={td}>
                      {flagEmoji(c.iso2)} {c.name}
                    </td>
                    <td style={{ ...td, color: "#8b95a7" }}>{c.continent ?? "—"}</td>
                    <td style={{ ...td, color: "#8b95a7" }}>{c.subregion ?? "—"}</td>
                    <td style={{ ...td, color: wiki.color }}>{wiki.label}</td>
                    <td style={{ ...td, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{weatherSummary(c)}</td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr>
                  <td style={td} colSpan={5}>
                    {countries.length === 0 ? "No countries seeded yet — hit Reseed catalog." : "No matches."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {selected && (
          <div style={{ border: "1px solid #1b2030", borderRadius: 8, background: "#0c111c", padding: 12, height: "fit-content" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <strong style={{ fontSize: 14 }}>
                {flagEmoji(selected.iso2)} {selected.name}
              </strong>
              <button
                type="button"
                onClick={() => setSelected(null)}
                style={{ background: "none", border: "none", color: "#8b95a7", cursor: "pointer", fontSize: 16 }}
              >
                ×
              </button>
            </div>
            {(selected.wikiPhoto || selected.wikiThumb) && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={selected.wikiPhoto || selected.wikiThumb}
                alt=""
                style={{ width: "100%", height: 140, objectFit: "cover", borderRadius: 6, background: "#080b11" }}
              />
            )}
            <div style={{ ...asOf, marginTop: 8 }}>
              {[selected.continent, selected.subregion].filter(Boolean).join(" · ") || "—"}
            </div>
            {(selected.population || selected.capital || selected.currency) && (
              <div style={asOf}>
                {[
                  selected.capital ? `Capital: ${selected.capital}` : undefined,
                  selected.population ? `Pop. ${selected.population.toLocaleString()}` : undefined,
                  selected.currency,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </div>
            )}
            {selected.weather && (
              <div style={{ marginTop: 10, border: "1px solid #1b2030", borderRadius: 6, padding: 8 }}>
                <div style={{ ...asOf, textTransform: "uppercase", letterSpacing: 0.6, fontSize: 10, marginTop: 0 }}>
                  Latest area-weather ({formatDate(selected.weather.generatedAt)})
                </div>
                {selected.weather.stats.map((s) => (
                  <div key={s.variable} style={asOf}>
                    {s.variable}: {s.mean.toFixed(1)}
                    {s.units} (min {s.min.toFixed(1)}, max {s.max.toFixed(1)}, n={s.count})
                  </div>
                ))}
                {selected.weather.hazards.map((h) => (
                  <div key={h.hazard} style={{ ...asOf, color: "#f97316" }}>
                    ⚠ {h.label}
                  </div>
                ))}
              </div>
            )}
            {selected.wikiExtract && (
              <div style={{ marginTop: 10 }}>
                <div style={{ ...asOf, textTransform: "uppercase", letterSpacing: 0.6, fontSize: 10 }}>About</div>
                <p style={{ color: "#cbd5e1", fontSize: 12, lineHeight: 1.45, margin: "4px 0 0" }}>{selected.wikiExtract}</p>
              </div>
            )}
            {selected.wikiTitle && (
              <a
                href={`https://en.wikipedia.org/wiki/${encodeURIComponent(selected.wikiTitle.replace(/ /g, "_"))}`}
                target="_blank"
                rel="noreferrer"
                style={{ color: "#60a5fa", fontSize: 12, display: "inline-block", marginTop: 8 }}
              >
                Open Wikipedia ↗
              </a>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
