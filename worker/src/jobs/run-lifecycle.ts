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
 * Routed to the FOREGROUND tier (see bull-utils FOREGROUND_TYPES) so go-live/stop
 * never wait behind a bake.
 */
import type { Job } from "bullmq";
import { announceRun } from "../stream/announce";
import { publishChapters } from "../stream/chapters";
import { publishThumbnail } from "../stream/thumbnail";
import { goLive as doGoLive, finishRun } from "../stream/lifecycle";
import { reconcileSlots } from "../stream/slots";
import { endpointForEncoderId, provisionEncoderScene, refreshEncoderScene } from "../stream/encoders";
import { probe } from "../obs/client";

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
export async function provisionEncoder(job: Job) {
  const encoderId = job.data?.data?.encoderId ? String(job.data.data.encoderId) : undefined;
  try {
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
    const res = await refreshEncoderScene(encoderId);
    return { ok: true, ...res };
  } catch (err) {
    return { ok: false, error: String((err as Error)?.message ?? err) };
  }
}
