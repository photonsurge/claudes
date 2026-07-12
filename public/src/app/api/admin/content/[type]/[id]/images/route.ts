import { withApiLog } from "../../../../../../../lib/api-log";
import { NextResponse } from "next/server";
import { getAppDb } from "@photonsurge/shared/db/index";
import { isAdminEntityType } from "@photonsurge/shared/admin-content/types";
import { parseUploadedImage } from "../../../../../../../lib/admin-content/upload";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_CACHE = { "Cache-Control": "no-store" };

/** GET /api/admin/content/[type]/[id]/images — the entity's gallery (no bytes). */
async function GET__impl(
  _req: Request,
  { params }: { params: Promise<{ type: string; id: string }> },
) {
  const { type, id } = await params;
  if (!isAdminEntityType(type)) {
    return NextResponse.json({ error: "unknown entity type" }, { status: 404, headers: NO_CACHE });
  }
  try {
    const db = await getAppDb();
    const images = await db.adminImages.list(type, decodeURIComponent(id));
    return NextResponse.json({ images }, { status: 200, headers: NO_CACHE });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 502, headers: NO_CACHE });
  }
}

/**
 * POST /api/admin/content/[type]/[id]/images — upload one image (multipart
 * `file`, optional `caption`/`credit`). The first image on an entity becomes its
 * primary. Returns the created image (no bytes).
 */
async function POST__impl(
  req: Request,
  { params }: { params: Promise<{ type: string; id: string }> },
) {
  const { type, id } = await params;
  if (!isAdminEntityType(type)) {
    return NextResponse.json({ error: "unknown entity type" }, { status: 404, headers: NO_CACHE });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json(
      { error: "expected multipart/form-data" },
      { status: 400, headers: NO_CACHE },
    );
  }

  const parsed = await parseUploadedImage(form);
  if ("response" in parsed) return parsed.response;

  try {
    const db = await getAppDb();
    const image = await db.adminImages.add(type, decodeURIComponent(id), parsed.image);
    return NextResponse.json({ image }, { status: 200, headers: NO_CACHE });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 502, headers: NO_CACHE });
  }
}

// --- request logging (lib/api-log) ---
export const GET = withApiLog(GET__impl);
export const POST = withApiLog(POST__impl);
