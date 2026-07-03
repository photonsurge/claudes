import { NextResponse } from "next/server";
import { getAppDb } from "@photonsurge/shared/db/index";
import { normaliseAdPatch } from "@photonsurge/shared/ads/normalise";
import { parseAdMedia } from "../../../../../lib/ads/upload";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_CACHE = { "Cache-Control": "no-store" };

/**
 * PATCH /api/admin/ads/[adId] — edit metadata (title/status/advertiser/clickUrl/
 * weight/tags/notes). Only fields present in the body are touched. Also serves
 * the admin status toggle.
 */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ adId: string }> },
) {
  const { adId } = await params;
  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    /* empty body → empty patch → no-op update */
  }

  const patch = normaliseAdPatch(body);
  const db = await getAppDb();
  const ad = await db.ads.updateMeta(decodeURIComponent(adId), patch);
  if (!ad) {
    return NextResponse.json({ error: "ad not found" }, { status: 404, headers: NO_CACHE });
  }
  return NextResponse.json({ ad }, { status: 200, headers: NO_CACHE });
}

/**
 * PUT /api/admin/ads/[adId] — replace the media bytes (multipart `file`) while
 * keeping the id + metadata. `updated` bumps, so the media URL cache-buster
 * changes automatically.
 */
export async function PUT(
  req: Request,
  { params }: { params: Promise<{ adId: string }> },
) {
  const { adId } = await params;
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json(
      { error: "expected multipart/form-data" },
      { status: 400, headers: NO_CACHE },
    );
  }

  const parsed = await parseAdMedia(form);
  if ("response" in parsed) return parsed.response;

  const db = await getAppDb();
  const ad = await db.ads.replaceMedia(decodeURIComponent(adId), parsed.media);
  if (!ad) {
    return NextResponse.json({ error: "ad not found" }, { status: 404, headers: NO_CACHE });
  }
  return NextResponse.json({ ad }, { status: 200, headers: NO_CACHE });
}

/** DELETE /api/admin/ads/[adId]. */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ adId: string }> },
) {
  const { adId } = await params;
  const db = await getAppDb();
  const removed = await db.ads.remove(decodeURIComponent(adId));
  if (!removed) {
    return NextResponse.json({ error: "ad not found" }, { status: 404, headers: NO_CACHE });
  }
  return NextResponse.json({ ok: true, adId }, { status: 200, headers: NO_CACHE });
}
