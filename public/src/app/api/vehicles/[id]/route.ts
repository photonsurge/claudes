import { NextResponse } from "next/server";
import { getAppDb } from "@photonsurge/shared/db/index";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_CACHE = { "Cache-Control": "no-store" };

/**
 * GET /api/vehicles/[id] — one vehicle by id (`${kind}:${code}`, e.g.
 * "ship:310627000"), with its identity + enrichment. Returns the `path`
 * breadcrumb too when present (flagged craft); use /path for just the trail.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const db = await getAppDb();
    const vehicle = await db.vehicles.get(decodeURIComponent(id));
    if (!vehicle) return NextResponse.json({ error: "vehicle not found" }, { status: 404, headers: NO_CACHE });
    return NextResponse.json({ vehicle }, { status: 200, headers: NO_CACHE });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 502, headers: NO_CACHE });
  }
}
