"use client";

/**
 * /admin/content — the content-editor hub: pick a catalog/signal type to edit
 * its items' on-air text + images. Each card deep-links to that type's list
 * (/admin/content/[type]), where every item opens an edit popover with a live
 * on-air preview.
 */
import Link from "next/link";
import { ADMIN_ENTITY_TYPES } from "@photonsurge/shared/admin-content/types";
import { ENTITY_SCHEMAS } from "@photonsurge/shared/admin-content/schema";
import AdminPageShell from "../../../components/admin/AdminPageShell";

const DESC: Record<string, string> = {
  city: "City markers — name, blurb and on-air imagery.",
  country: "Countries — capital, blurb, currency and imagery.",
  region: "Oceans, continents and blocs — name, blurb and imagery.",
  volcano: "Active volcanoes — status, reports, blurb and imagery.",
  alert: "Weather alerts — headline, description and instruction.",
  quake: "Earthquakes — place label and imagery.",
  seismic: "Seismic stations — site name and imagery.",
};

const ICON: Record<string, string> = {
  city: "🏙️",
  country: "🏳️",
  region: "🌍",
  volcano: "🌋",
  alert: "⚠️",
  quake: "🌐",
  seismic: "📡",
};

export default function AdminContentHub() {
  return (
    <AdminPageShell
      title="Content editor"
      description="Edit the on-air text and images for any catalog or signal item — with a live preview of how it looks on air. Edits survive feed refreshes."
      crumbs={[{ label: "Content" }]}
    >
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 12 }}>
        {ADMIN_ENTITY_TYPES.map((type) => (
          <Link key={type} href={`/admin/content/${type}`} style={{ textDecoration: "none", color: "inherit" }}>
            <div style={{ padding: 16, borderRadius: 8, border: "1px solid #1b2030", background: "#0c111c", height: "100%" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 18 }}>{ICON[type]}</span>
                <h3 style={{ margin: 0, fontSize: 15 }}>{ENTITY_SCHEMAS[type].plural}</h3>
              </div>
              <div style={{ color: "#8b95a7", fontSize: 13, marginTop: 6 }}>{DESC[type]}</div>
            </div>
          </Link>
        ))}
      </div>
    </AdminPageShell>
  );
}
