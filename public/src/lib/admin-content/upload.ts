import { NextResponse } from "next/server";
import { adminImageTypeOk, MAX_INLINE_IMAGE_BYTES } from "@photonsurge/shared/admin-content/types";

const NO_CACHE = { "Cache-Control": "no-store" };

export interface ParsedImage {
  data: Buffer;
  contentType: string;
  byteSize: number;
  caption?: string;
  credit?: string;
}

/**
 * Read + validate an uploaded image from a multipart form (`file`, plus optional
 * `caption`/`credit`). Returns either the parsed bytes (`image`) or a
 * ready-to-return error `response` (missing file, bad type, too large for inline
 * storage). Mirrors the ads `parseAdMedia` contract, images-only.
 */
export async function parseUploadedImage(
  form: FormData,
  field = "file",
): Promise<{ image: ParsedImage } | { response: NextResponse }> {
  const file = form.get(field);
  if (!(file instanceof File) || file.size === 0) {
    return {
      response: NextResponse.json(
        { error: "an image file is required" },
        { status: 400, headers: NO_CACHE },
      ),
    };
  }

  if (!adminImageTypeOk(file.type || "")) {
    return {
      response: NextResponse.json(
        { error: `unsupported image type "${file.type || "unknown"}" — use png/jpeg/webp/gif/avif` },
        { status: 415, headers: NO_CACHE },
      ),
    };
  }

  if (file.size > MAX_INLINE_IMAGE_BYTES) {
    const mb = Math.round(MAX_INLINE_IMAGE_BYTES / (1024 * 1024));
    return {
      response: NextResponse.json(
        { error: `image too large (max ${mb} MB)` },
        { status: 413, headers: NO_CACHE },
      ),
    };
  }

  const caption = form.get("caption");
  const credit = form.get("credit");
  const data = Buffer.from(await file.arrayBuffer());
  return {
    image: {
      data,
      contentType: (file.type || "application/octet-stream").split(";")[0].trim(),
      byteSize: data.byteLength,
      caption: typeof caption === "string" && caption.trim() ? caption.trim() : undefined,
      credit: typeof credit === "string" && credit.trim() ? credit.trim() : undefined,
    },
  };
}
