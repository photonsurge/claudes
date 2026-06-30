"use client";

/**
 * Manual cam entry for the admin. Covers the "attach a live video" path (paste
 * a YouTube/HLS URL) and the catalog path (still/timelapse URLs) until the
 * Windy bulk ingest lands. Posts to /api/admin/cams (upsert on camId).
 */
import { useState } from "react";
import { saveCam } from "../../lib/cams/client";
import type { Cam, CamProvider, CamStatus } from "../../lib/cams/types";
import { select, primary } from "../tracks/styles";

const PROVIDERS: CamProvider[] = ["manual", "youtube", "windy", "other"];
const STATUSES: CamStatus[] = ["active", "inactive", "unknown"];

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

const empty = {
  camId: "",
  title: "",
  lat: "",
  lng: "",
  provider: "manual" as CamProvider,
  status: "active" as CamStatus,
  place: "",
  country: "",
  imageUrl: "",
  timelapseUrl: "",
  playerUrl: "",
  liveUrl: "",
  tags: "",
};

export default function AddCamForm({ onSaved }: { onSaved: (cam: Cam) => void }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ ...empty });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const set = (k: keyof typeof empty) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setF((prev) => ({ ...prev, [k]: e.target.value }));

  const submit = async () => {
    setBusy(true);
    setErr(null);
    const payload: Record<string, unknown> = {
      camId: f.camId.trim() || f.title.trim().toLowerCase().replace(/\s+/g, "-"),
      title: f.title,
      lat: Number(f.lat),
      lng: Number(f.lng),
      provider: f.provider,
      status: f.status,
      place: f.place,
      country: f.country,
      imageUrl: f.imageUrl,
      timelapseUrl: f.timelapseUrl,
      playerUrl: f.playerUrl,
      tags: f.tags ? f.tags.split(",").map((t) => t.trim()).filter(Boolean) : undefined,
    };
    if (f.liveUrl.trim()) payload.live = { url: f.liveUrl.trim() };

    const res = await saveCam(payload);
    setBusy(false);
    if (res.error || !res.cam) {
      setErr(res.error ?? "save failed");
      return;
    }
    onSaved(res.cam);
    setF({ ...empty });
    setOpen(false);
  };

  if (!open) {
    return (
      <button type="button" style={primary} onClick={() => setOpen(true)}>
        + Add cam
      </button>
    );
  }

  return (
    <div style={{ border: "1px solid #1b2030", borderRadius: 8, background: "#0c111c", padding: 16, marginBottom: 16 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 10 }}>
        <label style={label}>Title*<input style={field} value={f.title} onChange={set("title")} placeholder="Dover Harbour" /></label>
        <label style={label}>Cam id<input style={field} value={f.camId} onChange={set("camId")} placeholder="auto from title" /></label>
        <label style={label}>Lat*<input style={field} value={f.lat} onChange={set("lat")} inputMode="decimal" placeholder="51.12" /></label>
        <label style={label}>Lng*<input style={field} value={f.lng} onChange={set("lng")} inputMode="decimal" placeholder="1.31" /></label>
        <label style={label}>Provider
          <select style={{ ...select, ...field }} value={f.provider} onChange={set("provider")}>
            {PROVIDERS.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </label>
        <label style={label}>Status
          <select style={{ ...select, ...field }} value={f.status} onChange={set("status")}>
            {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <label style={label}>Place<input style={field} value={f.place} onChange={set("place")} placeholder="Dover, UK" /></label>
        <label style={label}>Country<input style={field} value={f.country} onChange={set("country")} placeholder="GB" /></label>
        <label style={{ ...label, gridColumn: "1 / -1" }}>Live stream URL (YouTube / .m3u8 / .mp4 / embed)
          <input style={field} value={f.liveUrl} onChange={set("liveUrl")} placeholder="https://youtu.be/…" /></label>
        <label style={{ ...label, gridColumn: "1 / -1" }}>Still image URL<input style={field} value={f.imageUrl} onChange={set("imageUrl")} placeholder="https://…/current.jpg" /></label>
        <label style={{ ...label, gridColumn: "1 / -1" }}>Timelapse URL<input style={field} value={f.timelapseUrl} onChange={set("timelapseUrl")} placeholder="https://…/day.mp4" /></label>
        <label style={{ ...label, gridColumn: "1 / -1" }}>Tags (comma separated)<input style={field} value={f.tags} onChange={set("tags")} placeholder="harbour, coast" /></label>
      </div>
      {err && <div style={{ color: "#fca5a5", fontSize: 13, marginTop: 10 }}>{err}</div>}
      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <button type="button" style={primary} onClick={submit} disabled={busy}>{busy ? "Saving…" : "Save cam"}</button>
        <button type="button" style={{ ...primary, background: "#1a1f2b" }} onClick={() => { setOpen(false); setErr(null); }}>Cancel</button>
      </div>
    </div>
  );
}
