"use client";

/**
 * /cities — CRUD table of city markers + add-via-geocode + small map preview.
 *
 * After any successful mutation we emit CITIES_UPDATED over the socket so /watch
 * (and /control) refetch their city list. Next is not a socket emitter, so the
 * page itself broadcasts the change over its own socket connection.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PaginationState, SortingState } from "@tanstack/react-table";
import { CITIES_UPDATED, DEFAULT_CONTROL_STATE } from "@photonsurge/shared/control";
import { useSocket } from "../../lib/socket-provider";
import {
  listCitiesPage,
  createCity,
  updateCity,
  deleteCity,
  queueCitiesEnrichment,
  type CityEnrichmentScope,
  type CitySortField,
  type City,
  type ValidatedCity,
} from "../../lib/cities";
import CityEditor from "../../components/CityEditor";
import CityEnrichmentCard from "../../components/cities/CityEnrichmentCard";
import CitiesTable from "../../components/cities/CitiesTable";
import GlobeView, { type GlobeHandle } from "../../components/GlobeView";

export default function CitiesPage() {
  const { socket } = useSocket();
  const [cities, setCities] = useState<City[]>([]);
  const [editing, setEditing] = useState<City | null>(null);
  const [adding, setAdding] = useState(false);
  const [selected, setSelected] = useState<City | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  const [pageCount, setPageCount] = useState(0);
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 25 });
  const [sorting, setSorting] = useState<SortingState>([{ id: "population", desc: true }]);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [enriching, setEnriching] = useState<CityEnrichmentScope | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const globe = useRef<GlobeHandle | null>(null);
  const requestId = useRef(0);

  const reload = useCallback(async () => {
    const activeRequest = ++requestId.current;
    setLoading(true);
    setLoadError(null);
    const sort = sorting[0] ?? { id: "population", desc: true };
    const result = await listCitiesPage({
      pageIndex: pagination.pageIndex,
      pageSize: pagination.pageSize,
      sortBy: sort.id as CitySortField,
      sortDirection: sort.desc ? "desc" : "asc",
      q: query || undefined,
    });
    if (activeRequest !== requestId.current) return;
    setCities(result.cities);
    setTotal(result.total);
    setPageCount(result.pageCount);
    setLoadError(result.error ?? null);
    setSelected((current) => current ? result.cities.find((city) => city.id === current.id) ?? current : null);
    setLoading(false);
  }, [pagination.pageIndex, pagination.pageSize, query, sorting]);

  useEffect(() => {
    reload();
  }, [reload]);

  // The worker emits this after enrichment, so an open result refreshes itself.
  useEffect(() => {
    if (!socket) return;
    const onUpdated = () => reload();
    socket.on(CITIES_UPDATED, onUpdated);
    return () => { socket.off(CITIES_UPDATED, onUpdated); };
  }, [reload, socket]);

  const notify = () => socket?.emit(CITIES_UPDATED, { reason: "cities-page" });

  const handleCreate = async (value: ValidatedCity) => {
    const created = await createCity(value);
    if (created) {
      setAdding(false);
      await reload();
      notify();
      globe.current?.flyTo([value.lng, value.lat], 4);
    }
  };

  const handleUpdate = async (id: string, value: ValidatedCity) => {
    const updated = await updateCity(id, value);
    if (updated) {
      setEditing(null);
      await reload();
      notify();
    }
  };

  const handleDelete = async (id: string) => {
    if (await deleteCity(id)) {
      setSelected((current) => current?.id === id ? null : current);
      await reload();
      notify();
    }
  };

  const handleEnrich = async (scope: CityEnrichmentScope) => {
    setEnriching(scope);
    setNotice(null);
    const result = await queueCitiesEnrichment(scope);
    const label = scope === "all" ? "All-city enrichment" : "Prominent-city enrichment";
    const refreshNote = scope === "all" ? "Results refresh after each batch." : "Results refresh when the job finishes.";
    setNotice(result.ok
      ? `${result.alreadyQueued ? `${label} is already running` : `${label} queued`}${result.jobId ? ` (#${result.jobId})` : ""}. ${refreshNote}`
      : `Could not queue enrichment: ${result.error ?? "unknown error"}`);
    setEnriching(null);
  };

  const enrichedCount = cities.filter((city) => city.wikiTitle || city.wikiThumb || city.wikiExtract).length;
  const checkedCount = cities.filter((city) => city.wikiFetchedAt).length;
  const resetToFirstPage = () => setPagination((current) => ({ ...current, pageIndex: 0 }));

  const previewState = useMemo(
    () => ({ ...DEFAULT_CONTROL_STATE, activeVariable: null, showWind: false, showCities: true }),
    [],
  );

  return (
    <main style={{ display: "flex", height: "100vh", background: "#0a0e16", color: "#fff", fontFamily: "system-ui, sans-serif" }}>
      <section style={{ width: 680, padding: 20, overflowY: "auto", borderRight: "1px solid #1b2030" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <h2 style={{ margin: 0 }}>Cities</h2>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="button" onClick={reload} disabled={loading} style={ghost}>{loading ? "…" : "Refresh"}</button>
            <button type="button" onClick={() => handleEnrich("prominent")} disabled={enriching !== null} style={{ ...primary, background: "#0f766e" }}>
              {enriching === "prominent" ? "Queueing…" : "Enrich prominent"}
            </button>
            <button type="button" onClick={() => handleEnrich("all")} disabled={enriching !== null} style={primary}>
              {enriching === "all" ? "Queueing…" : "Enrich all · low priority"}
            </button>
            <button type="button" onClick={() => { setAdding(true); setEditing(null); }} style={primary}>+ Add city</button>
          </div>
        </div>

        <div style={{ color: "#8b95a7", fontSize: 12, marginTop: 8 }}>
          Showing {cities.length} of {total.toLocaleString()} cities · this page: {enrichedCount} enriched · {checkedCount} checked
        </div>
        {notice && <div role="status" style={{ color: notice.startsWith("Could not") ? "#fca5a5" : "#a7f3d0", fontSize: 12, marginTop: 7 }}>{notice}</div>}
        {loadError && <div role="alert" style={{ color: "#fca5a5", fontSize: 12, marginTop: 7 }}>{loadError}</div>}

        <form
          onSubmit={(event) => { event.preventDefault(); setQuery(search.trim()); resetToFirstPage(); }}
          style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 12 }}
        >
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search city, country or region"
            aria-label="Search cities"
            style={{ flex: 1, minWidth: 0, background: "#1a1f2b", color: "#fff", border: "1px solid #333", borderRadius: 5, padding: "7px 9px" }}
          />
          <button type="submit" style={ghost}>Search</button>
        </form>

        {selected && <CityEnrichmentCard city={selected} onClose={() => setSelected(null)} />}

        {adding && (
          <div style={card}>
            <h3 style={{ marginTop: 0, fontSize: 14 }}>New city</h3>
            <CityEditor submitLabel="Create" onSubmit={handleCreate} onCancel={() => setAdding(false)} />
          </div>
        )}

        {editing && (
          <div style={card}>
            <h3 style={{ marginTop: 0, fontSize: 14 }}>Edit {editing.name}</h3>
            <CityEditor
              submitLabel="Save"
              initial={{
                name: editing.name,
                country: editing.country,
                lat: editing.lat,
                lng: editing.lng,
                population: editing.population,
                isCapital: editing.isCapital,
              }}
              onSubmit={(v) => handleUpdate(editing.id, v)}
              onCancel={() => setEditing(null)}
            />
          </div>
        )}

        <CitiesTable
          cities={cities}
          total={total}
          pageCount={pageCount}
          loading={loading}
          pagination={pagination}
          sorting={sorting}
          onPaginationChange={setPagination}
          onSortingChange={(updater) => {
            setSorting((current) => typeof updater === "function" ? updater(current) : updater);
            resetToFirstPage();
          }}
          onSelect={(city) => { setSelected(city); globe.current?.flyTo([city.lng, city.lat], 5); }}
          onEdit={(city) => { setEditing(city); setAdding(false); }}
          onDelete={handleDelete}
        />
      </section>

      <div style={{ position: "relative", flex: 1 }}>
        <GlobeView ref={globe} state={previewState} manifest={null} cities={cities} interactive />
      </div>
    </main>
  );
}

const primary: React.CSSProperties = {
  padding: "8px 14px",
  borderRadius: 6,
  border: "1px solid #333",
  background: "#2563eb",
  color: "#fff",
  cursor: "pointer",
};
const ghost: React.CSSProperties = {
  padding: "3px 8px",
  borderRadius: 5,
  border: "1px solid #333",
  background: "#1a1f2b",
  color: "#fff",
  cursor: "pointer",
  fontSize: 12,
};
const card: React.CSSProperties = {
  marginTop: 16,
  padding: 16,
  borderRadius: 8,
  border: "1px solid #1b2030",
  background: "#0c111c",
};
