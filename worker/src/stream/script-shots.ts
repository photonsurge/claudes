/**
 * OBS screenshots of a video render (docs/short-video-plan.md §7 "Evidence",
 * §6.8 frame thumbnails).
 *
 *  - Evidence: one screenshot per clip, at the clip's midpoint, taken from OBS
 *    itself (`GetSourceScreenshot` of the render's scene) — what a browser
 *    preview can't prove (missing fonts, software rendering, blur). Taken on
 *    every OFFLINE test, and on live renders too when the deployment sets
 *    RENDER_SHOTS_LIVE=on. Bytes go to the `short-tests` blob namespace, the
 *    record onto `Run.shots`; only the latest test of a script keeps its shots.
 *  - Frame thumbnail: a LIVE render whose format's thumbnail is
 *    `{ source: "frame", atMs }` gets one screenshot `atMs` into the play,
 *    normalised to 1280×720 JPEG and uploaded with `thumbnails.set` through the
 *    same path an image thumbnail takes (thumbnail.ts).
 *
 * Scheduling. The runner tells us when a play has started and its schedule is
 * fixed (`onScriptPlayStarted`, registered at boot): clips resolved, skipped
 * ones dropped, `startedAt` = the first cut. Each capture is then a DELAYED
 * BullMQ job with a deterministic id (`script-shot-<run>-<i>`,
 * `script-frame-<run>`), not a timer: the jobs live in Redis, so a worker
 * restart neither loses nor doubles them. Each job re-checks that the run is
 * still live on the same play nonce before it touches OBS — a restart mid-play
 * fails the render anyway (§6.5 step 5), and its leftover jobs then skip.
 * Scheduling from the play's start, rather than from the script, keeps the
 * shots on what really aired: a skipped clip shifts every later one.
 */
import { getQueue } from "@photonsurge/shared/bull/bull";
import { getAppDb, type AppDb } from "@photonsurge/shared/db/index";
import { RUN_STATE, isScriptRun, toRunState, type Run, type RunShot } from "@photonsurge/shared/runs";
import type { ShortScriptPlay } from "@photonsurge/shared/short-script";
import { log } from "@photonsurge/shared/utill/logger";
import { emitWorkerEvent } from "../socket";
import { screenshotRunScene } from "./encoders";
import { THUMB_WIDTH, normalizeThumbnail, thumbnailsEnabled, uploadThumbnailImage, type ThumbnailResult } from "./thumbnail";

const TAG = "script-shots";

/** Width of an evidence screenshot (the full-size image the Renders row links to). */
export const SHOT_WIDTH = 1280;

/** Deployment setting (§6.9): screenshots on live renders too. Off by default. */
export function liveShotsEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return (env.RENDER_SHOTS_LIVE ?? "off").trim().toLowerCase() === "on";
}

/** Does this render take evidence screenshots? Every offline test does. */
export function shotsWanted(run: Pick<Run, "script">, env: Record<string, string | undefined> = process.env): boolean {
  return !!run.script?.scriptId && (!!run.script.offline || liveShotsEnabled(env));
}

/** The blob key of one screenshot. */
export const shotBlobId = (runId: string, clipIndex: number): string => `${runId}-${clipIndex}.jpg`;

const shotJobId = (runId: string, clipIndex: number) => `script-shot-${runId}-${clipIndex}`;
const frameJobId = (runId: string) => `script-frame-${runId}`;
const errMsg = (err: unknown) => String((err as Error)?.message ?? err);

export interface ShotDue {
  clipIndex: number;
  clipId: string;
  /** Wall-clock ms the screenshot is due: the clip's midpoint. */
  at: number;
}

/** When each clip's screenshot is due: its midpoint on the play's absolute schedule. Pure. */
export function shotSchedule(play: Pick<ShortScriptPlay, "startedAt" | "clips">): ShotDue[] {
  return play.clips.map((c, clipIndex) => ({
    clipIndex,
    clipId: c.id,
    at: play.startedAt + c.startMs + Math.floor(c.durationMs / 2),
  }));
}

