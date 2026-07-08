import { NextResponse } from "next/server";
import { getAppDb } from "@photonsurge/shared/db/index";
import type { VehicleKind } from "@photonsurge/shared/db/vehicle-model";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_CACHE = { "Cache-Control": "no-store" };
const MAX_PAGE_SIZE = 250;
const SORT_FIELDS = new Set(["name", "kind", "code", "country", "timesSeen", "firstSeen", "lastSeen", "updated"]);

/**
 * GET /api/vehicles?kind=aircraft|ship&notable=1&q=&page=1&pageSize=25&sort=lastSeen&direction=desc
 * The persistent vehicle registry (identity + enrichment), independent of the
 * live feed. Reads Mongo only. No limit by default (show everything), recency-
 * sorted; `notable=1` returns just the curated catalog, `q` searches label/name/code.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const kindRaw = url.searchParams.get("kind");
  const kind = kindRaw === "aircraft" || kindRaw === "ship" ? (kindRaw as VehicleKind) : undefined;
  const notableRaw = url.searchParams.get("notable");
  const notable = notableRaw === "1" || notableRaw === "true" ? true : undefined;
  const q = url.searchParams.get("q")?.trim() || undefined;
  // `limit` remains a backwards-compatible alias for pageSize.
  const pageSizeRaw = Number(url.searchParams.get("pageSize") ?? url.searchParams.get("limit"));
  const limit = Number.isFinite(pageSizeRaw) && pageSizeRaw > 0
    ? Math.min(MAX_PAGE_SIZE, Math.floor(pageSizeRaw))
    : 0;
  const pageRaw = Number(url.searchParams.get("page"));
  const page = Number.isFinite(pageRaw) && pageRaw > 0 ? Math.floor(pageRaw) : 1;
  const skip = limit > 0 ? (page - 1) * limit : 0;
  const sortRaw = url.searchParams.get("sort") || "lastSeen";
  const sortField = SORT_FIELDS.has(sortRaw) ? sortRaw : "lastSeen";
  const direction: 1 | -1 = url.searchParams.get("direction") === "asc" ? 1 : -1;
  const sort = { [sortField]: direction, id: 1 as const };

  try {
    const db = await getAppDb();
    const countQuery: Record<string, unknown> = {};
    if (kind) countQuery.kind = kind;
    if (typeof notable === "boolean") countQuery.notable = notable;
    if (q) {
      const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      countQuery.$or = [{ label: rx }, { name: rx }, { code: rx }];
    }

    const [rows, total] = await Promise.all([
      db.vehicles.list({ kind, notable, q, limit, skip, sort }),
      db.vehicles.count(countQuery),
    ]);
    const aircraftCodes = [...new Set(rows.filter((vehicle) => vehicle.kind === "aircraft").map((vehicle) => vehicle.code))];
    const metaResult = aircraftCodes.length
      ? await db.aircraftMeta.getAll({ id: { $in: aircraftCodes } }, { limit: aircraftCodes.length, sort: null })
      : { data: [] };
    const metaByCode = new Map((metaResult.data ?? []).map((meta) => [meta.id, meta]));
    // Persistent paths can contain thousands of points. The collection endpoint
    // deliberately returns only a cheap count; GET /api/vehicles/[id] remains the
    // full record endpoint when a consumer actually needs the breadcrumb.
    const vehicles = rows.map((vehicle) => {
      const { path, ...summary } = vehicle;
      const aircraftMeta = vehicle.kind === "aircraft" ? metaByCode.get(vehicle.code) : undefined;
      return { ...summary, pathPoints: path?.length ?? 0, aircraftMeta };
    });
    return NextResponse.json(
      {
        count: vehicles.length,
        total,
        page,
        pageSize: limit || Math.max(total, 1),
        pageCount: limit > 0 ? Math.ceil(total / limit) : total > 0 ? 1 : 0,
        sort: sortField,
        direction: direction === 1 ? "asc" : "desc",
        vehicles,
      },
      { status: 200, headers: NO_CACHE },
    );
  } catch (err) {
    return NextResponse.json(
      { error: String(err), vehicles: [], count: 0, total: 0, page, pageSize: limit, pageCount: 0 },
      { status: 502, headers: NO_CACHE },
    );
  }
}
