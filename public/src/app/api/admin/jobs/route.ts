import { NextResponse } from "next/server";
import { TRIGGERABLE_JOBS, getTriggerableJob } from "@photonsurge/shared/jobs";
import { sendToQueue, QUEUE_PRIORITY } from "@photonsurge/shared/bull/bull-queue";
import { getQueue } from "@photonsurge/shared/bull/bull";
import { PublicBackLogger } from "@photonsurge/shared/utill/BackLogger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_CACHE = { "Cache-Control": "no-store" };

/** GET /api/admin/jobs — the triggerable jobs + current queue counts. */
export async function GET() {
  let counts: Record<string, number> | null = null;
  try {
    counts = await getQueue().getJobCounts(
      "waiting",
      "active",
      "delayed",
      "completed",
      "failed",
    );
  } catch {
    /* Redis down — still return the job list so the UI renders */
  }
  return NextResponse.json({ jobs: TRIGGERABLE_JOBS, counts }, { status: 200, headers: NO_CACHE });
}

/** POST /api/admin/jobs { id } — enqueue a worker job by its registry id. */
export async function POST(req: Request) {
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
    // The all-city job chains its own bounded continuations. Reuse an existing
    // active/waiting chain so an impatient double-click cannot start two sets of
    // Wikipedia requests in parallel.
    if (job.id === "cities-enrich-all") {
      const queue = getQueue();
      const existing = (await queue.getJobs(["active", "waiting", "delayed", "prioritized"], 0, 100))
        .find((candidate) => candidate.data?.type === "cities" && candidate.data?.event === "enrichWikiAll");
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
