"use client";

/**
 * Manual sea-point entry for the admin — the only way this catalog grows
 * (no upstream feed, unlike cams/volcanoes). Posts to /api/admin/sea-points
 * (upsert on pointId, auto-slugged from the name when left blank).
 */
import { useState } from "react";
import { saveSeaPoint } from "../../lib/sea-points/client";
import type { SeaPoint } from "../../lib/sea-points/types";
import { primary } from "../tracks/styles";

const field: React.CSSProperties = {
  background: "#0c111c",
  color: "#fff",
  border: "1px solid #1b2030",
  borderRadius: 5,
  padding: "6px 8px",
  fontSize: 13,
  width: "100%",
};
const label: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "#8b95a7" };
const checkboxLabel: React.CSSProperties = { display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#8b95a7" };

const empty = {
  pointId: "",
  name: "",
  blurb: "",
  lat: "",
  lng: "",
  zoom: "4",
  depthCycle: false,
  enabled: true,
};

export default function AddSeaPointForm({ onSaved }: { onSaved: (p: SeaPoint) => void }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ ...empty });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const set = (k: keyof typeof empty) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setF((prev) => ({ ...prev, [k]: e.target.value }));

  const submit = async () => {
    setBusy(true);
    setErr(null);
    const payload: Record<string, unknown> = {
      pointId: f.pointId.trim() || undefined,
      name: f.name,
      blurb: f.blurb,
      lat: Number(f.lat),
      lng: Number(f.lng),
      zoom: Number(f.zoom),
      depthCycle: f.depthCycle,
      enabled: f.enabled,
    };

    const res = await saveSeaPoint(payload);
    setBusy(false);
    if (res.error || !res.seaPoint) {
      setErr(res.error ?? "save failed");
      return;
    }
    onSaved(res.seaPoint);
    setF({ ...empty });
    setOpen(false);
  };

  if (!open) {
    return (
      <button type="button" style={primary} onClick={() => setOpen(true)}>
        + Add sea point
      </button>
    );
  }

  return (
    <div style={{ border: "1px solid #1b2030", borderRadius: 8, background: "#0c111c", padding: 16, marginBottom: 16 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 10 }}>
        <label style={label}>Name*<input style={field} value={f.name} onChange={set("name")} placeholder="Gulf Stream" /></label>
        <label style={label}>Point id<input style={field} value={f.pointId} onChange={set("pointId")} placeholder="auto from name" /></label>
        <label style={label}>Lat*<input style={field} value={f.lat} onChange={set("lat")} inputMode="decimal" placeholder="36" /></label>
        <label style={label}>Lng*<input style={field} value={f.lng} onChange={set("lng")} inputMode="decimal" placeholder="-70" /></label>
        <label style={label}>Zoom<input style={field} value={f.zoom} onChange={set("zoom")} inputMode="decimal" placeholder="4.5" /></label>
        <label style={{ ...label, gridColumn: "1 / -1" }}>Blurb<input style={field} value={f.blurb} onChange={set("blurb")} placeholder="Warm western-boundary current, N. Atlantic" /></label>
      </div>
      <div style={{ display: "flex", gap: 16, marginTop: 10 }}>
        <label style={checkboxLabel}>
          <input type="checkbox" checked={f.depthCycle} onChange={(e) => setF((prev) => ({ ...prev, depthCycle: e.target.checked }))} />
          Depth cycle (thermocline chapters instead of one fixed depth)
        </label>
        <label style={checkboxLabel}>
          <input type="checkbox" checked={f.enabled} onChange={(e) => setF((prev) => ({ ...prev, enabled: e.target.checked }))} />
          Enabled
        </label>
      </div>
      {err && <div style={{ color: "#fca5a5", fontSize: 13, marginTop: 10 }}>{err}</div>}
      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <button type="button" style={primary} onClick={submit} disabled={busy}>{busy ? "Saving…" : "Save sea point"}</button>
        <button type="button" style={{ ...primary, background: "#1a1f2b" }} onClick={() => { setOpen(false); setErr(null); }}>Cancel</button>
      </div>
    </div>
  );
}
