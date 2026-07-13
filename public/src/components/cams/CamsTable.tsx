"use client";

/**
 * Admin webcam list: filter by status / text, add cams manually, click a row to
 * preview it, toggle status, or delete. Reads/writes the worker-managed catalog
 * via /api/admin/cams. "Cams in an area" (bbox) comes from the same list call —
 * wired to the globe viewport later; here we expose status + text filters.
 */
import { useCallback, useEffect, useState } from "react";
import { listCams, setCamStatus, deleteCam } from "../../lib/cams/client";
import type { Cam, CamStatus } from "../../lib/cams/types";
import { primary, select, th, thNum, td, tdNum, toolbar, asOf } from "../tracks/styles";
import CamViewer from "./CamViewer";
import AddCamForm from "./AddCamForm";
import { useTableSort } from "../admin/useTableSort";

const STATUS_FILTERS: { id: "" | CamStatus; label: string }[] = [
  { id: "", label: "All" },
  { id: "active", label: "Active" },
  { id: "inactive", label: "Inactive" },
  { id: "unknown", label: "Unknown" },
];

const STATUS_COLOR: Record<CamStatus, string> = {
  active: "#34d399",
  inactive: "#f87171",
  unknown: "#8b95a7",
};

const NEXT_STATUS: Record<CamStatus, CamStatus> = {
  active: "inactive",
  inactive: "active",
  unknown: "active",
};

export default function CamsTable() {
  const [rows, setRows] = useState<Cam[]>([]);
  const [status, setStatus] = useState<"" | CamStatus>("");
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<Cam | null>(null);
  const [loading, setLoading] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setNote(null);
    const res = await listCams({ status: status || undefined, q: q.trim() || undefined });
    setRows(res.cams);
    if (res.error) setNote(res.error);
    setLoading(false);
  }, [status, q]);

  useEffect(() => {
    reload();
  }, [reload]);

  // Keep the open preview in sync with refreshed data (status edits, etc.).
  useEffect(() => {
    if (!selected) return;
    const fresh = rows.find((r) => r.camId === selected.camId);
    if (fresh && fresh !== selected) setSelected(fresh);
  }, [rows, selected]);

  const onToggle = async (cam: Cam) => {
    const res = await setCamStatus(cam.camId, NEXT_STATUS[cam.status]);
    if (res.cam) setRows((prev) => prev.map((r) => (r.camId === cam.camId ? res.cam! : r)));
  };

  const onDelete = async (cam: Cam) => {
    const res = await deleteCam(cam.camId);
    if (res.ok) {
      setRows((prev) => prev.filter((r) => r.camId !== cam.camId));
      setSelected((s) => (s?.camId === cam.camId ? null : s));
    } else {
      setNote(res.error ?? "delete failed");
    }
  };

  const onSaved = (cam: Cam) => {
    setRows((prev) => {
      const i = prev.findIndex((r) => r.camId === cam.camId);
      if (i === -1) return [cam, ...prev];
      const next = [...prev];
      next[i] = cam;
      return next;
    });
    setSelected(cam);
  };
  const sorted = useTableSort(rows, { title: (c) => c.title, place: (c) => c.place ?? c.country, status: (c) => c.status,
    feed: (c) => c.live?.kind ?? (c.timelapseUrl ? "timelapse" : c.imageUrl ? "still" : ""), lat: (c) => c.lat, lng: (c) => c.lng }, "title");

  return (
    <div>
      <div style={{ ...toolbar, justifyContent: "space-between", marginBottom: 12 }}>
        <AddCamForm onSaved={onSaved} />
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search title / place"
            style={{ ...select, minWidth: 180 }}
          />
          <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13 }}>
            Status
            <select value={status} onChange={(e) => setStatus(e.target.value as "" | CamStatus)} style={select}>
              {STATUS_FILTERS.map((s) => (
                <option key={s.id} value={s.id}>{s.label}</option>
              ))}
            </select>
          </label>
          <button type="button" onClick={reload} style={primary} disabled={loading}>
            {loading ? "…" : "Refresh"}
          </button>
        </div>
      </div>

      {note && <div style={{ ...asOf, color: "#fca5a5" }}>{note}</div>}
      <div style={asOf}>{rows.length} cams</div>

      <div style={{ display: "grid", gridTemplateColumns: selected ? "minmax(0, 1.4fr) minmax(280px, 1fr)" : "1fr", gap: 16, marginTop: 8 }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: "left", color: "#8b95a7" }}>
                <th style={th}>{sorted.header("title", "Title")}</th><th style={th}>{sorted.header("place", "Place")}</th>
                <th style={th}>{sorted.header("status", "Status")}</th><th style={th}>{sorted.header("feed", "Feed")}</th>
                <th style={thNum}>{sorted.header("lat", "Lat")}</th><th style={thNum}>{sorted.header("lng", "Lng")}</th>
                <th style={th}></th>
              </tr>
            </thead>
            <tbody>
              {sorted.rows.map((c) => {
                const feed = c.live ? `live·${c.live.kind}` : c.timelapseUrl ? "timelapse" : c.imageUrl ? "still" : "—";
                const isSel = selected?.camId === c.camId;
                return (
                  <tr
                    key={c.camId}
                    onClick={() => setSelected(c)}
                    style={{ borderTop: "1px solid #1b2030", cursor: "pointer", background: isSel ? "#13192a" : undefined }}
                  >
                    <td style={td}>{c.title}</td>
                    <td style={{ ...td, color: "#8b95a7" }}>{c.place ?? c.country ?? "—"}</td>
                    <td style={td}>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); onToggle(c); }}
                        title="Toggle status"
                        style={{ background: "none", border: "none", color: STATUS_COLOR[c.status], cursor: "pointer", fontSize: 13, padding: 0 }}
                      >
                        ● {c.status}
                      </button>
                    </td>
                    <td style={{ ...td, color: "#8b95a7" }}>{feed}</td>
                    <td style={tdNum}>{c.lat.toFixed(3)}</td>
                    <td style={tdNum}>{c.lng.toFixed(3)}</td>
                    <td style={td}>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); onDelete(c); }}
                        style={{ background: "none", border: "none", color: "#f87171", cursor: "pointer", fontSize: 13 }}
                      >
                        delete
                      </button>
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr>
                  <td style={td} colSpan={7}>
                    {loading ? "Loading…" : "No cams yet — add one above."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {selected && (
          <div style={{ border: "1px solid #1b2030", borderRadius: 8, background: "#0c111c", padding: 12, height: "fit-content" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <strong style={{ fontSize: 14 }}>{selected.title}</strong>
              <button type="button" onClick={() => setSelected(null)} style={{ background: "none", border: "none", color: "#8b95a7", cursor: "pointer", fontSize: 16 }}>×</button>
            </div>
            <CamViewer cam={selected} />
            <div style={{ ...asOf, marginTop: 8 }}>
              {selected.place ?? "—"} · {selected.lat.toFixed(3)}, {selected.lng.toFixed(3)} · {selected.provider}
            </div>
            {selected.playerUrl && (
              <a href={selected.playerUrl} target="_blank" rel="noreferrer" style={{ ...asOf, color: "#60a5fa", display: "inline-block", marginTop: 4 }}>
                Open provider player ↗
              </a>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
