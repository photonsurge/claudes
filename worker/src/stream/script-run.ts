/**
 * The hooks that carry a video render through its run (docs/short-video-plan.md
 * §6.5). No job sits waiting for the video to finish: each step is a small hook
 * fired by the run pipeline, with the state in Mongo (`Run.script`), so a worker
 * restart can't strand a render.
 *
 *  1. Start — the render queue creates the Run (render-queue.ts) and goLive runs.
 *  2. On live — `transitionToLive` (and goLive's no-YouTube branch) call
 *     `onScriptRunLive`, which queues `run-lifecycle.scriptStart` after the
 *     lead-in; `startScriptPlay` then sets the scene's director to the script
 *     (`record: true`) and stores the nonce on the run.
 *  3. On script end — the runner calls `onScriptPlayEnded(sceneId, play)`. A
 *     finished play ends the run after the lead-out; a stopped one fails it.
 *  4. Deadline — the monitor tick fails a render still awaiting ingest after
 *     RENDER_GOLIVE_DEADLINE_MS (`scriptGoLiveOverdue`).
 *  5. Restart — `rearmLiveRuns` asks `rearmScriptRun` about each live render.
 *  6. Over — `finishRun` and `failRun` call `onScriptRunOver`: stop the play,
 *     restore the encoder, delete a broadcast that never aired, queue the
 *     ONE ordered finalize step (tags, category, privacy, playlist — then
 *     chapters) for a finished video, and hand the outcome to the queue.
 */
import { getQueue } from "@photonsurge/shared/bull/bull";
import { getAppDb } from "@photonsurge/shared/db/index";
import { encoderKeyForRun, isScriptRun, runIsActive, runIsFinished, type Run, type RunScript } from "@photonsurge/shared/runs";
import { playFor, type ShortScriptPlay } from "@photonsurge/shared/short-script";
import { log } from "@photonsurge/shared/utill/logger";
import { endRunAfter, finishRun } from "./lifecycle";
import { restoreEncoderScene } from "./encoders";
import { chaptersEnabled, queueChapters } from "./chapters";
import { addToPlaylist, deleteBroadcast, getYoutubeClient, updateVideoMeta } from "../youtube/client";
import { renderRunLive, renderRunSettled } from "./render-queue";

const TAG = "script-run";

/** Format timing defaults (§6.3): script starts 3 s after live, run ends 5 s after it. */
export const DEFAULT_LEAD_IN_MS = 3_000;
export const DEFAULT_LEAD_OUT_MS = 5_000;

const envNum = (name: string, dflt: number): number => {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : dflt;
};

/** Deployment setting (§6.9): how long a render may take to go live. */
export const scriptGoLiveDeadlineMs = (): number => envNum("RENDER_GOLIVE_DEADLINE_MS", 120_000);

const scriptStartJobId = (runId: string) => `script-start-${runId}`;
const finalizeJobId = (runId: string) => `script-finalize-${runId}`;

const errMsg = (err: unknown) => String((err as Error)?.message ?? err);

async function patchScript(runId: string, base: RunScript, patch: Partial<RunScript>): Promise<void> {
  await (await getAppDb()).updateRun(runId, { script: { ...base, ...patch } });
}

// ---- 4. deadline ----

/** A render still not live past its deadline (counted from goLive's first attempt). */
export function scriptGoLiveOverdue(run: Run, now: number): boolean {
  if (!isScriptRun(run)) return false;
  if (run.status !== "awaiting-ingest" && run.status !== "scheduled") return false;
  const since = run.script?.goLiveAt;
  return !!since && now - since > scriptGoLiveDeadlineMs();
}

// ---- 2. on live ----

async function queueScriptStart(runId: string, delayMs: number): Promise<void> {
  await getQueue("foreground").add(
    "do",
    { domain: "stream", type: "run-lifecycle", event: "scriptStart", data: { runId } },
    {
      delay: Math.max(0, delayMs),
      jobId: scriptStartJobId(runId),
      attempts: 3,
      backoff: { type: "fixed", delay: 2_000 },
      removeOnComplete: true,
      removeOnFail: true,
    },
  );
}

/**
 * The render is live: mark it live on the queue and start the script after the
 * lead-in. A durable delayed job, not a timer, so a restart inside the lead-in
 * still starts it.
 */
export async function onScriptRunLive(run: Run): Promise<void> {
  if (!isScriptRun(run)) return;
  await renderRunLive(run).catch((err) => log(TAG, `render live mark failed ${run.id}`, errMsg(err)));
  if (run.script!.playNonce) return;
  await queueScriptStart(run.id, run.script!.leadInMs ?? DEFAULT_LEAD_IN_MS);
  log(TAG, `run ${run.id}: live — script ${run.script!.scriptId} starts in ${run.script!.leadInMs ?? DEFAULT_LEAD_IN_MS} ms`);
}

/**
 * The `scriptStart` job: play the script on the run's scene, recorded, and
 * store the nonce on the run FIRST so the runner's end hook can find it.
 * Idempotent — a run that already has a nonce is left alone.
 */
