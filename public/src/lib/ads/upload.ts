import { NextResponse } from "next/server";
import { adMediaTypeFor, MAX_INLINE_AD_BYTES } from "@photonsurge/shared/ads/types";
import type { AdMediaType } from "@photonsurge/shared/ads/types";

const NO_CACHE = { "Cache-Control": "no-store" };

export interface ParsedAdMedia {
  data: Buffer;
  contentType: string;
  mediaType: AdMediaType;
  byteSize: number;
}

/**
 * Read + validate the uploaded media file from a multipart form. Returns either
 * the parsed bytes (`media`) or a ready-to-return error `response` (bad type,
 * missing file, or too large for inline storage). Image dimensions are left
 * undefined for now — the model carries width/height for when we sniff them.
 */
export async function parseAdMedia(
  form: FormData,
  field = "file",
): Promise<{ media: ParsedAdMedia } | { response: NextResponse }> {
  const file = form.get(field);
  if (!(file instanceof File) || file.size === 0) {
    return {
      response: NextResponse.json(
        { error: "a media file is required" },
        { status: 400, headers: NO_CACHE },
      ),
    };
  }

  const mediaType = adMediaTypeFor(file.type || "");
  if (!mediaType) {
    return {
      response: NextResponse.json(
        { error: `unsupported media type "${file.type || "unknown"}" — use png/jpeg/webp/gif or mp4/webm` },
        { status: 415, headers: NO_CACHE },
      ),
    };
  }

  if (file.size > MAX_INLINE_AD_BYTES) {
    const mb = Math.round(MAX_INLINE_AD_BYTES / (1024 * 1024));
    return {
      response: NextResponse.json(
        { error: `file too large (max ${mb} MB inline; large video via GridFS is coming)` },
        { status: 413, headers: NO_CACHE },
      ),
    };
  }

  const data = Buffer.from(await file.arrayBuffer());
  return {
    media: {
      data,
      contentType: (file.type || "application/octet-stream").split(";")[0].trim(),
      mediaType,
      byteSize: data.byteLength,
    },
  };
}
