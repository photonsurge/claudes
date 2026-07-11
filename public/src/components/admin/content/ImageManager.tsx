"use client";

/**
 * The uniform image manager for any admin entity: a gallery of uploaded images
 * with upload (file), set-primary (the hero used on air), caption/credit edit
 * and delete. Bytes are stored in Mongo and served from /api/media/:id; this
 * component only ever deals in metadata + the serve URL. Notifies the parent on
 * any change so the on-air preview + list thumbnails refresh.
 */
import { useRef, useState } from "react";
import type { AdminEntityType } from "@photonsurge/shared/admin-content/types";
import {
  adminMediaPath,
  deleteImage,
  patchImage,
  setPrimaryImage,
  uploadImage,
  type AdminImage,
} from "../../../lib/admin-content/client";

const ACCEPT = "image/png,image/jpeg,image/webp,image/gif,image/avif";

const btn: React.CSSProperties = {
  background: "#1a1f2b",
  border: "1px solid #2a3344",
  color: "#cdd4e0",
  borderRadius: 5,
  padding: "4px 8px",
  fontSize: 11,
  cursor: "pointer",
};

export default function ImageManager({
  type,
  entityId,
  images,
  onChange,
}: {
  type: AdminEntityType;
  entityId: string;
  images: AdminImage[];
  onChange: (images: AdminImage[]) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = (next: AdminImage[]) => onChange(next);

  const onUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;
    setBusy(true);
    setNote(null);
    const added: AdminImage[] = [];
    for (const file of files) {
      const res = await uploadImage(type, entityId, file);
      if ("error" in res) {
        setNote(res.error);
        break;
      }
      added.push(res.image);
    }
    setBusy(false);
    if (fileRef.current) fileRef.current.value = "";
    if (added.length) refresh([...images, ...added]);
  };

  const makePrimary = async (id: string) => {
    setBusy(true);
    const res = await setPrimaryImage(type, entityId, id);
    setBusy(false);
    if ("error" in res) return setNote(res.error);
    refresh(images.map((im) => ({ ...im, primary: im.id === id })));
  };

  const remove = async (id: string) => {
    if (!confirm("Remove this image?")) return;
    setBusy(true);
    const res = await deleteImage(type, entityId, id);
    setBusy(false);
    if ("error" in res) return setNote(res.error);
    const next = images.filter((im) => im.id !== id);
    // If we removed the primary, the server promotes the next one — mirror that.
    if (!next.some((im) => im.primary) && next[0]) next[0] = { ...next[0], primary: true };
    refresh(next);
  };

  const saveMeta = async (id: string, patch: { caption?: string; credit?: string }) => {
    const res = await patchImage(type, entityId, id, patch);
    if ("error" in res) return setNote(res.error);
    refresh(images.map((im) => (im.id === id ? res.image : im)));
  };

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
        <label style={{ ...btn, background: "#2563eb", color: "#fff", borderColor: "#2563eb", cursor: busy ? "wait" : "pointer" }}>
          {busy ? "Uploading…" : "＋ Upload image"}
          <input ref={fileRef} type="file" accept={ACCEPT} multiple onChange={onUpload} style={{ display: "none" }} disabled={busy} />
        </label>
        <span style={{ fontSize: 11, color: "#5b6577" }}>PNG/JPEG/WebP/GIF/AVIF · up to 12 MB</span>
        {note ? <span style={{ fontSize: 11, color: "#fca5a5" }}>{note}</span> : null}
      </div>

      {images.length === 0 ? (
        <div style={{ fontSize: 12.5, color: "#5b6577", padding: "10px 0" }}>
          No images yet. The first you upload becomes the primary (on-air) image.
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 10 }}>
          {images.map((im) => (
            <div
              key={im.id}
              style={{
                border: `1px solid ${im.primary ? "#eab308" : "#1b2030"}`,
                borderRadius: 8,
                overflow: "hidden",
                background: "#0a0e16",
              }}
            >
              <div style={{ position: "relative" }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={adminMediaPath(im.id, im.updatedAt)}
                  alt={im.caption ?? ""}
                  style={{ width: "100%", height: 100, objectFit: "cover", display: "block" }}
                />
                {im.primary ? (
                  <span
                    style={{
                      position: "absolute",
                      top: 6,
                      left: 6,
                      background: "#eab308",
                      color: "#0a0e16",
                      fontSize: 9,
                      fontWeight: 800,
                      letterSpacing: 0.6,
                      padding: "2px 6px",
                      borderRadius: 4,
                    }}
                  >
                    ★ PRIMARY
                  </span>
                ) : null}
              </div>
              <div style={{ padding: 8, display: "grid", gap: 6 }}>
                <input
                  defaultValue={im.caption ?? ""}
                  placeholder="Caption"
                  onBlur={(e) => e.target.value !== (im.caption ?? "") && saveMeta(im.id, { caption: e.target.value })}
                  style={{ ...btn, cursor: "text", width: "100%", background: "#0c111c" }}
                />
                <input
                  defaultValue={im.credit ?? ""}
                  placeholder="Credit"
                  onBlur={(e) => e.target.value !== (im.credit ?? "") && saveMeta(im.id, { credit: e.target.value })}
                  style={{ ...btn, cursor: "text", width: "100%", background: "#0c111c" }}
                />
                <div style={{ display: "flex", gap: 6 }}>
                  {!im.primary ? (
                    <button type="button" style={{ ...btn, flex: 1 }} onClick={() => makePrimary(im.id)} disabled={busy}>
                      Set primary
                    </button>
                  ) : (
                    <span style={{ ...btn, flex: 1, textAlign: "center", opacity: 0.6, cursor: "default" }}>Primary</span>
                  )}
                  <button
                    type="button"
                    style={{ ...btn, color: "#fca5a5", borderColor: "#4a2530" }}
                    onClick={() => remove(im.id)}
                    disabled={busy}
                  >
                    Delete
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
