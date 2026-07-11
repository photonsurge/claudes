"use client";

/**
 * /admin/content/[type] — the admin list for one editable entity type (city,
 * country, region, volcano, alert, quake, seismic). Every row links to its
 * detail subpage where the edit popover lives. Shows a hero thumbnail, an
 * "edited" marker and image count so curated items stand out. Client-side search
 * over the full list (no arbitrary caps — the whole catalog loads).
 */
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { isAdminEntityType } from "@photonsurge/shared/admin-content/types";
import { ENTITY_SCHEMAS } from "@photonsurge/shared/admin-content/schema";
import AdminPageShell from "../../../../components/admin/AdminPageShell";
import { adminMediaPath, listContent, type ContentListItem } from "../../../../lib/admin-content/client";

export default function AdminContentListPage() {
  const { type } = useParams<{ type: string }>();
  const valid = isAdminEntityType(type);
  const [items, setItems] = useState<ContentListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");

  useEffect(() => {
    if (!valid) return;
    let live = true;
    setLoading(true);
    listContent(type).then((rows) => {
      if (!live) return;
      setItems(rows);
      setLoading(false);
    });
    return () => {
      live = false;
    };
  }, [type, valid]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return items;
    return items.filter((i) => `${i.name} ${i.subtitle}`.toLowerCase().includes(needle));
  }, [items, q]);

  if (!valid) {
    return (
      <AdminPageShell title="Content" description="Unknown entity type.">
        <div style={{ color: "#fca5a5" }}>No such content type.</div>
      </AdminPageShell>
    );
  }

  const schema = ENTITY_SCHEMAS[type];
  const editedCount = items.filter((i) => i.edited || i.imageCount > 0).length;

  return (
    <AdminPageShell
      title={schema.plural}
      description={`Edit on-air text and images for ${schema.plural.toLowerCase()}. ${editedCount} curated.`}
      crumbs={[{ label: schema.plural }]}
      actions={
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={`Search ${schema.plural.toLowerCase()}…`}
          style={{
            background: "#0c111c",
            color: "#fff",
            border: "1px solid #1b2030",
            borderRadius: 6,
            padding: "7px 10px",
            fontSize: 13,
            minWidth: 240,
          }}
        />
      }
    >
      {loading ? (
        <div style={{ color: "#8b95a7" }}>Loading…</div>
      ) : filtered.length === 0 ? (
        <div style={{ color: "#8b95a7" }}>{items.length ? "No matches." : "Nothing here yet."}</div>
      ) : (
        <div style={{ display: "grid", gap: 8 }}>
          <div style={{ color: "#5b6577", fontSize: 12 }}>{filtered.length.toLocaleString()} items</div>
          {filtered.map((i) => (
            <Link
              key={i.id}
              href={`/admin/content/${type}/${encodeURIComponent(i.id)}`}
              style={{ textDecoration: "none", color: "inherit" }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "8px 12px",
                  border: "1px solid #1b2030",
                  borderRadius: 8,
                  background: "#0c111c",
                }}
              >
                <div
                  style={{
                    width: 52,
                    height: 40,
                    borderRadius: 5,
                    background: "#0a0e16",
                    flexShrink: 0,
                    overflow: "hidden",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "#3a4152",
                    fontSize: 18,
                  }}
                >
                  {i.primaryImageId ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={adminMediaPath(i.primaryImageId)} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  ) : (
                    "▦"
                  )}
                </div>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {i.name || i.id}
                  </div>
                  {i.subtitle ? <div style={{ fontSize: 12, color: "#8b95a7" }}>{i.subtitle}</div> : null}
                </div>
                <div style={{ display: "flex", gap: 6, alignItems: "center", flexShrink: 0 }}>
                  {i.edited ? <Tag color="#eab308" label="edited" /> : null}
                  {i.imageCount > 0 ? <Tag color="#38bdf8" label={`${i.imageCount} img`} /> : null}
                  <span style={{ color: "#3a4152" }}>›</span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </AdminPageShell>
  );
}

function Tag({ color, label }: { color: string; label: string }) {
  return (
    <span
      style={{
        fontSize: 10,
        fontWeight: 800,
        letterSpacing: 0.5,
        color,
        border: `1px solid ${color}55`,
        borderRadius: 4,
        padding: "1px 6px",
      }}
    >
      {label}
    </span>
  );
}
