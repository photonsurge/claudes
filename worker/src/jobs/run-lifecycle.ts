/**
 * BullMQ entry points for streaming-run lifecycle. Thin on purpose — the real
 * orchestration lives in ../stream/lifecycle.ts (kept out of jobs/ so only these
 * three functions register as handlers). Dispatched as:
 *   run-lifecycle.goLive { runId }
 *   run-lifecycle.stop   { runId }              (operator stop)
 *   run-lifecycle.end    { runId, reason }      (auto-end delayed job, or a stop alias)
 * Routed to the FOREGROUND tier (see bull-utils FOREGROUND_TYPES) so go-live/stop
 * never wait behind a bake.
 */
import type { Job } from "bullmq";
import { goLive as doGoLive, finishRun } from "../stream/lifecycle";

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
