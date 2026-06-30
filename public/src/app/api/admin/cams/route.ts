import { NextResponse } from "next/server";
import { getAppDb } from "@photonsurge/shared/db/index";
import { normaliseCam } from "@photonsurge/shared/cams/normalise";
import type { CamStatus } from "@photonsurge/shared/cams/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_CACHE = { "Cache-Control": "no-store" };
const STATUSES: CamStatus[] = ["active", "inactive", "unknown"];

/**
 * GET /api/admin/cams?status=active&bbox=w,s,e,n&q=dover&limit=0
 * Reads the worker/admin-managed webcam catalog from Mongo. The public app
 * never calls the upstream provider directly. No limit by default (show all).
 */
export async function GET(req: Request) {
  const url = new URL(req.url);

  const statusRaw = url.searchParams.get("status");
  const status = STATUSES.includes(statusRaw as CamStatus)
    ? (statusRaw as CamStatus)
    : undefined;

  let bbox: [number, number, number, number] | undefined;
  const bboxRaw = url.searchParams.get("bbox");
  if (bboxRaw) {
    const parts = bboxRaw.split(",").map(Number);
    if (parts.length === 4 && parts.every(Number.isFinite)) {
      bbox = parts as [number, number, number, number];
    }
  }

  const q = url.searchParams.get("q")?.trim() || undefined;
  const limitRaw = Number(url.searchParams.get("limit"));
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : undefined;

  try {
    const db = await getAppDb();
    const cams = await db.cams.list({ status, bbox, q, limit });
    return NextResponse.json({ count: cams.length, cams }, { status: 200, headers: NO_CACHE });
  } catch (err) {
    return NextResponse.json(
      { error: String(err), cams: [], count: 0 },
      { status: 502, headers: NO_CACHE },
    );
  }
}

/**
 * POST /api/admin/cams — create/update one cam from manual admin entry. The
 * body is validated + canonicalised by `normaliseCam`; an unusable record
 * (missing id/title or bad coordinates) is rejected with 400. Upserts on
 * `camId`, so re-posting the same id edits it.
 */
export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400, headers: NO_CACHE });
  }

  const cam = normaliseCam(body);
  if (!cam) {
    return NextResponse.json(
      { error: "cam needs a camId, a title and valid lat/lng" },
      { status: 400, headers: NO_CACHE },
    );
  }

  try {
    const db = await getAppDb();
    const saved = await db.cams.upsertOne(cam);
    return NextResponse.json({ cam: saved }, { status: 200, headers: NO_CACHE });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 502, headers: NO_CACHE });
  }
}
