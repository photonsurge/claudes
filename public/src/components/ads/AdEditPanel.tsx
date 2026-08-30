"use client";

/**
 * Edit the selected ad's metadata and (optionally) swap its media file. Metadata
 * edits PATCH /api/admin/ads/[adId]; a new file PUTs to the same route. Resets
 * whenever the selected ad changes.
 */
import { useEffect, useRef, useState } from "react";
import { replaceAdMedia, updateAd } from "../../lib/ads/client";
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

const fromAd = (ad: Ad) => ({
  title: ad.title,
  advertiser: ad.advertiser ?? "",
  clickUrl: ad.clickUrl ?? "",
  weight: String(ad.weight ?? 1),
  status: ad.status,
  tags: (ad.tags ?? []).join(", "),
  notes: ad.notes ?? "",
});

export default function AdEditPanel({ ad, onSaved }: { ad: Ad; onSaved: (ad: Ad) => void }) {
  const [f, setF] = useState(() => fromAd(ad));
  const [placements, setPlacements] = useState<AdPlacement[]>(() => ad.placements ?? ["break"]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Reset the form when a different ad is selected.
  useEffect(() => {
    setF(fromAd(ad));
    setPlacements(ad.placements ?? ["break"]);
    setNote(null);
    if (fileRef.current) fileRef.current.value = "";
  }, [ad.adId]); // eslint-disable-line react-hooks/exhaustive-deps

  const togglePlacement = (p: AdPlacement) =>
    setPlacements((prev) => (prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]));

  const set =
    (k: keyof ReturnType<typeof fromAd>) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setF((prev) => ({ ...prev, [k]: e.target.value }));

  const saveMeta = async () => {
    if (placements.length === 0) {
      setNote("pick at least one placement");
      return;
    }
    setBusy(true);
    setNote(null);
    const res = await updateAd(ad.adId, {
      title: f.title,
      advertiser: f.advertiser,
      clickUrl: f.clickUrl,
      weight: f.weight,
      status: f.status,
      placements,
      tags: f.tags,
      notes: f.notes,
    });
    setBusy(false);
    if (res.error || !res.ad) {
      setNote(res.error ?? "save failed");
      return;
    }
    onSaved(res.ad);
    setNote("Saved");
  };

  const onReplace = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setNote(null);
    const res = await replaceAdMedia(ad.adId, file);
    setBusy(false);
    if (fileRef.current) fileRef.current.value = "";
    if (res.error || !res.ad) {
      setNote(res.error ?? "replace failed");
      return;
    }
    onSaved(res.ad);
    setNote("Media replaced");
  };

  return (
    <div style={{ marginTop: 12, borderTop: "1px solid #1b2030", paddingTop: 12 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))", gap: 8 }}>
        <label style={{ ...label, gridColumn: "1 / -1" }}>Title<input style={field} value={f.title} onChange={set("title")} /></label>
        <label style={label}>Advertiser<input style={field} value={f.advertiser} onChange={set("advertiser")} /></label>
        <label style={label}>Weight<input style={field} value={f.weight} onChange={set("weight")} inputMode="decimal" /></label>
        <label style={label}>Status
          <select style={{ ...select, ...field }} value={f.status} onChange={set("status")}>
            {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <div style={{ ...label, gridColumn: "1 / -1" }}>
          Runs in
          <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
            {AD_PLACEMENTS.map((p) => (
              <label key={p} style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13, color: "#fff", cursor: "pointer" }}>
                <input type="checkbox" checked={placements.includes(p)} onChange={() => togglePlacement(p)} />
                {AD_PLACEMENT_LABELS[p]}
              </label>
            ))}
          </div>
          {ad.mediaType === "video" && placements.includes("billboard") && (
            <div style={{ fontSize: 11, color: "#fbbf24" }}>
              The billboard airs images only — this video will run on its other placements but never in the corner.
            </div>
          )}
        </div>
        <label style={{ ...label, gridColumn: "1 / -1" }}>Click URL<input style={field} value={f.clickUrl} onChange={set("clickUrl")} /></label>
        <label style={{ ...label, gridColumn: "1 / -1" }}>Tags<input style={field} value={f.tags} onChange={set("tags")} placeholder="comma separated" /></label>
        <label style={{ ...label, gridColumn: "1 / -1" }}>Notes<textarea style={{ ...field, minHeight: 44, resize: "vertical" }} value={f.notes} onChange={set("notes")} /></label>
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 10, alignItems: "center", flexWrap: "wrap" }}>
        <button type="button" style={primary} onClick={saveMeta} disabled={busy}>{busy ? "…" : "Save"}</button>
        <label style={{ ...primary, background: "#1a1f2b", cursor: "pointer", margin: 0 }}>
          Replace media
          <input ref={fileRef} type="file" accept={ACCEPT} onChange={onReplace} style={{ display: "none" }} />
        </label>
        {note && <span style={{ fontSize: 12, color: note.includes("fail") || note.includes("large") ? "#fca5a5" : "#8b95a7" }}>{note}</span>}
      </div>
    </div>
  );
}
