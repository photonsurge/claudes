import type { Job } from "bullmq";
import { getAppDb } from "@photonsurge/shared/db/index";
import { log } from "@photonsurge/shared/utill/logger";
import { emitWorkerEvent } from "../socket";

const TAG = "job:ping";

/**
 * Sample end-to-end feature. Job is dispatched as type "ping", event "create".
 * Flow: public POST /api/ping -> sendToQueue -> THIS handler -> persist ->
 * emitWorkerEvent -> socket server fans out "ping:done" -> browser updates.
 */
export async function create(job: Job) {
  const message: string = job.data?.data?.message ?? "ping";
  log(TAG, `processing`, { jobId: job.id, message });

  const db = await getAppDb();
  const created = await db.pings.create({
    message,
    source: "worker",
    processedAt: new Date().toISOString(),
  });

  const result = { ok: created.success, ping: created.data };

  emitWorkerEvent({
    type: "ping:done",
    jobId: String(job.id ?? ""),
    source: "worker",
    targetType: "ping",
    targetID: created.data?.id,
    data: created.data,
  });

  log(TAG, `done`, { jobId: job.id, id: created.data?.id });
  return result;
}
