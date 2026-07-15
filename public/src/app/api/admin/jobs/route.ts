import { withApiLog } from "../../../../lib/api-log";
import { NextResponse } from "next/server";
import { TRIGGERABLE_JOBS, getTriggerableJob } from "@photonsurge/shared/jobs";
import { sendToQueue, QUEUE_PRIORITY } from "@photonsurge/shared/bull/bull-queue";
import { getQueue } from "@photonsurge/shared/bull/bull";
import { PublicBackLogger } from "@photonsurge/shared/utill/BackLogger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_CACHE = { "Cache-Control": "no-store" };

/**
 * GET /api/admin/jobs — the triggerable jobs + current queue counts.
 * GET /api/admin/jobs?jobId=123 — status of one enqueued job, incl. how long it
 * ran (BullMQ stamps processedOn/finishedOn; admin jobs are kept for 1h). The
 * jobs page polls this after "Run now" to show the execution time.
 */
async function GET__impl(req: Request) {
  const jobId = new URL(req.url).searchParams.get("jobId");
  if (jobId) return jobStatus(jobId);

  let counts: Record<string, number> | null = null;
  try {
    // All seven states, not just the four shown in the header: the Clear queue
    // button totals these, and sendToQueue's default priority means most queued
    // work sits in `prioritized` rather than `waiting`.
    counts = await getQueue().getJobCounts(
      "waiting",
      "prioritized",
      "active",
      "delayed",
      "completed",
      "failed",
      "paused",
    );
  } catch {
    /* Redis down — still return the job list so the UI renders */
  }
  return NextResponse.json({ jobs: TRIGGERABLE_JOBS, counts }, { status: 200, headers: NO_CACHE });
}

/** One job's live state + run duration, for the jobs page to poll. */
async function jobStatus(jobId: string) {
  try {
    const job = await getQueue().getJob(jobId);
    if (!job) {
      // Either never existed or completed >1h ago and was reaped. Treat as gone.
      return NextResponse.json({ jobId, state: "unknown" }, { status: 200, headers: NO_CACHE });
    }
    const state = await job.getState();
    const processedOn = job.processedOn ?? null;
    const finishedOn = job.finishedOn ?? null;
    // Wall-clock the handler ran for. Falls back to now for a still-running job.
    const durationMs =
      processedOn != null ? (finishedOn ?? Date.now()) - processedOn : null;
    return NextResponse.json(
      { jobId, state, processedOn, finishedOn, durationMs, failedReason: job.failedReason ?? null },
      { status: 200, headers: NO_CACHE },
    );
  } catch (err) {
    return NextResponse.json({ jobId, state: "unknown", error: String(err) }, { status: 200, headers: NO_CACHE });
  }
}

/** POST /api/admin/jobs { id } — enqueue a worker job by its registry id. */
async function POST__impl(req: Request) {
  let body: { id?: string } = {};
  try {
    body = (await req.json()) ?? {};
  } catch {
    /* empty body → 400 below */
  }

  const job = body.id ? getTriggerableJob(body.id) : undefined;
  if (!job) {
    return NextResponse.json({ error: "unknown job id" }, { status: 400, headers: NO_CACHE });
  }

  try {
    // Stoppable jobs (cities-enrich-all, climate-backfill, …) chain their own
    // bounded continuations. Reuse an existing active/waiting chain so an
    // impatient double-click cannot start two parallel sweeps of the same work.
    if (job.stoppable) {
      const queue = getQueue();
      const existing = (await queue.getJobs(["active", "waiting", "delayed", "prioritized"], 0, 100))
        .find((candidate) => candidate.data?.type === job.type && candidate.data?.event === job.event);
      if (existing) {
        return NextResponse.json(
          { ok: true, id: job.id, jobId: String(existing.id ?? ""), alreadyQueued: true, at: new Date().toISOString() },
          { status: 200, headers: NO_CACHE },
        );
      }
    }
    const enqueued = await sendToQueue(
      job.domain,
      job.type,
      job.event,
      // Spread the job's preset payload (e.g. a city seed tier) over the base
      // trigger marker so several buttons can target one handler with different args.
      { trigger: "admin", ...(job.data ?? {}) },
      undefined,
      job.priority ?? QUEUE_PRIORITY.HIGH,
    );
    await PublicBackLogger(
      "public",
      "event",
      "admin:jobs",
      `triggered ${job.label}`,
      { jobId: String(enqueued?.id ?? ""), event: `${job.type}.${job.event}` },
      job.type,
      job.id,
    );
    return NextResponse.json(
      { ok: true, id: job.id, jobId: String(enqueued?.id ?? ""), at: new Date().toISOString() },
      { status: 200, headers: NO_CACHE },
    );
  } catch (err) {
    return NextResponse.json(
      { ok: false, id: job.id, error: String(err) },
      { status: 502, headers: NO_CACHE },
    );
  }
}

// --- request logging (lib/api-log) ---
export const GET = withApiLog(GET__impl);
export const POST = withApiLog(POST__impl);
