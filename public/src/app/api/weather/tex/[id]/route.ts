import { NextResponse } from "next/server";
import { getAppDb } from "@photonsurge/shared/db/index";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Normalise a mongoose .lean() Buffer field to a real Buffer. */
function toBuffer(data: unknown): Buffer {
  if (!data) return Buffer.alloc(0);
  if (Buffer.isBuffer(data)) return data;
  if (data instanceof Uint8Array) return Buffer.from(data);

  const d = data as Record<string, unknown>;
  // mongoose `.lean()` returns Buffer fields as a BSON Binary object: the bytes
  // live on `.buffer` (and a `.value()` accessor exists on newer bson).
  if (d._bsontype === "Binary") {
    if (Buffer.isBuffer(d.buffer) || d.buffer instanceof Uint8Array) {
      return Buffer.from(d.buffer as Uint8Array);
    }
    if (typeof d.value === "function") {
      return Buffer.from((d.value as () => Uint8Array)());
    }
  }
  // Some bson versions expose a Buffer/Uint8Array directly on `.buffer`.
  if (Buffer.isBuffer(d.buffer) || d.buffer instanceof Uint8Array) {
    return Buffer.from(d.buffer as Uint8Array);
  }
  // `{ type: "Buffer", data: [...] }` (JSON-serialised Buffer).
  if (Array.isArray(d.data)) {
    return Buffer.from(d.data as number[]);
  }
  return Buffer.alloc(0);
}

/** GET /api/weather/tex/[id] — stream a baked texture's bytes, cached forever. */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: rawId } = await params;
  // URLs carry a .png/.tif suffix so the client image loader can select a
  // decoder by extension; the stored id has none.
  const id = rawId.replace(/\.(png|tiff?|webp)$/i, "");
  const db = await getAppDb();
  const res = await db.weatherTextures.getByID(id);
  const tex = res?.data;
  if (!tex) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const buf = toBuffer(tex.data);
  // Uint8Array view keeps Next/Web happy as a BodyInit.
  const body = new Uint8Array(buf);

  // Never serve an empty body with an immutable cache header — that poisons the
  // browser cache (an undecodable image cached for a year). Fail loud + no-store.
  if (body.byteLength === 0) {
    return NextResponse.json(
      { error: "empty texture" },
      { status: 404, headers: { "Cache-Control": "no-store" } },
    );
  }

  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": tex.contentType || "image/png",
      "Content-Length": String(body.byteLength),
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