export async function startScriptPlay(runId: string): Promise<{ started: boolean; skipped?: string; playNonce?: number }> {
  const db = await getAppDb();
  const run = await db.getRun(runId);
  if (!run || !isScriptRun(run)) return { started: false, skipped: "not a video render" };
  if (run.status !== "live") return { started: false, skipped: `run is ${run.status}` };
  if (run.script!.playNonce) return { started: false, skipped: "already started" };
  const cfg = await db.getOrInitDirectorConfig(run.sceneId);
  // Never one the runner already answered (its restart guard), as the preview does.
  const playNonce = Math.max((cfg.script?.playNonce ?? 0) + 1, Date.now());
  await patchScript(run.id, run.script!, { playNonce });
  await db.saveDirectorConfig(run.sceneId, {
    mode: "script",
    script: { scriptId: run.script!.scriptId, fromClip: 0, playNonce, record: true },
  });
  log(TAG, `run ${run.id}: playing script ${run.script!.scriptId} on ${run.sceneId} (nonce ${playNonce})`);
  return { started: true, playNonce };
}

// ---- 3. on script end ----

/**
 * The runner's end-of-play hook. Finds the live render playing this nonce on
 * this scene (a preview play matches none). A finished play ends the run after
 * the lead-out; a stopped play, or one with nothing to play, fails it.
 */
export async function onScriptPlayEnded(sceneId: string, play: ShortScriptPlay): Promise<void> {
  const db = await getAppDb();
  const runs = await db.listRuns({ sceneId, status: ["live"] });
  const run = runs.find((r) => isScriptRun(r) && r.script!.playNonce === play.playNonce);
  if (!run) return;
  if (play.stopped || !play.clips.length) {
    const message = play.clips.length
      ? "the script's play was stopped before its end"
      : `nothing to play${play.skipped.length ? `: ${play.skipped.map((s) => s.reason).join("; ")}` : ""}`;
    log(TAG, `run ${run.id}: ${message} — failing the video`);
    await patchScript(run.id, run.script!, { playEnded: "stopped" });
    await finishRun(run.id, "auto", { fail: { step: "script", message } });
    return;
  }
  await patchScript(run.id, run.script!, { playEnded: "finished" });
  const leadOut = run.script!.leadOutMs ?? DEFAULT_LEAD_OUT_MS;
  await endRunAfter(run.id, leadOut);
  log(TAG, `run ${run.id}: script finished — ending in ${leadOut} ms`);
}

// ---- 6. over (finished, stopped or failed) ----

/** Hand the scene back if it is still playing THIS render's script. */
async function stopPlayIfOurs(run: Run): Promise<void> {
  const nonce = run.script?.playNonce;
  if (!nonce) return;
  try {
    const db = await getAppDb();
    const cfg = await db.getOrInitDirectorConfig(run.sceneId);
    if (cfg.mode === "script" && cfg.script?.playNonce === nonce) {
      await db.saveDirectorConfig(run.sceneId, { mode: "off" });
      log(TAG, `run ${run.id}: stopped its play on ${run.sceneId}`);
    }
  } catch (err) {
    log(TAG, `run ${run.id}: play stop failed`, errMsg(err));
  }
}

/**
 * Point the encoder back at what it shows between videos: its own channel
 * (channel encoder) or a blank page (video encoder). Skipped while another
 * run holds the encoder — a render refused by the busy guard must not touch
 * the run it was refused for.
 */
async function restoreEncoder(run: Run): Promise<void> {
  try {
    const db = await getAppDb();
    const other = await db.activeRunForEncoder(encoderKeyForRun(run), run.id);
    if (other) return;
    const res = await restoreEncoderScene(run.encoderId);
    log(TAG, `run ${run.id}: encoder ${encoderKeyForRun(run)} ${res.idle ? "idle (blank page)" : `back on ${res.url}`}`);
  } catch (err) {
    log(TAG, `run ${run.id}: encoder restore skipped`, errMsg(err));
  }
}

/** Delete the broadcast of a render that never aired, so no phantom "upcoming" event stays. */
async function deleteNeverLiveBroadcast(run: Run): Promise<void> {
  const yt = run.platforms?.youtube;
  if (!yt?.broadcastId || run.startAt) return;
  try {
    const ctx = await getYoutubeClient(yt.accountId);
    await deleteBroadcast(ctx, yt.broadcastId);
    log(TAG, `run ${run.id}: deleted never-live broadcast ${yt.broadcastId}`);
  } catch (err) {
    log(TAG, `run ${run.id}: broadcast delete failed`, errMsg(err));
  }
}

/**
 * The run has reached a terminal status. Clean up whatever the outcome; for a
 * finished video queue the finalize step; then tell the queue.
 */
