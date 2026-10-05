/**
 * BullMQ entry points for streaming-run lifecycle. Thin on purpose — the real
 * orchestration lives in ../stream/lifecycle.ts + ../stream/slots.ts (kept out
 * of jobs/ so only these functions register as handlers). Dispatched as:
 *   run-lifecycle.goLive    { runId }
 *   run-lifecycle.stop      { runId }           (operator stop)
 *   run-lifecycle.end       { runId, reason }   (auto-end delayed job, or a stop alias)
 *   run-lifecycle.reconcile {}                  (repeatable persistent-slot sweep)
 *   run-lifecycle.announce  { runId }           ("notify the world" hydra post, retried)
 *   run-lifecycle.chapters  { runId, force? }   (as-run chapters → video description; retried,
 *                                                or awaited + never-rejecting when force)
 *   run-lifecycle.thumbnail { runId, force? }   (custom thumbnail onto the video; retried, or
 *                                                awaited + never-rejecting when force)
 *   run-lifecycle.scriptStart { runId }         (video render: start the script after the lead-in)
 *   run-lifecycle.finalize  { runId }           (video render: tags/category/privacy/playlist, then chapters)
 *   run-lifecycle.renders   {}                  (repeatable render-queue ticker)
 *   run-lifecycle.renderQueue { request }       (queue a video)
 *   run-lifecycle.renderControl { action, renderId | encoderId } (pause/resume/cancel/retry/stop)
 *   run-lifecycle.renderPreflight { request }   (offline-test preflight report; read-only, awaited)
 *   run-lifecycle.scriptShot { runId, playNonce, clipIndex, clipId } (OBS screenshot at a clip's midpoint)
 *   run-lifecycle.scriptFrame { runId, playNonce } (a live render's frame thumbnail from OBS)
 * Routed to the FOREGROUND tier (see bull-utils FOREGROUND_TYPES) so go-live/stop
 * never wait behind a bake.
 */
import type { Job } from "bullmq";
import { announceRun } from "../stream/announce";
import { publishChapters } from "../stream/chapters";
import { publishThumbnail } from "../stream/thumbnail";
import { goLive as doGoLive, finishRun } from "../stream/lifecycle";
import { reconcileSlots } from "../stream/slots";
import { borrowingRun, endpointForEncoderId, provisionEncoderScene, refreshEncoderScene } from "../stream/encoders";
import { probe } from "../obs/client";
import { finalizeScriptRun, startScriptPlay } from "../stream/script-run";
import { advanceRenderQueues, controlRender, queueRender } from "../stream/render-queue";
import { sanitizeRenderRequest } from "@photonsurge/shared/short-render";
import { preflightRender } from "../stream/render-preflight";
import { captureFrameThumbnail, captureScriptShot } from "../stream/script-shots";

export async function goLive(job: Job) {
  const runId = String(job.data?.data?.runId ?? job.data?.runId ?? "");
  if (!runId) throw new Error("run-lifecycle.goLive: missing runId");
  await doGoLive(runId);
  return { runId };
}

export async function stop(job: Job) {
  const runId = String(job.data?.data?.runId ?? job.data?.runId ?? "");
  if (!runId) throw new Error("run-lifecycle.stop: missing runId");
  await finishRun(runId, "manual");
  return { runId };
}

export async function end(job: Job) {
  const runId = String(job.data?.data?.runId ?? job.data?.runId ?? "");
  if (!runId) throw new Error("run-lifecycle.end: missing runId");
  const reason = job.data?.data?.reason === "manual" ? "manual" : "auto";
  await finishRun(runId, reason);
  return { runId, reason };
}

/** "Notify the world" hydra blog+social post for a live run. Throws so BullMQ retries. */
export async function announce(job: Job) {
  const runId = String(job.data?.data?.runId ?? job.data?.runId ?? "");
  if (!runId) throw new Error("run-lifecycle.announce: missing runId");
  await announceRun(runId);
  return { runId };
}

