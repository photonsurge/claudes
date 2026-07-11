"use client";

/**
 * /countries — the full ~240-country catalog as a first-class browser (like
 * /cities): a filterable table on the left, a live boundary-glow globe on the
 * right, and reseed/enrich/weather-refresh triggers. Each row links through to
 * a dedicated /countries/[id] detail page.
 */
import { useMemo, useRef, useState } from "react";
import { DEFAULT_CONTROL_STATE } from "@photonsurge/shared/control";
import { useCountries, setCountryRoundup, type CountryWithWeather } from "../../lib/countries";
import AdminPageShell from "../../components/admin/AdminPageShell";
import CountriesTable from "../../components/countries/CountriesTable";
import CountryEnrichmentCard from "../../components/countries/CountryEnrichmentCard";
import GlobeView, { type GlobeHandle } from "../../components/GlobeView";
import { primary, select } from "../../components/tracks/styles";

async function runJob(id: string): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch("/api/admin/jobs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id }),
  });
  const body = await res.json().catch(() => ({}));
  return { ok: !!body.ok, error: body.error };
}

const ghost: React.CSSProperties = { padding: "7px 10px", borderRadius: 5, border: "1px solid #333", background: "#1a1f2b", color: "#fff", cursor: "pointer", fontSize: 13 };

export default function CountriesPage() {
  const countries = useCountries(true);
  const [continent, setContinent] = useState("");
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  // Optimistic overrides for the round-up opt-in — the countries hook polls on a
  // 120s interval, so reflect a toggle immediately instead of waiting it out.
  const [roundupOverrides, setRoundupOverrides] = useState<Record<string, boolean>>({});
  const globe = useRef<GlobeHandle | null>(null);

  const continents = useMemo(
    () => [...new Set(countries.map((c) => c.continent).filter(Boolean))].sort() as string[],
    [countries],
  );

  const rows = useMemo(
    () =>
      countries
        .filter((c) => (continent ? c.continent === continent : true))
        .filter((c) => (q ? c.name.toLowerCase().includes(q) : true))
        .map((c) =>
          c.countryId in roundupOverrides ? { ...c, roundupEnabled: roundupOverrides[c.countryId] } : c,
        )
        .sort((a, b) => a.name.localeCompare(b.name)),
    [countries, continent, q, roundupOverrides],
  );

  const roundupCount = useMemo(
    () => countries.filter((c) => (c.countryId in roundupOverrides ? roundupOverrides[c.countryId] : c.roundupEnabled)).length,
    [countries, roundupOverrides],
  );

  const toggleRoundup = async (country: CountryWithWeather, enabled: boolean) => {
    setRoundupOverrides((m) => ({ ...m, [country.countryId]: enabled }));
    const ok = await setCountryRoundup(country.countryId, enabled);
    if (!ok) {
      // Revert the optimistic flip on failure.
      setRoundupOverrides((m) => ({ ...m, [country.countryId]: !enabled }));
      setNote(`Round-up toggle failed for ${country.name}.`);
    }
  };

  const selected = selectedId ? countries.find((c) => c.id === selectedId) ?? null : null;
  const enrichedCount = countries.filter((c) => c.wikiTitle || c.wikiThumb || c.wikiExtract).length;

  const onSelect = (country: CountryWithWeather) => {
    setSelectedId(country.id);
    globe.current?.fitBounds(country.bbox);
  };

  const trigger = async (id: string, label: string) => {
    setBusy(id);
    setNote(null);
    const res = await runJob(id);
    setNote(res.ok ? `${label} queued.` : `${label} failed: ${res.error}`);
    setBusy(null);
  };

  const previewState = useMemo(
    () => ({ ...DEFAULT_CONTROL_STATE, activeVariable: null, showWind: false, showCities: false }),
    [],
  );

  return (
    <AdminPageShell
      title="Countries"
      description={
        <>
          Showing {rows.length} of {countries.length} countries · {enrichedCount} enriched · {roundupCount} round-up enabled
        </>
      }
      maxWidth={1600}
      crumbs={[{ label: "Countries" }]}
      actions={
        <>
          <button type="button" onClick={() => trigger("countries-seed", "Reseed")} style={primary} disabled={busy === "countries-seed"}>
            {busy === "countries-seed" ? "…" : "Reseed catalog"}
          </button>
          <button type="button" onClick={() => trigger("countries-enrich", "Enrich")} style={primary} disabled={busy === "countries-enrich"}>
            {busy === "countries-enrich" ? "…" : "Enrich all (Wikipedia)"}
          </button>
          <button type="button" onClick={() => trigger("area-weather-run", "Weather refresh")} style={primary} disabled={busy === "area-weather-run"}>
            {busy === "area-weather-run" ? "…" : "Refresh weather now"}
          </button>
        </>
      }
    >
      {note && <div role="status" style={{ color: note.includes("failed") ? "#fca5a5" : "#a7f3d0", fontSize: 12, marginBottom: 7 }}>{note}</div>}

      <div
        style={{
          display: "flex",
          minHeight: "calc(100vh - 190px)",
          border: "1px solid #1b2030",
          borderRadius: 8,
          overflow: "hidden",
          background: "#070a11",
        }}
      >
        <section style={{ width: 720, padding: 20, overflowY: "auto", borderRight: "1px solid #1b2030", background: "#0a0e16" }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <form
              onSubmit={(e) => { e.preventDefault(); setQ(search.trim().toLowerCase()); }}
              style={{ display: "flex", gap: 8, alignItems: "center", flex: 1, minWidth: 220 }}
            >
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search country name"
                aria-label="Search countries"
                style={{ flex: 1, minWidth: 0, background: "#1a1f2b", color: "#fff", border: "1px solid #333", borderRadius: 5, padding: "7px 9px" }}
              />
              <button type="submit" style={ghost}>Search</button>
            </form>
            <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13, color: "#8b95a7" }}>
              Continent
              <select value={continent} onChange={(e) => setContinent(e.target.value)} style={select}>
                <option value="">All</option>
                {continents.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </label>
          </div>

          {selected && <CountryEnrichmentCard country={selected} onClose={() => setSelectedId(null)} />}

          <CountriesTable countries={rows} totalCount={countries.length} selectedId={selectedId} onSelect={onSelect} onToggleRoundup={toggleRoundup} />
        </section>

        <div style={{ position: "relative", flex: 1, minWidth: 360 }}>
          <GlobeView ref={globe} state={previewState} manifest={null} cities={[]} glowCountryIso={selected?.iso2 ?? null} interactive />
        </div>
      </div>
    </AdminPageShell>
  );
}
