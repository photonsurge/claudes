import { withApiLog } from "../../../../../lib/api-log";
import { NextResponse } from "next/server";
import { getAppDb } from "@photonsurge/shared/db/index";
import { requireAdmin } from "../../../../../lib/require-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_CACHE = { "Cache-Control": "no-store" };

/**
 * GET /api/crossword/:scene/config — the crossword channel's config, merged over
 * the defaults (nothing is written until a PATCH). Admin only: proxy.ts does not
 * match /api/crossword, so the gate is here.
 */
async function GET__impl(_req: Request, { params }: { params: Promise<{ scene: string }> }) {
  if (!(await requireAdmin())) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: NO_CACHE });
  const { scene } = await params;
  const db = await getAppDb();
  if (!(await db.getScene(scene))) {
    return NextResponse.json({ error: "no such scene" }, { status: 404, headers: NO_CACHE });
  }
  return NextResponse.json(await db.getOrInitCrosswordConfig(scene), { status: 200, headers: NO_CACHE });
}

/**
 * PATCH /api/crossword/:scene/config — merge a patch (unknown keys dropped,
 * numbers clamped to CROSSWORD_CONFIG_LIMITS), persist, return the result. The
 * worker's runner re-reads it each tick, so a Save lands without a restart.
 */
async function PATCH__impl(req: Request, { params }: { params: Promise<{ scene: string }> }) {
  if (!(await requireAdmin())) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: NO_CACHE });
  const { scene } = await params;
  let patch: unknown = {};
  try {
    patch = (await req.json()) ?? {};
  } catch {
    /* empty patch is a no-op merge */
  }
  if (typeof patch !== "object" || Array.isArray(patch)) {
    return NextResponse.json({ error: "expected a config object" }, { status: 400, headers: NO_CACHE });
  }
  const db = await getAppDb();
  if (!(await db.getScene(scene))) {
    return NextResponse.json({ error: "no such scene" }, { status: 404, headers: NO_CACHE });
  }
  const merged = await db.saveCrosswordConfig(scene, patch as Record<string, unknown>);
  return NextResponse.json(merged, { status: 200, headers: NO_CACHE });
}

// --- request logging (lib/api-log) ---
export const GET = withApiLog(GET__impl);
export const PATCH = withApiLog(PATCH__impl);
