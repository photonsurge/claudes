import { NextResponse } from "next/server";
import { getAppDb } from "@photonsurge/shared/db/index";
import type { VolcanoStatus } from "@photonsurge/shared/volcanoes/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_CACHE = { "Cache-Control": "no-store" };

/**
 * GET /api/volcanoes?status=erupting&limit=0
 * Reads the worker-cached NASA EONET active-volcano events from Mongo — the
 * public app NEVER calls EONET directly. Returns EVERYTHING by default (no cap).
 * Configure the cadence on the worker (VOLCANO_SNAPSHOT_MS).
 */
export async function GET(req: Request) {
  const url = new URL(req.url);

  const statusRaw = url.searchParams.get("status");
  const status: VolcanoStatus | undefined =
    statusRaw === "erupting" || statusRaw === "unrest" ? statusRaw : undefined;

  const limitRaw = Number(url.searchParams.get("limit"));
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : undefined;

  try {
    const db = await getAppDb();
    const volcanoes = await db.volcanoes.list({ status, limit });
    return NextResponse.json(
      { count: volcanoes.length, volcanoes },
      { status: 200, headers: NO_CACHE },
    );
  } catch (err) {
    return NextResponse.json(
      { error: String(err), volcanoes: [], count: 0 },
      { status: 502, headers: NO_CACHE },
    );
  }
}