/**
 * As-run chapters into the YouTube video description (docs/vod-as-run-plan.md §4).
 * Queued from finishRun (throws → BullMQ retries); the admin "Publish chapters"
 * button awaits it with `force`, which also re-publishes an already-published
 * video and resolves (never rejects) with a structured result for the UI.
 */
export async function chapters(job: Job) {
  const runId = String(job.data?.data?.runId ?? job.data?.runId ?? "");
  if (!runId) throw new Error("run-lifecycle.chapters: missing runId");
  const force = !!job.data?.data?.force;
  try {
    return await publishChapters(runId, { force });
  } catch (err) {
    if (force) return { ok: false, error: String((err as Error)?.message ?? err) };
    throw err;
  }
}

/**
 * Custom thumbnail onto the run's YouTube video. Queued from goLive as soon as
 * the broadcast exists (throws → BullMQ retries; a refusal — unverified channel,
 * rejected image — is recorded on the run and NOT retried). The admin "Set
 * thumbnail" button awaits it with `force`, which also re-uploads and resolves
 * (never rejects) with a structured result for the UI.
 */
export async function thumbnail(job: Job) {
  const runId = String(job.data?.data?.runId ?? job.data?.runId ?? "");
  if (!runId) throw new Error("run-lifecycle.thumbnail: missing runId");
  const force = !!job.data?.data?.force;
  try {
    return await publishThumbnail(runId, { force });
  } catch (err) {
    if (force) return { ok: false, error: String((err as Error)?.message ?? err) };
    throw err;
  }
}

// ---- Video renders (docs/short-video-plan.md §6.5-6.7) ----

/** A video render's script start, delayed by its lead-in (queued by onScriptRunLive). */
export async function scriptStart(job: Job) {
  const runId = String(job.data?.data?.runId ?? job.data?.runId ?? "");
  if (!runId) throw new Error("run-lifecycle.scriptStart: missing runId");
  return { runId, ...(await startScriptPlay(runId)) };
}

/** A finished video's ONE ordered end write: tags, category, privacy, playlist — then chapters. Retried. */
export async function finalize(job: Job) {
  const runId = String(job.data?.data?.runId ?? job.data?.runId ?? "");
  if (!runId) throw new Error("run-lifecycle.finalize: missing runId");
  return { runId, ...(await finalizeScriptRun(runId)) };
}

/** The render queue's 60 s ticker (index.ts): settle, expire, start the next videos. */
export async function renders(_job: Job) {
  return advanceRenderQueues();
}

/**
 * Queue one video (Render now, a schedule's batch). Body: a ShortRenderRequest
 * (sanitised here). Resolves with the stored render, or `{ ok: false, error }`.
 */
export async function renderQueue(job: Job) {
  const req = sanitizeRenderRequest(job.data?.data?.request ?? job.data?.data);
  if (!req) return { ok: false, error: "not a render request" };
  const render = await queueRender(req);
  return { ok: true, render };
}

/** Pause / resume an encoder's queue; cancel, retry or stop a render. Never rejects. */
export async function renderControl(job: Job) {
  const d = job.data?.data ?? {};
  const action = String(d.action ?? "");
  try {
    if (action === "pause" || action === "resume") {
      if (!d.encoderId) return { ok: false, error: "encoderId is required" };
      return await controlRender({ action, encoderId: String(d.encoderId) });
    }
    if (action === "cancel" || action === "retry" || action === "stop") {
      if (!d.renderId) return { ok: false, error: "renderId is required" };
      return await controlRender({ action, renderId: String(d.renderId) });
    }
    return { ok: false, error: `unknown action "${action}"` };
  } catch (err) {
    return { ok: false, error: String((err as Error)?.message ?? err) };
  }
}

/**
 * The offline test's preflight report (§7.1) for a ShortRenderRequest: clips
 * resolved and skipped, length against the budget, the encoder probed, the
 * YouTube account's recorded state. No side effects. Never rejects.
 */