/**
 * When a frame thumbnail `atMs` into the play is due. Clamped inside the play
 * (half a second short of its end), so a format's offset longer than this
 * video still lands on a frame of it. Pure.
 */
export function frameDueAt(play: Pick<ShortScriptPlay, "startedAt" | "clips">, atMs: number): number {
  const total = play.clips.reduce((n, c) => n + c.durationMs, 0);
  const last = Math.max(0, total - 500);
  return play.startedAt + Math.min(Math.max(0, Math.round(atMs) || 0), last);
}

async function queueCapture(event: string, data: Record<string, unknown>, delayMs: number, jobId: string, attempts: number) {
  await getQueue("foreground").add(
    "do",
    { domain: "stream", type: "run-lifecycle", event, data },
    {
      delay: Math.max(0, delayMs),
      jobId,
      attempts,
      backoff: { type: "fixed", delay: 1_500 },
      removeOnComplete: true,
      removeOnFail: true,
    },
  );
}

/** The live render playing `play` on `sceneId` (a preview play matches none). */
async function renderForPlay(db: AppDb, sceneId: string, playNonce: number): Promise<Run | null> {
  const runs = await db.listRuns({ sceneId, status: ["live"] });
  return runs.find((r) => isScriptRun(r) && r.script!.playNonce === playNonce) ?? null;
}

/**
 * The runner's play-started hook: schedule this render's screenshots (an
 * offline test, or any render with RENDER_SHOTS_LIVE=on) and its frame
 * thumbnail (a live render whose format asks for one).
 */
export async function onScriptPlayStarted(sceneId: string, play: ShortScriptPlay, now = Date.now()): Promise<void> {
  const db = await getAppDb();
  const run = await renderForPlay(db, sceneId, play.playNonce);
  if (!run) return;
  const s = run.script!;
  if (shotsWanted(run)) {
    const due = shotSchedule(play);
    for (const d of due) {
      await queueCapture(
        "scriptShot",
        { runId: run.id, playNonce: play.playNonce, clipIndex: d.clipIndex, clipId: d.clipId },
        d.at - now,
        shotJobId(run.id, d.clipIndex),
        2,
      );
    }
    log(TAG, `run ${run.id}: ${due.length} screenshot(s) scheduled at the clips' midpoints`);
  }
  if (!s.offline && s.thumbnailFrameAtMs != null && run.platforms?.youtube?.broadcastId && thumbnailsEnabled()) {
    const at = frameDueAt(play, s.thumbnailFrameAtMs);
    await queueCapture("scriptFrame", { runId: run.id, playNonce: play.playNonce }, at - now, frameJobId(run.id), 3);
    log(TAG, `run ${run.id}: frame thumbnail scheduled ${at - play.startedAt} ms into the play`);
  }
}

// ---- evidence ----

// One process: serialise the read-modify-write of a run's shots (and the
// older-test prune) so two captures close together can't drop each other.
const locks = new Map<string, Promise<unknown>>();
function withRunLock<T>(runId: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(runId) ?? Promise.resolve();
  const p = prev.then(fn, fn);
  const tail = p.catch(() => {});
  locks.set(runId, tail);
  void tail.then(() => {
    if (locks.get(runId) === tail) locks.delete(runId);
  });
  return p;
}

/**
 * Latest test only (§7): delete every OTHER run's screenshots of this script —
 * the blobs, then the records. Best-effort per run.
 */
export async function pruneOlderShots(db: AppDb, run: Pick<Run, "id" | "script">): Promise<number> {
  const scriptId = run.script?.scriptId;
  if (!scriptId) return 0;
  const older = await db.runsWithShotsForScript(scriptId, run.id);
  let pruned = 0;
  for (const r of older) {
    try {
      const ids = (r.shots ?? []).map((s) => s.blobId).filter((id): id is string => !!id);
      if (ids.length) await db.blobs.shortTest.delete(ids);
      await db.updateRun(r.id, { shots: null });
      pruned++;
    } catch (err) {
      log(TAG, `run ${run.id}: could not prune the older test ${r.id}`, errMsg(err));
    }
  }
  if (pruned) log(TAG, `run ${run.id}: replaced ${pruned} older test(s) of script ${scriptId}`);
  return pruned;
}

