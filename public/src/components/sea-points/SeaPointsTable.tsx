"use client";

/**
 * Admin sea-point list: the ocean-monitoring-point catalog the `ocean`
 * Director kind draws candidates from (worker/src/director/candidates.ts) —
 * search, add manually, toggle enabled, or delete. No favourites list here:
 * `enabled` alone gates whether the worker offers a point at all.
 */
import { useCallback, useEffect, useState } from "react";
import { listSeaPoints, setSeaPointEnabled, deleteSeaPoint } from "../../lib/sea-points/client";
import type { SeaPoint } from "../../lib/sea-points/types";
import { primary, select, th, thNum, td, tdNum, toolbar, asOf } from "../tracks/styles";
import AddSeaPointForm from "./AddSeaPointForm";

export default function SeaPointsTable() {
  const [rows, setRows] = useState<SeaPoint[]>([]);
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<SeaPoint | null>(null);
  const [loading, setLoading] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setNote(null);
    const res = await listSeaPoints();
    setRows(res.seaPoints);
    if (res.error) setNote(res.error);
    setLoading(false);
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  useEffect(() => {
    if (!selected) return;
    const fresh = rows.find((r) => r.pointId === selected.pointId);
    if (fresh && fresh !== selected) setSelected(fresh);
  }, [rows, selected]);

  const filtered = rows.filter((r) => (q.trim() ? r.name.toLowerCase().includes(q.trim().toLowerCase()) : true));

  const onToggle = async (p: SeaPoint) => {
    const res = await setSeaPointEnabled(p.pointId, !p.enabled);
    if (res.seaPoint) setRows((prev) => prev.map((r) => (r.pointId === p.pointId ? res.seaPoint! : r)));
  };

  const onDelete = async (p: SeaPoint) => {
    const res = await deleteSeaPoint(p.pointId);
    if (res.ok) {
      setRows((prev) => prev.filter((r) => r.pointId !== p.pointId));
      setSelected((s) => (s?.pointId === p.pointId ? null : s));
    } else {
      setNote(res.error ?? "delete failed");
    }
  };

  const onSaved = (p: SeaPoint) => {
    setRows((prev) => {
      const i = prev.findIndex((r) => r.pointId === p.pointId);
      if (i === -1) return [p, ...prev];
      const next = [...prev];
      next[i] = p;
      return next;
    });
    setSelected(p);
  };

  return (
    <div>
      <div style={{ ...toolbar, justifyContent: "space-between", marginBottom: 12 }}>
        <AddSeaPointForm onSaved={onSaved} />
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search name"
            style={{ ...select, minWidth: 180 }}
          />
          <button type="button" onClick={reload} style={primary} disabled={loading}>
            {loading ? "…" : "Refresh"}
          </button>
        </div>
      </div>

      {note && <div style={{ ...asOf, color: "#fca5a5" }}>{note}</div>}
      <div style={asOf}>{filtered.length} of {rows.length} sea points</div>

      <div style={{ display: "grid", gridTemplateColumns: selected ? "minmax(0, 1.4fr) minmax(280px, 1fr)" : "1fr", gap: 16, marginTop: 8 }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: "left", color: "#8b95a7" }}>
                <th style={th}>Name</th>
                <th style={th}>Point id</th>
                <th style={th}>Depth cycle</th>
                <th style={th}>Enabled</th>
                <th style={thNum}>Lat</th>
                <th style={thNum}>Lng</th>
                <th style={th}></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => {
                const isSel = selected?.pointId === p.pointId;
                return (
                  <tr
                    key={p.pointId}
                    onClick={() => setSelected(p)}
                    style={{ borderTop: "1px solid #1b2030", cursor: "pointer", background: isSel ? "#13192a" : undefined }}
                  >
                    <td style={td}>{p.name}</td>
                    <td style={{ ...td, color: "#8b95a7" }}>{p.pointId}</td>
                    <td style={{ ...td, color: "#8b95a7" }}>{p.depthCycle ? "yes" : "—"}</td>
                    <td style={td}>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); onToggle(p); }}
                        title="Toggle enabled"
                        style={{ background: "none", border: "none", color: p.enabled ? "#34d399" : "#f87171", cursor: "pointer", fontSize: 13, padding: 0 }}
                      >
                        ● {p.enabled ? "enabled" : "disabled"}
                      </button>
                    </td>
                    <td style={tdNum}>{p.lat.toFixed(3)}</td>
                    <td style={tdNum}>{p.lng.toFixed(3)}</td>
                    <td style={td}>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); onDelete(p); }}
                        style={{ background: "none", border: "none", color: "#f87171", cursor: "pointer", fontSize: 13 }}
                      >
                        delete
                      </button>
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr>
                  <td style={td} colSpan={7}>
                    {loading ? "Loading…" : rows.length === 0 ? "No sea points yet — add one above." : "No matches."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {selected && (
          <div style={{ border: "1px solid #1b2030", borderRadius: 8, background: "#0c111c", padding: 12, height: "fit-content" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <strong style={{ fontSize: 14 }}>{selected.name}</strong>
              <button type="button" onClick={() => setSelected(null)} style={{ background: "none", border: "none", color: "#8b95a7", cursor: "pointer", fontSize: 16 }}>×</button>
            </div>
            <div style={asOf}>{selected.blurb || "—"}</div>
            <div style={{ ...asOf, marginTop: 8 }}>
              {selected.lat.toFixed(3)}, {selected.lng.toFixed(3)} · zoom {selected.zoom}
              {selected.depthCycle ? " · depth cycle" : ""}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
