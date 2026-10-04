/**
 * Broadcast thumbnail: fetch the channel's image source (ControlState.youtube
 * .thumbnailUrl set on /admin/scenes/:id, else the deployment default, else the
 * brand logo served by `public`), normalise it to a YouTube-shaped 1280×720 JPEG
 * with sharp, and upload it with `thumbnails.set` (50 quota units).
 *
 * Queued from goLive the moment the broadcast id exists — its own retried job,
 * so a slow CDN or a YouTube hiccup never touches the go-live path. A channel
 * without phone verification is REFUSED custom thumbnails (403 forbidden); that
 * is recorded on the run (`thumbnail.error`) and not retried, since every retry
 * would fail the same way and cost 50 units.
 */
import sharp from "sharp";
import { getQueue } from "@photonsurge/shared/bull/bull";
import { getAppDb } from "@photonsurge/shared/db/index";
import { runIsFinished, type Run } from "@photonsurge/shared/runs";
import { DEFAULT_THUMBNAIL_PATH, resolveThumbnailUrl } from "@photonsurge/shared/stream-description";
import { log } from "@photonsurge/shared/utill/logger";
import { discardBody, fetchWithTimeout } from "../http";
import { channelYoutubeSettings } from "./channel-youtube";
import { getYoutubeClient, setThumbnail } from "../youtube/client";
import { classifyYoutubeError } from "../youtube/errors";
import { watchBaseUrl } from "./encoders";

const TAG = "stream-thumbnail";

/** YouTube's recommended thumbnail frame; the hard cap is 2 MB. */
export const THUMB_WIDTH = 1280;
export const THUMB_HEIGHT = 720;
export const THUMB_MAX_BYTES = 2 * 1024 * 1024;
/** Letterbox colour behind transparent / non-16:9 sources (the on-air night sky). */
const THUMB_BACKGROUND = { r: 8, g: 12, b: 24, alpha: 1 };
/** Bound on the fetch of the source image. */
const FETCH_TIMEOUT_MS = 20_000;
/** Refuse absurd sources before decoding them (sharp would otherwise happily try). */
const MAX_SOURCE_BYTES = 25 * 1024 * 1024;

/** Kill switch for the automatic upload (YOUTUBE_THUMBNAILS=off). */
export function thumbnailsEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return (env.YOUTUBE_THUMBNAILS ?? "on").trim().toLowerCase() !== "off";
}

/**
 * Which image a video's thumbnail comes from: the channel's source, else the
 * deployment default (YOUTUBE_THUMBNAIL_URL), else the brand logo. Returns the
 * absolute URL plus a short label recorded on the run.
 */
export function thumbnailSourceFor(
  channelSource: string | undefined | null,
  env: Record<string, string | undefined> = process.env,
  siteUrl: string = watchBaseUrl(),
): { url: string; source: string } {
  const own = (channelSource ?? "").trim();
  if (own) return { url: resolveThumbnailUrl(own, siteUrl), source: own };
  const dflt = (env.YOUTUBE_THUMBNAIL_URL ?? "").trim();
  if (dflt) return { url: resolveThumbnailUrl(dflt, siteUrl), source: dflt };
  return { url: resolveThumbnailUrl(DEFAULT_THUMBNAIL_PATH, siteUrl), source: "default" };
}

/**
 * Any decodable image → 1280×720 JPEG under 2 MB. The source is fitted INSIDE the
 * frame (never cropped) over the dark background, so a transparent logo or a
 * portrait photo comes out as a proper letterboxed thumbnail.
 */
export async function normalizeThumbnail(input: Buffer): Promise<Buffer> {
  let quality = 88;
  for (;;) {
    const out = await sharp(input, { limitInputPixels: 64e6 })
      .rotate() // honour EXIF orientation
      .resize(THUMB_WIDTH, THUMB_HEIGHT, { fit: "contain", background: THUMB_BACKGROUND })
      .flatten({ background: THUMB_BACKGROUND })
      .jpeg({ quality, mozjpeg: true })
      .toBuffer();
    if (out.length <= THUMB_MAX_BYTES || quality <= 40) return out;
    quality -= 12;
  }
}

async function fetchImage(url: string): Promise<Buffer> {
  const res = await fetchWithTimeout(url, { timeoutMs: FETCH_TIMEOUT_MS, headers: { accept: "image/*" } });
  if (!res.ok) {
    discardBody(res);
    throw new Error(`thumbnail source ${url} answered HTTP ${res.status}`);
  }
  const declared = Number(res.headers.get("content-length") ?? 0);
  if (declared > MAX_SOURCE_BYTES) {
    discardBody(res);
    throw new Error(`thumbnail source ${url} is ${declared} bytes (limit ${MAX_SOURCE_BYTES})`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_SOURCE_BYTES) throw new Error(`thumbnail source ${url} exceeds ${MAX_SOURCE_BYTES} bytes`);
  if (!buf.length) throw new Error(`thumbnail source ${url} is empty`);
  return buf;
}

export async function queueThumbnail(runId: string): Promise<void> {
  await getQueue("foreground").add(
    "do",
    { domain: "stream", type: "run-lifecycle", event: "thumbnail", data: { runId } },
    {
      attempts: 4,
      backoff: { type: "exponential", delay: 30_000 },
      removeOnComplete: true,
      removeOnFail: true,
    },
  );
}

export interface ThumbnailResult {
  ok: boolean;
  /** Why nothing was uploaded, when that's fine (no video, run over, already set). */
  skipped?: string;
  source?: string;
  bytes?: number;
  error?: string;
}

/** Google's answer when the channel may not use custom thumbnails — retrying can't help. */
export class ThumbnailRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ThumbnailRefusedError";
  }
}