export async function onScriptRunOver(run: Run): Promise<void> {
  if (!isScriptRun(run) || !runIsFinished(run.status)) return;
  await stopPlayIfOurs(run);
  await restoreEncoder(run);
  await deleteNeverLiveBroadcast(run);
  const finished = run.status === "ended" && run.script!.playEnded === "finished";
  if (finished && run.platforms?.youtube?.broadcastId && !run.script!.offline) {
    await queueFinalize(run.id).catch((err) => log(TAG, `finalize enqueue failed ${run.id}`, errMsg(err)));
  }
  await renderRunSettled(run).catch((err) => log(TAG, `render settle failed ${run.id}`, errMsg(err)));
}

// ---- finalize: tags, category, privacy, playlist — then chapters ----

export async function queueFinalize(runId: string): Promise<void> {
  await getQueue("foreground").add(
    "do",
    { domain: "stream", type: "run-lifecycle", event: "finalize", data: { runId } },
    {
      jobId: finalizeJobId(runId),
      attempts: 5,
      backoff: { type: "exponential", delay: 30_000 },
      removeOnComplete: true,
      removeOnFail: true,
    },
  );
}

export interface FinalizeResult {
  ok: boolean;
  skipped?: string;
  changed?: boolean;
  playlist?: boolean;
  chapters?: boolean;
}

/**
 * The ONE ordered end-of-video write (§6.3, §13): tags, category and the final
 * privacy in one videos.update, then the playlist add, and only then the
 * chapters job — so the two snippet read-modify-writes (this and chapters)
 * can never race. Idempotent: the playlist add is stamped on its own, and a
 * finalized run is skipped. Throws on a YouTube failure so BullMQ retries.
 */
export async function finalizeScriptRun(runId: string): Promise<FinalizeResult> {
  const db = await getAppDb();
  const run = await db.getRun(runId);
  if (!run || !isScriptRun(run)) return { ok: false, skipped: "not a video render" };
  const yt = run.platforms?.youtube;
  if (!yt?.broadcastId) return { ok: false, skipped: "no YouTube video" };
  const s = run.script!;
  if (s.finalizedAt) return { ok: true, skipped: "already finalized" };
  let changed = false;
  let playlist = false;
  try {
    const ctx = await getYoutubeClient(yt.accountId);
    ({ changed } = await updateVideoMeta(ctx, yt.broadcastId, {
      tags: s.tags,
      categoryId: s.categoryId,
      privacy: s.publishAs,
    }));
    if (s.playlistId && !s.playlistAddedAt) {
      await addToPlaylist(ctx, s.playlistId, yt.broadcastId);
      await patchScript(run.id, s, { playlistAddedAt: Date.now() });
      s.playlistAddedAt = Date.now();
      playlist = true;
    }
  } catch (err) {
    await patchScript(run.id, s, { finalizeError: errMsg(err).slice(0, 300) }).catch(() => {});
    log(TAG, `run ${run.id}: finalize failed`, errMsg(err));
    throw err;
  }
  await patchScript(run.id, s, { finalizedAt: Date.now(), finalizeError: null });
  log(TAG, `run ${run.id}: finalized (${s.publishAs}${s.tags?.length ? `, ${s.tags.length} tags` : ""}${playlist ? ", playlist" : ""})`);
  const chapters = chaptersEnabled() && s.chapters !== false;
  if (chapters) await queueChapters(run.id);
  return { ok: true, changed, playlist, chapters };
}

// ---- 5. restart ----

/**
 * Boot: decide what to do with a video render the restart found running.
 * Returns true when it was handled here (ended), false to rearm it as usual.
 *  - live, script started: its play record says whether it finished before the
 *    restart (end the run now) or was cut short (end it and mark it failed);
 *  - live, script not started yet: re-queue the start (same job id, so a still
 *    pending one is not doubled) and rearm normally;
 *  - awaiting ingest: rearm normally — the monitor's deadline covers it.
 */
export async function rearmScriptRun(run: Run, now = Date.now()): Promise<boolean> {
  if (!isScriptRun(run) || !runIsActive(run.status)) return false;
  if (run.status !== "live") return false;
  const s = run.script!;
  if (!s.playNonce) {
    const leadIn = s.leadInMs ?? DEFAULT_LEAD_IN_MS;
    await queueScriptStart(run.id, (run.startAt ?? now) + leadIn - now);
    return false;
  }
  const db = await getAppDb();
  const script = await db.shortScripts.get(s.scriptId).catch(() => null);
  const rec = script ? playFor(script, run.sceneId) : undefined;
  const ours = !!rec && rec.playNonce === s.playNonce;
  if (ours && rec!.endedAt != null && !rec!.stopped && rec!.clips.length) {
    await patchScript(run.id, s, { playEnded: "finished" });
    await finishRun(run.id, "auto");
    return true;
  }
  log(TAG, `run ${run.id}: the restart cut its play short — failing the video`);
  await patchScript(run.id, s, { playEnded: "stopped" });
  await finishRun(run.id, "auto", { fail: { step: "restart", message: "the worker restarted mid-play, so the video is incomplete" } });
  return true;
}
