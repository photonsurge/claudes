import { withApiLog } from "../../../../lib/api-log";
import { NextResponse } from "next/server";
import { getAppDb } from "@photonsurge/shared/db/index";
import { normaliseAdMeta } from "@photonsurge/shared/ads/normalise";
import type { AdStatus } from "@photonsurge/shared/ads/types";
import { parseAdMedia } from "../../../../lib/ads/upload";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_CACHE = { "Cache-Control": "no-store" };
const STATUSES: AdStatus[] = ["active", "inactive"];

/**
 * GET /api/admin/ads?status=active&q=coffee&limit=0
 * Lists the admin-managed ad catalog from Mongo (metadata only, no bytes).
 * No limit by default (show all).
 */
async function GET__impl(req: Request) {
  const url = new URL(req.url);

  const statusRaw = url.searchParams.get("status");
  const status = STATUSES.includes(statusRaw as AdStatus)
    ? (statusRaw as AdStatus)
    : undefined;
  const q = url.searchParams.get("q")?.trim() || undefined;
  const limitRaw = Number(url.searchParams.get("limit"));
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : undefined;

  try {
    const db = await getAppDb();
    const ads = await db.ads.list({ status, q, limit });
    return NextResponse.json({ count: ads.length, ads }, { status: 200, headers: NO_CACHE });
  } catch (err) {
    return NextResponse.json(
      { error: String(err), ads: [], count: 0 },
      { status: 502, headers: NO_CACHE },
    );
  }
}

/**
 * POST /api/admin/ads — create one ad from a multipart upload (`file` + metadata
 * fields). The file is validated (type/size) and stored inline in Mongo; the
 * metadata is validated by `normaliseAdMeta` (title required). Generates the id.
 */
async function POST__impl(req: Request) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json(
      { error: "expected multipart/form-data" },
      { status: 400, headers: NO_CACHE },
    );
  }

  const meta = normaliseAdMeta(Object.fromEntries(form.entries()) as Record<string, unknown>);
  if (!meta) {
    return NextResponse.json({ error: "an ad needs a title" }, { status: 400, headers: NO_CACHE });
  }

  const parsed = await parseAdMedia(form);
  if ("response" in parsed) return parsed.response;

  try {
    const db = await getAppDb();
    const ad = await db.ads.create({ ...meta, ...parsed.media });
    return NextResponse.json({ ad }, { status: 200, headers: NO_CACHE });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 502, headers: NO_CACHE });
  }
}

// --- request logging (lib/api-log) ---
export const GET = withApiLog(GET__impl);
export const POST = withApiLog(POST__impl);
