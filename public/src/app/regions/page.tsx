"use client";

/**
 * /regions — the named-areas catalog (oceans/continents/EU blocs/UK nations)
 * as a first-class browser (like /countries): a filterable table on the left,
 * a live bbox-glow globe on the right, and reseed/enrich/weather-refresh
 * triggers. Each row links through to a dedicated /regions/[id] detail page.
 */
import { useMemo, useRef, useState } from "react";
import { DEFAULT_CONTROL_STATE } from "@photonsurge/shared/control";
import { useRegions, type RegionWithWeather } from "../../lib/regions";
import AdminPageShell from "../../components/admin/AdminPageShell";
import RegionsTable from "../../components/regions/RegionsTable";
import RegionEnrichmentCard from "../../components/regions/RegionEnrichmentCard";
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

export default function RegionsPage() {
  const regions = useRegions(true);
  const [group, setGroup] = useState("");
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const globe = useRef<GlobeHandle | null>(null);

  const groups = useMemo(() => [...new Set(regions.map((r) => r.group))].sort(), [regions]);

  const rows = useMemo(
    () =>
      regions
        .filter((r) => (group ? r.group === group : true))
        .filter((r) => (q ? r.name.toLowerCase().includes(q) : true))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [regions, group, q],
  );

  const selected = selectedId ? regions.find((r) => r.id === selectedId) ?? null : null;
  const enrichedCount = regions.filter((r) => r.wikiTitle || r.wikiThumb || r.wikiExtract).length;

  const onSelect = (region: RegionWithWeather) => {
    setSelectedId(region.id);
    globe.current?.fitBounds(region.bbox);
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
      title="Regions"
      description={
        <>
          Showing {rows.length} of {regions.length} regions · {enrichedCount} enriched
        </>
      }
      maxWidth={1600}
      crumbs={[{ label: "Regions" }]}
      actions={
        <>
          <button type="button" onClick={() => trigger("regions-seed", "Reseed")} style={primary} disabled={busy === "regions-seed"}>
            {busy === "regions-seed" ? "…" : "Reseed catalog"}
          </button>
          <button type="button" onClick={() => trigger("regions-enrich", "Enrich")} style={primary} disabled={busy === "regions-enrich"}>
            {busy === "regions-enrich" ? "…" : "Enrich all (Wikipedia)"}
          </button>
          <button type="button" onClick={() => trigger("regions-places", "Places")} style={primary} disabled={busy === "regions-places"}>
            {busy === "regions-places" ? "…" : "Rebuild places"}
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
                placeholder="Search region name"
                aria-label="Search regions"
                style={{ flex: 1, minWidth: 0, background: "#1a1f2b", color: "#fff", border: "1px solid #333", borderRadius: 5, padding: "7px 9px" }}
              />
              <button type="submit" style={ghost}>Search</button>
            </form>
            <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13, color: "#8b95a7" }}>
              Group
              <select value={group} onChange={(e) => setGroup(e.target.value)} style={select}>
                <option value="">All</option>
                {groups.map((g) => (
                  <option key={g} value={g}>{g}</option>
                ))}
              </select>
            </label>
          </div>

          {selected && <RegionEnrichmentCard region={selected} onClose={() => setSelectedId(null)} />}

          <RegionsTable regions={rows} totalCount={regions.length} selectedId={selectedId} onSelect={onSelect} />
        </section>

        <div style={{ position: "relative", flex: 1, minWidth: 360 }}>
          <GlobeView ref={globe} state={previewState} manifest={null} cities={[]} glowRegionBbox={selected?.bbox ?? null} interactive />
        </div>
      </div>
    </AdminPageShell>
  );
}
