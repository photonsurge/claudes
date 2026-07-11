"use client";

/**
 * The edit popover for any catalog/signal entity: text fields (from the entity's
 * edit schema) + image manager on the left, a LIVE on-air preview on the right.
 * Fetches the merged content on open, saves text overrides on Save (only fields
 * that differ from the base are persisted), and image changes save immediately.
 * Notifies the parent via `onChanged` so the detail page/list refreshes.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import type { AdminEntityType } from "@photonsurge/shared/admin-content/types";
import { ENTITY_SCHEMAS } from "@photonsurge/shared/admin-content/schema";
import { applyTextOverrides } from "@photonsurge/shared/admin-content/resolve";
import {
  getContent,
  saveText,
  type AdminImage,
  type ResolvedContent,
} from "../../../lib/admin-content/client";
import { primary } from "../../tracks/styles";
import EditModal from "./EditModal";
import EntityEditor from "./EntityEditor";
import ImageManager from "./ImageManager";
import OnAirPreview from "./OnAirPreview";

const cancelBtn: React.CSSProperties = {
  ...primary,
  background: "#1a1f2b",
  borderColor: "#2a3344",
};

export default function ContentEditorModal({
  type,
  id,
  label,
  onClose,
  onChanged,
}: {
  type: AdminEntityType;
  id: string;
  /** Optional display name for the modal header (falls back to the entity name). */
  label?: string;
  onClose: () => void;
  onChanged?: () => void;
}) {
  const schema = ENTITY_SCHEMAS[type];
  const [content, setContent] = useState<ResolvedContent | null>(null);
  const [missing, setMissing] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  const [images, setImages] = useState<AdminImage[]>([]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const seed = useCallback(
    (c: ResolvedContent) => {
      const v: Record<string, string> = {};
      for (const f of schema.fields) v[f.field] = c.text[f.field] ?? c.baseText[f.field] ?? "";
      setValues(v);
      setImages(c.images);
    },
    [schema.fields],
  );

  useEffect(() => {
    let live = true;
    (async () => {
      const c = await getContent(type, id);
      if (!live) return;
      if (!c) return setMissing(true);
      setContent(c);
      seed(c);
    })();
    return () => {
      live = false;
    };
  }, [type, id, seed]);

  // The entity as it would read on air with the CURRENT (unsaved) form values.
  const previewEntity = useMemo(() => {
    if (!content?.entity) return null;
    const effective: Record<string, string> = {};
    for (const f of schema.fields) {
      const typed = (values[f.field] ?? "").trim();
      effective[f.field] = typed !== "" ? typed : content.baseText[f.field] ?? "";
    }
    return applyTextOverrides(type, content.entity, effective);
  }, [content, values, schema.fields, type]);

  const dirty =
    !!content &&
    schema.fields.some((f) => {
      const saved = content.text[f.field] ?? content.baseText[f.field] ?? "";
      return (values[f.field] ?? "") !== saved;
    });

  const onSave = async () => {
    if (!content) return;
    setBusy(true);
    setNote(null);
    // Persist only fields that differ from the base (empty/equal → no override).
    const overrides: Record<string, string> = {};
    for (const f of schema.fields) {
      const typed = (values[f.field] ?? "").trim();
      if (typed !== "" && typed !== (content.baseText[f.field] ?? "").trim()) overrides[f.field] = typed;
    }
    const res = await saveText(type, content.entityId, overrides);
    setBusy(false);
    if ("error" in res) return setNote(res.error);
    setContent(res);
    seed(res);
    setNote("Saved");
    onChanged?.();
  };

  const heading = label || (content?.entity?.name as string) || content?.entityId || id;

  return (
    <EditModal
      title={`Edit ${schema.label.toLowerCase()}: ${heading}`}
      subtitle="Edit the on-air text and images. Changes survive feed refreshes."
      onClose={onClose}
      footer={
        <>
          {note ? (
            <span style={{ fontSize: 12, color: note === "Saved" ? "#8b95a7" : "#fca5a5", marginRight: "auto" }}>
              {note}
            </span>
          ) : null}
          <button type="button" style={cancelBtn} onClick={onClose}>Close</button>
          <button type="button" style={primary} onClick={onSave} disabled={busy || !dirty}>
            {busy ? "Saving…" : dirty ? "Save text" : "Saved"}
          </button>
        </>
      }
    >
      {missing ? (
        <div style={{ color: "#fca5a5" }}>This item no longer exists.</div>
      ) : !content ? (
        <div style={{ color: "#8b95a7" }}>Loading…</div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 470px", gap: 22, alignItems: "start" }}>
          <div style={{ display: "grid", gap: 20 }}>
            <section>
              <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 1, color: "#5b6577", marginBottom: 10 }}>
                TEXT
              </div>
              <EntityEditor
                fields={schema.fields}
                values={values}
                baseText={content.baseText}
                onChange={(field, value) => setValues((prev) => ({ ...prev, [field]: value }))}
              />
            </section>
            <section>
              <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 1, color: "#5b6577", marginBottom: 10 }}>
                IMAGES
              </div>
              <ImageManager
                type={type}
                entityId={content.entityId}
                images={images}
                onChange={(next) => {
                  setImages(next);
                  onChanged?.();
                }}
              />
            </section>
          </div>
          <div style={{ position: "sticky", top: 0 }}>
            {previewEntity ? <OnAirPreview type={type} entity={previewEntity} images={images} /> : null}
          </div>
        </div>
      )}
    </EditModal>
  );
}
