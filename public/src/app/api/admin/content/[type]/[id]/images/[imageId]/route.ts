import { NextResponse } from "next/server";
import { getAppDb } from "@photonsurge/shared/db/index";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_CACHE = { "Cache-Control": "no-store" };

/**
 * PATCH /api/admin/content/[type]/[id]/images/[imageId] — set the primary flag,
 * caption, credit or sort on one image. `{ primary: true }` makes it the hero
 * (clearing the flag on its siblings); the other keys patch metadata. Returns
 * the updated image.
 */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ type: string; id: string; imageId: string }> },
) {
  const { imageId } = await params;
  let body: Record<string, unknown> = {};
  try {
    body = ((await req.json()) as Record<string, unknown>) ?? {};
  } catch {
    /* empty body → no-op */
  }

  try {
    const db = await getAppDb();
    const id = decodeURIComponent(imageId);

    if (body.primary === true) {
      const image = await db.adminImages.setPrimary(id);
      if (!image) return NextResponse.json({ error: "image not found" }, { status: 404, headers: NO_CACHE });
      return NextResponse.json({ image }, { status: 200, headers: NO_CACHE });
    }

    const patch: { caption?: string; credit?: string; sort?: number } = {};
    if (typeof body.caption === "string") patch.caption = body.caption;
    if (typeof body.credit === "string") patch.credit = body.credit;
    if (typeof body.sort === "number") patch.sort = body.sort;

    const image = await db.adminImages.patch(id, patch);
    if (!image) return NextResponse.json({ error: "image not found" }, { status: 404, headers: NO_CACHE });
    return NextResponse.json({ image }, { status: 200, headers: NO_CACHE });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 502, headers: NO_CACHE });
  }
}

/** DELETE /api/admin/content/[type]/[id]/images/[imageId] — remove one image. */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ type: string; id: string; imageId: string }> },
) {
  const { imageId } = await params;
  try {
    const db = await getAppDb();
    const removed = await db.adminImages.remove(decodeURIComponent(imageId));
    if (!removed) return NextResponse.json({ error: "image not found" }, { status: 404, headers: NO_CACHE });
    return NextResponse.json({ ok: true }, { status: 200, headers: NO_CACHE });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 502, headers: NO_CACHE });
  }
}
