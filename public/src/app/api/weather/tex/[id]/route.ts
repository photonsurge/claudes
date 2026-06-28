import { NextResponse } from "next/server";
import { getAppDb } from "@photonsurge/shared/db/index";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Normalise a mongoose .lean() Buffer field to a real Buffer. */
function toBuffer(data: unknown): Buffer {
  if (Buffer.isBuffer(data)) return data;
  if (data instanceof Uint8Array) return Buffer.from(data);
  // `{ type: "Buffer", data: [...] }` (JSON-serialised Buffer).
  if (
    data &&
    typeof data === "object" &&
    "data" in (data as Record<string, unknown>) &&
    Array.isArray((data as { data: unknown }).data)
  ) {
    return Buffer.from((data as { data: number[] }).data);
  }
  return Buffer.alloc(0);
}

/** GET /api/weather/tex/[id] — stream a baked texture's bytes, cached forever. */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const db = await getAppDb();
  const res = await db.weatherTextures.getByID(id);
  const tex = res?.data;
  if (!tex) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const buf = toBuffer(tex.data);
  // Uint8Array view keeps Next/Web happy as a BodyInit.
  const body = new Uint8Array(buf);

  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": tex.contentType || "image/png",
      "Content-Length": String(body.byteLength),
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
