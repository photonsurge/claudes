import { NextResponse } from "next/server";
import { getAppDb } from "@photonsurge/shared/db/index";
import { withApiLog } from "../../../../../lib/api-log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function GET__impl(_req: Request, { params }: { params: Promise<{ mediaId: string }> }) {
  const { mediaId } = await params;
  const asset = await (await getAppDb()).volcanoMedia.getAsset(mediaId);
  if (!asset) return NextResponse.json({ error: "media not found" }, { status: 404 });
  return new NextResponse(new Uint8Array(asset.data), {
    headers: { "Content-Type": asset.contentType, "Cache-Control": "public, max-age=300, immutable" },
  });
}

export const GET = withApiLog(GET__impl);
