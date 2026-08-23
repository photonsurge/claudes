/**
 * BullMQ entry points for streaming-run lifecycle. Thin on purpose — the real
 * orchestration lives in ../stream/lifecycle.ts + ../stream/slots.ts (kept out
 * of jobs/ so only these functions register as handlers). Dispatched as:
 *   run-lifecycle.goLive    { runId }
 *   run-lifecycle.stop      { runId }           (operator stop)
 *   run-lifecycle.end       { runId, reason }   (auto-end delayed job, or a stop alias)
 *   run-lifecycle.reconcile {}                  (repeatable persistent-slot sweep)
 * Routed to the FOREGROUND tier (see bull-utils FOREGROUND_TYPES) so go-live/stop
 * never wait behind a bake.
 */
import type { Job } from "bullmq";
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