export async function renderPreflight(job: Job) {
  const req = sanitizeRenderRequest(job.data?.data?.request ?? job.data?.data);
  if (!req) return { ok: false, error: "not a render request" };
  try {
    return { ok: true, report: await preflightRender(req) };
  } catch (err) {
    return { ok: false, error: String((err as Error)?.message ?? err) };
  }
}

/** One evidence screenshot at a clip's midpoint (scheduled by script-shots.ts). */
export async function scriptShot(job: Job) {
  const d = job.data?.data ?? {};
  const runId = String(d.runId ?? "");
  if (!runId) throw new Error("run-lifecycle.scriptShot: missing runId");
  // The last attempt records a failed capture instead of throwing.
  const final = (job.attemptsMade ?? 0) + 1 >= (job.opts?.attempts ?? 1);
  return { runId, ...(await captureScriptShot(runId, Number(d.playNonce), Number(d.clipIndex), String(d.clipId ?? ""), { final })) };
}

/** A live render's frame thumbnail (§6.8): screenshot, normalise, thumbnails.set. Retried. */
export async function scriptFrame(job: Job) {
  const d = job.data?.data ?? {};
  const runId = String(d.runId ?? "");
  if (!runId) throw new Error("run-lifecycle.scriptFrame: missing runId");
  return { runId, ...(await captureFrameThumbnail(runId, Number(d.playNonce))) };
}

/** Repeatable sweep keeping every enabled persistent slot's stream alive. */
export async function reconcile(_job: Job) {
  await reconcileSlots();
  return {};
}

/**
 * Admin diagnostic (POST /api/streams/encoders/:id/test): connect to an encoder's
 * OBS and report reachability + version. Read-only — never starts a stream. Resolves
 * (never rejects) so the caller gets a structured pass/fail with the reason, e.g.
 * "cannot reach OBS at ws://… : connect timeout" or "encoder is disabled".
 */
export async function testEncoder(job: Job) {
  const encoderId = job.data?.data?.encoderId ? String(job.data.data.encoderId) : undefined;
  try {
    const ep = await endpointForEncoderId(encoderId);
    const info = await probe(ep);
    return { reachable: true, url: ep.url, ...info };
  } catch (err) {
    return { reachable: false, error: String((err as Error)?.message ?? err) };
  }
}

/**
 * Admin action (POST /api/streams/encoders/:id/provision): push a full-canvas
 * browser source with the channel's tokened /watch URL into this encoder's OBS and
 * switch to it. Resolves (never rejects) with a structured ok/error for the UI.
 */
/**
 * Refusal for a manual Provision/Refresh while a run shows another channel on
 * the encoder (crossword plan §10): it would swap that run's live picture.
 */
async function borrowedRefusal(encoderId?: string): Promise<string | null> {
  const run = await borrowingRun(encoderId);
  return run
    ? `run ${run.id} is showing channel "${run.sceneId}" on this encoder — ` +
        `it goes back to its own channel when that run ends. Stop the run first.`
    : null;
}

export async function provisionEncoder(job: Job) {
  const encoderId = job.data?.data?.encoderId ? String(job.data.data.encoderId) : undefined;
  try {
    const refused = await borrowedRefusal(encoderId);
    if (refused) return { ok: false, error: refused };
    const res = await provisionEncoderScene(encoderId);
    return { ok: true, ...res };
  } catch (err) {
    return { ok: false, error: String((err as Error)?.message ?? err) };
  }
}

/**
 * Admin action (POST /api/streams/encoders/:id/refresh): no-cache reload of the
 * channel's globe browser source in this encoder's OBS. Resolves (never rejects).
 */
export async function refreshEncoder(job: Job) {
  const encoderId = job.data?.data?.encoderId ? String(job.data.data.encoderId) : undefined;
  try {
    const refused = await borrowedRefusal(encoderId);
    if (refused) return { ok: false, error: refused };
    const res = await refreshEncoderScene(encoderId);
    return { ok: true, ...res };
  } catch (err) {
    return { ok: false, error: String((err as Error)?.message ?? err) };
  }
}
