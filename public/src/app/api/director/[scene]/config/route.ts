import { withApiLog } from "../../../../../lib/api-log";
import { NextResponse } from "next/server";
import { getAppDb } from "@photonsurge/shared/db/index";
import type { DirectorConfig } from "@photonsurge/shared/director";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_CACHE = { "Cache-Control": "no-store" };

/** GET /api/director/:scene/config — the scene's director config (seeded). */
async function GET__impl(_req: Request, { params }: { params: Promise<{ scene: string }> }) {
  const { scene } = await params;
  const db = await getAppDb();
  const cfg = await db.getOrInitDirectorConfig(scene);
  return NextResponse.json(cfg, { status: 200, headers: NO_CACHE });
}

/** PATCH /api/director/:scene/config — merge a config patch, persist, return. */
async function PATCH__impl(req: Request, { params }: { params: Promise<{ scene: string }> }) {
  const { scene } = await params;
  let patch: Partial<DirectorConfig> = {};
  try {
    patch = (await req.json()) ?? {};
  } catch {
    /* empty patch is a no-op merge */
  }
  const db = await getAppDb();
  const merged = await db.saveDirectorConfig(scene, patch as Record<string, unknown>);
  return NextResponse.json(merged, { status: 200, headers: NO_CACHE });
}

// --- request logging (lib/api-log) ---
export const GET = withApiLog(GET__impl);
export const PATCH = withApiLog(PATCH__impl);
