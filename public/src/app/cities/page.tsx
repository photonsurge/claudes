"use client";

/**
 * /cities — CRUD table of city markers + add-via-geocode + small map preview.
 *
 * After any successful mutation we emit CITIES_UPDATED over the socket so /watch
 * (and /control) refetch their city list. Next is not a socket emitter, so the
 * page itself broadcasts the change over its own socket connection.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { CITIES_UPDATED, DEFAULT_CONTROL_STATE } from "@photonsurge/shared/control";
import { useSocket } from "../../lib/socket-provider";
import {
  listCities,
  createCity,
  updateCity,
  deleteCity,
  type City,
  type ValidatedCity,
} from "../../lib/cities";
import CityEditor from "../../components/CityEditor";
import GlobeView, { type GlobeHandle } from "../../components/GlobeView";

export default function CitiesPage() {
  const { socket } = useSocket();
  const [cities, setCities] = useState<City[]>([]);
  const [editing, setEditing] = useState<City | null>(null);
  const [adding, setAdding] = useState(false);
  const globe = useRef<GlobeHandle | null>(null);

  const reload = async () => setCities(await listCities());
  useEffect(() => {
    reload();
  }, []);

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
      await reload();
      notify();
    }
  };

  const previewState = useMemo(
    () => ({ ...DEFAULT_CONTROL_STATE, activeVariable: null, showWind: false, showCities: true }),
    [],
  );

  return (
    <main style={{ display: "flex", height: "100vh", background: "#0a0e16", color: "#fff", fontFamily: "system-ui, sans-serif" }}>
      <section style={{ width: 520, padding: 20, overflowY: "auto", borderRight: "1px solid #1b2030" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2 style={{ margin: 0 }}>Cities</h2>
          <button type="button" onClick={() => { setAdding(true); setEditing(null); }} style={primary}>
            + Add city
          </button>
        </div>

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

        <table style={{ width: "100%", marginTop: 16, borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ textAlign: "left", color: "#8b95a7" }}>
              <th style={th}>Name</th>
              <th style={th}>Country</th>
              <th style={th}>Lat</th>
              <th style={th}>Lng</th>
              <th style={th}>Pop</th>
              <th style={th}></th>
            </tr>
          </thead>
          <tbody>
            {cities.map((c) => (
              <tr key={c.id} style={{ borderTop: "1px solid #1b2030" }}>
                <td style={td}>
                  {c.isCapital ? "★ " : ""}
                  {c.name}
                </td>
                <td style={td}>{c.country ?? ""}</td>
                <td style={td}>{c.lat.toFixed(2)}</td>
                <td style={td}>{c.lng.toFixed(2)}</td>
                <td style={td}>{c.population?.toLocaleString() ?? ""}</td>
                <td style={td}>
                  <button type="button" onClick={() => { setEditing(c); setAdding(false); }} style={ghost}>
                    Edit
                  </button>{" "}
                  <button type="button" onClick={() => handleDelete(c.id)} style={danger}>
                    Delete
                  </button>
                </td>
              </tr>
            ))}
            {cities.length === 0 && (
              <tr>
                <td style={td} colSpan={6}>
                  No cities yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
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
const danger: React.CSSProperties = { ...ghost, borderColor: "#7f1d1d", color: "#fca5a5" };
const card: React.CSSProperties = {
  marginTop: 16,
  padding: 16,
  borderRadius: 8,
  border: "1px solid #1b2030",
  background: "#0c111c",
};
const th: React.CSSProperties = { padding: "6px 8px", fontWeight: 600 };
const td: React.CSSProperties = { padding: "6px 8px" };