/**
 * Upload (or, with `force`, re-upload) the thumbnail for a run's video. Resolves
 * with a structured skip when there's nothing to do; THROWS on a transient
 * failure so the BullMQ attempts drive the retry. A refusal (unverified channel,
 * bad image) is recorded on the run and returned, not thrown.
 */
export async function publishThumbnail(runId: string, opts: { force?: boolean } = {}): Promise<ThumbnailResult> {
  const db = await getAppDb();
  const run = await db.getRun(runId);
  if (!run) return { ok: false, error: "no such run" };
  const yt = run.platforms?.youtube;
  if (!yt?.broadcastId) return { ok: false, skipped: "run has no YouTube video" };
  if (runIsFinished(run.status) && !opts.force) return { ok: false, skipped: `run is ${run.status}` };
  if (run.thumbnail?.setAt && !opts.force) return { ok: true, skipped: "already set", source: run.thumbnail.source };

  // A video render takes its FORMAT's thumbnail (§6.8), resolved by the render
  // queue onto `run.script`: an image (`thumbnailUrl`, a URL or site path with
  // templates filled; "" = the deployment default), or a frame of the render
  // (`thumbnailFrameAtMs`) — taken from OBS during the play by
  // script-shots.ts and uploaded through `uploadThumbnailImage` below.
  // Neither means no custom thumbnail: YouTube's own auto-thumbnail stays.
  if (run.script?.scriptId && run.script.thumbnailUrl === undefined) {
    return run.script.thumbnailFrameAtMs != null
      ? { ok: false, skipped: "a frame thumbnail is taken from OBS during the render" }
      : { ok: false, skipped: "this video has no custom thumbnail" };
  }
  const { url, source } = thumbnailSourceFor(
    run.script?.scriptId ? run.script.thumbnailUrl : (await channelYoutubeSettings(run.sceneId)).thumbnailUrl,
  );
  const record = async (patch: Partial<NonNullable<Run["thumbnail"]>>) =>
    db
      .updateRun(runId, {
        thumbnail: { setAt: run.thumbnail?.setAt ?? null, source, error: null, ...patch },
      })
      .catch(() => {});

  let image: Buffer;
  try {
    image = await normalizeThumbnail(await fetchImage(url));
  } catch (err) {
    // A source that can't be fetched/decoded is worth retrying once or twice
    // (CDN blip), but the message is recorded either way for /admin/streams/:id.
    const message = String((err as Error)?.message ?? err);
    await record({ error: message.slice(0, 300) });
    log(TAG, `run ${runId}: thumbnail source failed (${source})`, message);
    throw err;
  }

  return uploadThumbnailImage(run, image, source);
}

/**
 * Upload an already-normalised 1280×720 JPEG as the run's video thumbnail and
 * record the outcome on the run. Shared by the image path above and a video
 * render's frame thumbnail (script-shots.ts). THROWS on a transient failure
 * (BullMQ retries); a refusal (unverified channel, rejected image) is recorded
 * and returned, never retried.
 */
export async function uploadThumbnailImage(run: Run, image: Buffer, source: string): Promise<ThumbnailResult> {
  const db = await getAppDb();
  const runId = run.id;
  const yt = run.platforms?.youtube;
  if (!yt?.broadcastId) return { ok: false, skipped: "run has no YouTube video" };
  const record = async (patch: Partial<NonNullable<Run["thumbnail"]>>) =>
    db
      .updateRun(runId, {
        thumbnail: { setAt: run.thumbnail?.setAt ?? null, source, error: null, ...patch },
      })
      .catch(() => {});
  try {
    const ctx = await getYoutubeClient(yt.accountId);
    await setThumbnail(ctx, yt.broadcastId, { body: image, mimeType: "image/jpeg" });
  } catch (err) {
    const message = String((err as Error)?.message ?? err);
    const info = classifyYoutubeError(err);
    await record({ error: message.slice(0, 300) });
    // 403 that is NOT the quota/rate limit = the channel may not set custom
    // thumbnails (no phone verification); 400 = YouTube rejected the image.
    // Neither changes on retry.
    const refused = (info.status === 403 && info.kind !== "quota" && info.kind !== "rate") || info.status === 400;
    if (refused) {
      log(TAG, `run ${runId}: YouTube refused the thumbnail — is the channel phone-verified? ${message}`);
      return { ok: false, error: message, source };
    }
    log(TAG, `run ${runId}: thumbnail upload failed`, message);
    throw err;
  }

  await record({ setAt: Date.now(), error: null });
  log(TAG, `run ${runId}: thumbnail set on ${yt.broadcastId} from ${source} (${image.length} bytes)`);
  return { ok: true, source, bytes: image.length };
}
