import { NextResponse } from "next/server";
import { getAppDb } from "@photonsurge/shared/db/index";
import type { VehicleKind } from "@photonsurge/shared/db/vehicle-model";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_CACHE = { "Cache-Control": "no-store" };

/**
 * GET /api/vehicles?kind=aircraft|ship&notable=1&q=&limit=
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
  const limitRaw = Number(url.searchParams.get("limit"));
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : 0;

  try {
    const db = await getAppDb();
    const vehicles = await db.vehicles.list({ kind, notable, q, limit });
    return NextResponse.json({ count: vehicles.length, vehicles }, { status: 200, headers: NO_CACHE });
  } catch (err) {
    return NextResponse.json({ error: String(err), vehicles: [], count: 0 }, { status: 502, headers: NO_CACHE });
  }
}
