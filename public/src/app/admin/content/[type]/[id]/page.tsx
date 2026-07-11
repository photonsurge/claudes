"use client";

/**
 * /admin/content/[type]/[id] — one entity's detail: its current on-air text +
 * images, a live ON-AIR PREVIEW, and the ✎ Edit popover (text + image manager +
 * preview). Everything here is the override-applied view, so it reflects what's
 * actually going to air.
 */
import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { isAdminEntityType } from "@photonsurge/shared/admin-content/types";
import { ENTITY_SCHEMAS } from "@photonsurge/shared/admin-content/schema";
import AdminPageShell from "../../../../../components/admin/AdminPageShell";
import ContentEditorModal from "../../../../../components/admin/content/ContentEditorModal";
import OnAirPreview from "../../../../../components/admin/content/OnAirPreview";
import { adminMediaPath, getContent, type ResolvedContent } from "../../../../../lib/admin-content/client";
import { primary } from "../../../../../components/tracks/styles";

export default function AdminContentDetailPage() {
  const { type, id } = useParams<{ type: string; id: string }>();
  const valid = isAdminEntityType(type);
  const [content, setContent] = useState<ResolvedContent | null>(null);
  const [missing, setMissing] = useState(false);
  const [editing, setEditing] = useState(false);

  const reload = useCallback(async () => {
    if (!valid) return;
    const c = await getContent(type, decodeURIComponent(id));
    if (!c) setMissing(true);
    else {
      setContent(c);
      setMissing(false);
    }
  }, [type, id, valid]);

  useEffect(() => {
    reload();
  }, [reload]);

  if (!valid) {
    return (
      <AdminPageShell title="Content">
        <div style={{ color: "#fca5a5" }}>No such content type.</div>
      </AdminPageShell>
    );
  }

  const schema = ENTITY_SCHEMAS[type];
  const name = (content?.entity?.name as string) || content?.entityId || decodeURIComponent(id);

  return (
    <AdminPageShell
      title={name}
      crumbs={[
        { href: `/admin/content/${type}`, label: schema.plural },
        { label: name },
      ]}
      actions={
        content ? (
          <button type="button" style={primary} onClick={() => setEditing(true)}>
            ✎ Edit
          </button>
        ) : null
      }
    >
      {missing ? (
        <div style={{ color: "#fca5a5" }}>This item no longer exists.</div>
      ) : !content ? (
        <div style={{ color: "#8b95a7" }}>Loading…</div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 470px", gap: 24, alignItems: "start" }}>
          <div style={{ display: "grid", gap: 20 }}>
            <section>
              <SectionLabel>Text</SectionLabel>
              <div style={{ display: "grid", gap: 10 }}>
                {schema.fields.map((f) => {
                  const value = fieldValue(type, content.entity, f.field);
                  const overridden = !!content.text[f.field];
                  return (
                    <div key={f.field}>
                      <div style={{ fontSize: 11, color: "#5b6577", display: "flex", gap: 6, alignItems: "center" }}>
                        {f.label}
                        {overridden ? <span style={{ color: "#eab308", fontWeight: 800 }}>● edited</span> : null}
                      </div>
                      <div style={{ fontSize: 14, color: value ? "#e6edf7" : "#3a4152", whiteSpace: "pre-wrap" }}>
                        {value || "—"}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            <section>
              <SectionLabel>Images ({content.images.length})</SectionLabel>
              {content.images.length === 0 ? (
                <div style={{ fontSize: 13, color: "#5b6577" }}>No images. Use Edit to upload.</div>
              ) : (
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {content.images.map((im) => (
                    <div key={im.id} style={{ position: "relative" }}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={adminMediaPath(im.id, im.updatedAt)}
                        alt={im.caption ?? ""}
                        style={{
                          width: 130,
                          height: 90,
                          objectFit: "cover",
                          borderRadius: 6,
                          border: im.primary ? "2px solid #eab308" : "1px solid #1b2030",
                        }}
                      />
                      {im.primary ? (
                        <span style={{ position: "absolute", top: 4, left: 4, background: "#eab308", color: "#0a0e16", fontSize: 9, fontWeight: 800, padding: "1px 5px", borderRadius: 4 }}>★</span>
                      ) : null}
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>

          <div style={{ position: "sticky", top: 16 }}>
            <OnAirPreview type={type} entity={content.entity ?? {}} images={content.images} />
          </div>
        </div>
      )}

      {editing && content ? (
        <ContentEditorModal
          type={type}
          id={content.entityId}
          label={name}
          onClose={() => setEditing(false)}
          onChanged={reload}
        />
      ) : null}
    </AdminPageShell>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 1, color: "#5b6577", marginBottom: 10 }}>
      {children}
    </div>
  );
}

/** The displayed value of an editable field (alerts read from info[0]). */
function fieldValue(type: string, entity: Record<string, any> | null, field: string): string {
  if (!entity) return "";
  const source = type === "alert" ? (Array.isArray(entity.info) && entity.info[0]) || {} : entity;
  const v = source[field];
  return v === undefined || v === null ? "" : String(v);
}
