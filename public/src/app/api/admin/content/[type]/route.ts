import { withApiLog } from "../../../../../lib/api-log";
import { NextResponse } from "next/server";
import { getAppDb } from "@photonsurge/shared/db/index";
import type { AppDb } from "@photonsurge/shared/db/index";
import type { AdminEntityType } from "@photonsurge/shared/admin-content/types";
import { isAdminEntityType } from "@photonsurge/shared/admin-content/types";
import { entityIdOf, resolveAdminList } from "@photonsurge/shared/admin-content/resolve";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_CACHE = { "Cache-Control": "no-store" };

/** Load the raw base list for one entity type (everything — no arbitrary cap). */
async function loadList(db: AppDb, type: AdminEntityType): Promise<Record<string, any>[]> {
  switch (type) {
    case "city": {
      const r = await db.cities.getAll({}, { sort: { population: -1 }, limit: 0 });
      return (r.success && r.data ? r.data : []) as Record<string, any>[];
    }
    case "country":
      return (await db.countries.list()) as Record<string, any>[];
    case "region":
      return (await db.regions.list()) as Record<string, any>[];
    case "volcano": {
      // Active only — exclude long-dormant volcanoes (keep erupting + unrest).
      const all = await db.volcanoes.list({});
      return all.filter((v) => v.status !== "dormant") as Record<string, any>[];
    }
    case "alert":
      // Active only — the feed marks expired/cancelled alerts inactive.
      return (await db.alerts.list({ activeOnly: true })) as Record<string, any>[];
    case "quake":
      return (await db.quakes.list({ limit: 0 })) as Record<string, any>[];
    case "seismic": {
      // Active only — the stations the worker is currently streaming (near air).
      const activeKeys = new Set(await db.seismoSeries.activeKeys());
      const all = await db.seismoStations.list();
      return all.filter((s) => activeKeys.has(s.key)) as Record<string, any>[];
    }
    default:
      return [];
  }
}

/** A one-line name + subtitle for a (merged) entity, for the list table. */
function summarize(type: AdminEntityType, e: Record<string, any>): { name: string; subtitle: string } {
  const join = (...parts: unknown[]) => parts.filter(Boolean).join(" · ");
  switch (type) {
    case "city":
      return { name: String(e.name ?? ""), subtitle: join(e.region, e.country) };
    case "country":
      return { name: String(e.name ?? ""), subtitle: join(e.continent, e.subregion) };
    case "region":
      return { name: String(e.name ?? ""), subtitle: String(e.group ?? "") };
    case "volcano":
      return { name: String(e.name ?? ""), subtitle: join(e.status, e.country) };
    case "alert": {
      const i = Array.isArray(e.info) ? e.info[0] ?? {} : {};
      return { name: String(i.event || i.headline || e.identifier || "Alert"), subtitle: join(e.sender, i.severity) };
    }
    case "quake": {
      const mag = Number(e.mag) || 0;
      return { name: String(e.place || `M${mag.toFixed(1)}`), subtitle: `M${mag.toFixed(1)} · ${Math.round(Number(e.depthKm) || 0)} km` };
    }
    case "seismic":
      return { name: String(e.siteName || e.key || ""), subtitle: join(e.net && e.sta ? `${e.net}.${e.sta}` : "", e.cha) };
    default:
      return { name: "", subtitle: "" };
  }
}

/**
 * GET /api/admin/content/[type] — the admin list for one entity type: every
 * item with its (override-applied) name/subtitle plus an edited flag + image
 * count, so the browser can show what's been curated. Admin-gated by proxy.ts.
 */
async function GET__impl(
  _req: Request,
  { params }: { params: Promise<{ type: string }> },
) {
  const { type } = await params;
  if (!isAdminEntityType(type)) {
    return NextResponse.json({ error: "unknown entity type" }, { status: 404, headers: NO_CACHE });
  }
  try {
    const db = await getAppDb();
    const raw = await loadList(db, type);
    const decorated = await resolveAdminList(db, type, raw, (item) => entityIdOf(type, item));
    const items = decorated.map((d) => {
      const { name, subtitle } = summarize(type, d.entity);
      return {
        id: entityIdOf(type, d.entity),
        name,
        subtitle,
        edited: d.edited,
        imageCount: d.imageCount,
        primaryImageId: d.primaryImageId,
      };
    });
    return NextResponse.json({ type, count: items.length, items }, { status: 200, headers: NO_CACHE });
  } catch (err) {
    return NextResponse.json({ error: String(err), items: [] }, { status: 502, headers: NO_CACHE });
  }
}

// --- request logging (lib/api-log) ---
export const GET = withApiLog(GET__impl);
