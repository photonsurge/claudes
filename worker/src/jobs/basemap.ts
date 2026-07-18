import type { Job } from "bullmq";
import sharp from "sharp";
import { getAppDb } from "@photonsurge/shared/db/index";
import {
  BASEMAP_TEXTURES,
  getBasemapTexture,
  type BasemapTexture,
} from "@photonsurge/shared/basemaps";
import { log } from "@photonsurge/shared/utill/logger";
import { TRACKS_UPDATED } from "@photonsurge/shared/control";
import { fetchWithTimeout, discardBody } from "../http";
import { summarizeForLog } from "../utils";
import { blogInfo, blogErr } from "../blog";
import { emitWorkerEvent } from "../socket";

const TAG = "job:basemap";

/** Textures are multi-MB; give a slow NASA/GIBS host room (matches fetch-assets.sh -m120). */
const FETCH_TIMEOUT_MS = 120_000;

/** An upstream error/empty body is a few KB of HTML/XML; a real texture is megabytes. */
const MIN_BYTES = 50 * 1024;

/**
 * Assert the downloaded bytes FULLY decode — the guard that would have caught the
 * truncated satellite.jpg (a 2.4 MB partial that sharp rejects with "premature end
 * of JPEG image", and the browser with "InvalidStateError: source image could not
 * be decoded"). `failOn: "warning"` (sharp's most-sensitive level) is what makes a
 * premature-end warning throw — libjpeg reports truncation as a WARNING, so the
 * laxer "error"/"truncated" levels let it slip through. The tiny resize forces a
 * real decode pass (metadata alone only reads the intact header) without
 * materialising the ~100 MB raw buffer of a full 8192×4096 image. Exported for the
 * unit test.
 */
export async function assertDecodable(
  buf: Buffer,
  id: string,
): Promise<{ width: number; height: number }> {
  if (buf.length < MIN_BYTES) {
    throw new Error(
      `${id}: only ${buf.length} bytes — upstream returned an error/empty body, not an image`,
    );
  }
  const img = sharp(buf, { failOn: "warning" });
  const meta = await img.metadata();
  if (!meta.width || !meta.height) {
    throw new Error(`${id}: no image dimensions — not a decodable image`);
  }
  // Throws on a truncated/corrupt stream; the small target keeps memory bounded.
  await img.resize(64, 32, { fit: "fill" }).raw().toBuffer();
  return { width: meta.width, height: meta.height };
}

/** Download + validate + store ONE texture into the shared blob store. */
async function refreshOne(
  db: Awaited<ReturnType<typeof getAppDb>>,
  tex: BasemapTexture,
): Promise<{ id: string; bytes: number; width: number; height: number }> {
  const res = await fetchWithTimeout(tex.url, {
    timeoutMs: FETCH_TIMEOUT_MS,
    headers: tex.headers,
  });
  if (!res.ok) {
    discardBody(res);
    throw new Error(`${tex.id}: upstream ${res.status} ${res.statusText}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  const { width, height } = await assertDecodable(buf, tex.id);
  // Only writes AFTER a clean decode, so a bad download never replaces a good frame.
  await db.basemapTextures.put(tex.id, buf);
  const info = { id: tex.id, bytes: buf.length, width, height };
  log(TAG, "basemap texture refreshed", info);
  return info;
}

/**
 * Dispatched as type "basemap", event "refresh". Downloads the requested full-globe
 * basemap base image(s), validates each decodes, and writes it to the shared
 * ${BLOB_DIR} store, which /api/basemap/[id] serves in place of the read-only /data
 * file. `data.texture` selects one texture id or "all" (default). Each texture is
 * fetched independently — one bad upstream must not sink the rest.
 */
export async function refresh(job: Job) {
  const requested =
    typeof job?.data?.data?.texture === "string" ? job.data.data.texture : "all";

  let targets: BasemapTexture[];
  if (requested === "all") {
    targets = [...BASEMAP_TEXTURES];
  } else {
    const one = getBasemapTexture(requested);
    if (!one) throw new Error(`unknown basemap texture "${requested}"`);
    targets = [one];
  }

  const db = await getAppDb();
  const done: Array<{ id: string; bytes: number; width: number; height: number }> = [];
  const failed: Array<{ id: string; err: unknown }> = [];

  for (const tex of targets) {
    try {
      done.push(await refreshOne(db, tex));
    } catch (err) {
      failed.push({ id: tex.id, err: summarizeForLog(err) });
      log(TAG, "basemap texture failed", { id: tex.id, err: summarizeForLog(err) });
      blogErr(TAG, `basemap texture failed (${tex.id})`, err, "basemap", "refresh");
    }
  }

  if (!done.length) {
    throw new Error(`all basemap textures failed: ${JSON.stringify(failed)}`);
  }

  blogInfo(
    TAG,
    `basemap refresh: ${done.length}/${targets.length} textures`,
    { done, failed },
    "basemap",
    "refresh",
  );
  // Nudge live clients to re-request; served with a short cache so a reload picks it up.
  emitWorkerEvent({ type: TRACKS_UPDATED, data: { kind: "basemap" } });
  return { done, failed };
}