export interface ShotResult {
  ok: boolean;
  skipped?: string;
  shot?: RunShot;
}

/**
 * The `scriptShot` job: screenshot the render's scene now and record it. A
 * capture that fails is recorded with its reason (the evidence says "no image
 * for clip 2: OBS unreachable") rather than thrown — except an unreachable
 * OBS, which gets the job's one retry first.
 */
export async function captureScriptShot(
  runId: string,
  playNonce: number,
  clipIndex: number,
  clipId: string,
  opts: { now?: number; final?: boolean } = {},
): Promise<ShotResult> {
  const db = await getAppDb();
  const run = await db.getRun(runId);
  if (!run || !isScriptRun(run)) return { ok: false, skipped: "not a video render" };
  if (run.status !== "live") return { ok: false, skipped: `run is ${run.status}` };
  if (run.script!.playNonce !== playNonce) return { ok: false, skipped: "another play" };
  if (run.shots?.some((s) => s.clipIndex === clipIndex && s.blobId)) return { ok: true, skipped: "already taken" };

  const shot: RunShot = { clipIndex, clipId, at: opts.now ?? Date.now() };
  try {
    const img = await screenshotRunScene(run, { imageFormat: "jpg", imageWidth: SHOT_WIDTH });
    if (!db.blobFs) {
      shot.error = "not stored: BLOB_DIR is not set";
    } else {
      const blobId = shotBlobId(run.id, clipIndex);
      await db.blobs.shortTest.put(blobId, img.data);
      shot.blobId = blobId;
    }
  } catch (err) {
    if (!opts.final) throw err; // the job's retry
    shot.error = errMsg(err).slice(0, 300);
  }

  const saved = await withRunLock(run.id, async () => {
    const cur = await db.getRun(run.id);
    if (!cur) return null;
    if (!cur.shots?.length) await pruneOlderShots(db, cur);
    const shots = [...(cur.shots ?? []).filter((s) => s.clipIndex !== clipIndex), shot].sort((a, b) => a.clipIndex - b.clipIndex);
    return db.updateRun(run.id, { shots });
  });
  if (saved) emitWorkerEvent({ type: RUN_STATE, data: toRunState(saved) });
  log(TAG, `run ${run.id}: clip ${clipIndex + 1} ${shot.blobId ? `screenshot stored (${shot.blobId})` : `has no screenshot: ${shot.error}`}`);
  return { ok: !!shot.blobId, shot };
}

// ---- frame thumbnail ----

/**
 * The `scriptFrame` job: screenshot the live render now, normalise it to the
 * YouTube thumbnail frame and upload it. Throws on a transient failure (the
 * job retries, a moment later — still a frame of the video).
 */
export async function captureFrameThumbnail(runId: string, playNonce: number): Promise<ThumbnailResult> {
  const db = await getAppDb();
  const run = await db.getRun(runId);
  if (!run || !isScriptRun(run)) return { ok: false, skipped: "not a video render" };
  if (run.status !== "live") return { ok: false, skipped: `run is ${run.status}` };
  if (run.script!.playNonce !== playNonce) return { ok: false, skipped: "another play" };
  if (run.script!.offline || !run.platforms?.youtube?.broadcastId) return { ok: false, skipped: "run has no YouTube video" };
  if (run.thumbnail?.setAt) return { ok: true, skipped: "already set", source: run.thumbnail.source };
  const atMs = run.script!.thumbnailFrameAtMs ?? 0;
  const img = await screenshotRunScene(run, { imageFormat: "png", imageWidth: THUMB_WIDTH });
  const jpeg = await normalizeThumbnail(img.data);
  return uploadThumbnailImage(run, jpeg, `frame at ${(atMs / 1000).toFixed(1)} s`);
}
