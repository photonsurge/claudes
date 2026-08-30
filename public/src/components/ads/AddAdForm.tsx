"use client";

/**
 * Create an ad from the admin: pick an image (or short video) file and fill in
 * metadata. Posts multipart to /api/admin/ads. A local object-URL preview shows
 * the chosen file before upload.
 */
import { useRef, useState } from "react";
import { createAd } from "../../lib/ads/client";
import { AD_PLACEMENTS, AD_PLACEMENT_LABELS } from "../../lib/ads/types";
import type { Ad, AdPlacement, AdStatus } from "../../lib/ads/types";
import { primary, select } from "../tracks/styles";

const STATUSES: AdStatus[] = ["active", "inactive"];
const ACCEPT = "image/png,image/jpeg,image/webp,image/gif,video/mp4,video/webm";

const field: React.CSSProperties = {
  background: "#0c111c",
  color: "#fff",
  border: "1px solid #1b2030",
  borderRadius: 5,
  padding: "6px 8px",
  fontSize: 13,
  width: "100%",
};
const label: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 4,
  fontSize: 12,
  color: "#8b95a7",
};

const empty = {
  title: "",
  advertiser: "",
  clickUrl: "",
  weight: "1",
  status: "active" as AdStatus,
  tags: "",
  notes: "",
};

export default function AddAdForm({ onSaved }: { onSaved: (ad: Ad) => void }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ ...empty });
  const [placements, setPlacements] = useState<AdPlacement[]>(["break"]);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const set =
    (k: keyof typeof empty) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setF((prev) => ({ ...prev, [k]: e.target.value }));

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const chosen = e.target.files?.[0] ?? null;
    setFile(chosen);
    if (preview) URL.revokeObjectURL(preview);
    setPreview(chosen ? URL.createObjectURL(chosen) : null);
  };

  const togglePlacement = (p: AdPlacement) =>
    setPlacements((prev) => (prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]));

  const reset = () => {
    setF({ ...empty });
    setPlacements(["break"]);
    setFile(null);
    if (preview) URL.revokeObjectURL(preview);
    setPreview(null);
    if (fileRef.current) fileRef.current.value = "";
  };

  const submit = async () => {
    if (!f.title.trim()) {
      setErr("a title is required");
      return;
    }
    if (!file) {
      setErr("choose an image or video file");
      return;
    }
    if (placements.length === 0) {
      setErr("pick at least one placement (ad break / ticker mention)");
      return;
    }
    setBusy(true);
    setErr(null);

    const form = new FormData();
    form.set("title", f.title.trim());
    if (f.advertiser.trim()) form.set("advertiser", f.advertiser.trim());
    if (f.clickUrl.trim()) form.set("clickUrl", f.clickUrl.trim());
    form.set("weight", f.weight || "1");
    form.set("status", f.status);
    form.set("placements", placements.join(","));
    if (f.tags.trim()) form.set("tags", f.tags.trim());
    if (f.notes.trim()) form.set("notes", f.notes.trim());
    form.set("file", file);

    const res = await createAd(form);
    setBusy(false);
    if (res.error || !res.ad) {
      setErr(res.error ?? "save failed");
      return;
    }
    onSaved(res.ad);
    reset();
    setOpen(false);
  };

  if (!open) {
    return (
      <button type="button" style={primary} onClick={() => setOpen(true)}>
        + Add ad
      </button>
    );
  }

  const isVideo = file?.type.startsWith("video/");

  return (
    <div style={{ border: "1px solid #1b2030", borderRadius: 8, background: "#0c111c", padding: 16, marginBottom: 16 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 10 }}>
        <label style={{ ...label, gridColumn: "1 / -1" }}>
          Media file* (png / jpeg / webp / gif / mp4 / webm)
          <input ref={fileRef} type="file" accept={ACCEPT} onChange={onFile} style={field} />
        </label>
        {preview && (
          <div style={{ gridColumn: "1 / -1" }}>
            {isVideo ? (
              // eslint-disable-next-line jsx-a11y/media-has-caption
              <video src={preview} style={{ maxHeight: 180, maxWidth: "100%", borderRadius: 6 }} controls muted />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={preview} alt="preview" style={{ maxHeight: 180, maxWidth: "100%", borderRadius: 6 }} />
            )}
          </div>
        )}
        <label style={label}>Title*<input style={field} value={f.title} onChange={set("title")} placeholder="Summer Sale" /></label>
        <label style={label}>Advertiser<input style={field} value={f.advertiser} onChange={set("advertiser")} placeholder="Beans Ltd" /></label>
        <label style={label}>Weight<input style={field} value={f.weight} onChange={set("weight")} inputMode="decimal" placeholder="1" /></label>
        <label style={label}>Status
          <select style={{ ...select, ...field }} value={f.status} onChange={set("status")}>
            {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <div style={{ ...label, gridColumn: "1 / -1" }}>
          Runs in
          <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
            {AD_PLACEMENTS.map((p) => (
              <label key={p} style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13, color: "#fff", cursor: "pointer" }}>
                <input type="checkbox" checked={placements.includes(p)} onChange={() => togglePlacement(p)} />
                {AD_PLACEMENT_LABELS[p]}
              </label>
            ))}
            <span style={{ fontSize: 11, color: "#8b95a7" }}>
              Ad break shows the creative full screen; ticker mention weaves &ldquo;Sponsored by {f.advertiser.trim() || "…"}&rdquo; into the crawl; the billboard rotates image creative through the bottom-left corner (wide, roughly 2.5:1&ndash;4:1, reads best).
            </span>
          </div>
          {isVideo && placements.includes("billboard") && (
            <div style={{ fontSize: 11, color: "#fbbf24" }}>
              The billboard airs images only — this video will run on its other placements but never in the corner.
            </div>
          )}
        </div>
        <label style={{ ...label, gridColumn: "1 / -1" }}>Click URL<input style={field} value={f.clickUrl} onChange={set("clickUrl")} placeholder="https://sponsor.example" /></label>
        <label style={{ ...label, gridColumn: "1 / -1" }}>Tags (comma separated)<input style={field} value={f.tags} onChange={set("tags")} placeholder="summer, drinks" /></label>
        <label style={{ ...label, gridColumn: "1 / -1" }}>Notes<textarea style={{ ...field, minHeight: 48, resize: "vertical" }} value={f.notes} onChange={set("notes")} placeholder="Runs through August" /></label>
      </div>
      {err && <div style={{ color: "#fca5a5", fontSize: 13, marginTop: 10 }}>{err}</div>}
      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <button type="button" style={primary} onClick={submit} disabled={busy}>{busy ? "Uploading…" : "Save ad"}</button>
        <button type="button" style={{ ...primary, background: "#1a1f2b" }} onClick={() => { reset(); setOpen(false); setErr(null); }}>Cancel</button>
      </div>
    </div>
  );
}
