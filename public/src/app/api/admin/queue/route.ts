import { NextResponse } from "next/server";
import { getQueue } from "@photonsurge/shared/bull/bull";
import { PublicBackLogger } from "@photonsurge/shared/utill/BackLogger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_CACHE = { "Cache-Control": "no-store" };

// The states we surface as tabs, in display order. `prioritized` holds jobs
// added with a priority (sendToQueue uses NORMAL=5), which BullMQ keeps in a
// separate set from plain `waiting`.
const STATES = ["active", "waiting", "prioritized", "delayed", "failed", "completed", "paused"] as const;
type State = (typeof STATES)[number];

// Which `clean()` job-types operators may purge from the dashboard.
const CLEANABLE = new Set(["completed", "failed", "delayed", "paused", "wait", "active"]);

/**
 * Normalise a repeatable/scheduler entry for the UI. The modern Job Scheduler
 * API keeps the human id ("summaries-daily") and a `template` payload we can turn
 * into a `type.event` label; legacy `getRepeatableJobs()` only gives name "do".
 */
function serializeScheduler(s: any) {
  const t = (s?.template?.data ?? {}) as { type?: string; event?: string };
  const label = t.type && t.event ? `${t.type}.${t.event}` : s?.id || s?.name || "repeat";
  return {
    key: String(s?.key ?? s?.id ?? ""),
    id: s?.id ?? null,
    label,
    pattern: s?.pattern ?? null,
    every: s?.every ?? null,
    next: s?.next ?? null,
    tz: s?.tz ?? null,
  };
}

/** Repeatable schedules, preferring the Job Scheduler API for richer labels. */
async function getSchedules(q: any): Promise<any[]> {
  let base: any[] = [];
  try {
    if (typeof q.getJobSchedulers === "function") {
      const list = await q.getJobSchedulers(0, -1, true);
      if (Array.isArray(list)) base = list;
    }
  } catch {
    /* fall through to legacy */
  }
  if (!base.length) {
    try {
      base = await q.getRepeatableJobs();
    } catch {
      return [];
    }
  }

  const schedules = base.map(serializeScheduler);
  // These schedules were registered via the legacy `add({ repeat, jobId })` API,
  // so BullMQ stores them hashed with name "do" and no id/template. The real
  // `type.event` lives on the schedule's next queued job (id `repeat:<key>:<next>`),
  // so peek at that to give each row a meaningful label.
  await Promise.all(
    schedules.map(async (s) => {
      if (s.label !== "do" && s.label !== "repeat") return;
      if (!s.key || !s.next) return;
      try {
        const nextJob = await q.getJob(`repeat:${s.key}:${s.next}`);
        const d = nextJob?.data as { type?: string; event?: string } | undefined;
        if (d?.type && d?.event) s.label = `${d.type}.${d.event}`;
      } catch {
        /* leave the fallback label */
      }
    }),
  );
  return schedules;
}

/** Flatten a BullMQ Job instance into a plain, JSON-safe row for the UI. */
function serializeJob(job: any) {
  const d = (job?.data ?? {}) as { domain?: string; type?: string; event?: string; data?: unknown };
  return {
    id: String(job?.id ?? ""),
    name: job?.name ?? "",
    domain: d.domain ?? null,
    type: d.type ?? null,
    event: d.event ?? null,
    payload: d.data ?? null,
    attemptsMade: job?.attemptsMade ?? 0,
    maxAttempts: job?.opts?.attempts ?? 1,
    timestamp: job?.timestamp ?? null,
    processedOn: job?.processedOn ?? null,
    finishedOn: job?.finishedOn ?? null,
    delay: job?.delay ?? 0,
    progress: typeof job?.progress === "number" ? job.progress : 0,
    priority: job?.priority ?? job?.opts?.priority ?? null,
    failedReason: job?.failedReason ?? null,
    stacktrace: Array.isArray(job?.stacktrace) ? job.stacktrace : [],
    returnvalue: job?.returnvalue ?? null,
    repeatJobKey: job?.repeatJobKey ?? null,
  };
}

/**
 * GET /api/admin/queue?state=&limit= — a BullMQ dashboard snapshot: per-state
 * counts, whether the queue is paused, the repeatable schedules, and the jobs
 * currently in the requested `state` (newest first, up to `limit`).
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const state = (STATES as readonly string[]).includes(url.searchParams.get("state") || "")
    ? (url.searchParams.get("state") as State)
    : "active";
  const limit = Math.min(Math.max(1, Number(url.searchParams.get("limit")) || 100), 1000);

  const q = getQueue();
  try {
    const [counts, paused, repeatables] = await Promise.all([
      q.getJobCounts(...STATES),
      q.isPaused(),
      getSchedules(q),
    ]);
    const raw = await q.getJobs([state as any], 0, limit - 1, false);
    const jobs = raw.filter(Boolean).map((j: any) => serializeJob(j));
    return NextResponse.json(
      { queue: q.name, state, counts, paused, jobs, repeatables, limit },
      { status: 200, headers: NO_CACHE },
    );
  } catch (err) {
    // Redis/worker down — return a shell so the page still renders the error.
    return NextResponse.json(
      { queue: q.name, state, counts: null, paused: false, jobs: [], repeatables: [], error: String(err) },
      { status: 200, headers: NO_CACHE },
    );
  }
}

/**
 * POST /api/admin/queue { action, id?, type? } — mutate the queue.
 *  - retry | remove | promote : act on one job by id
 *  - retryAll                  : re-queue every failed job
 *  - clean { type }            : purge a whole job-type (completed/failed/…)
 *  - pause | resume | drain    : queue-wide controls
 */
export async function POST(req: Request) {
  let body: { action?: string; id?: string; type?: string } = {};
  try {
    body = (await req.json()) ?? {};
  } catch {
    /* empty body → unknown action below */
  }
  const { action, id } = body;
  const q = getQueue();

  try {
    let detail: unknown = null;
    switch (action) {
      case "pause":
        await q.pause();
        break;
      case "resume":
        await q.resume();
        break;
      case "drain":
        // Removes waiting + delayed. Repeatable meta survives, so schedules re-arm.
        await q.drain(true);
        break;
      case "retryAll":
        await q.retryJobs({ state: "failed", count: 1000 });
        break;
      case "clean": {
        const type = body.type && CLEANABLE.has(body.type) ? body.type : "completed";
        // grace = 0 → purge every job of this type regardless of age.
        detail = await q.clean(0, 10_000, type as any);
        break;
      }
      case "retry":
      case "remove":
      case "promote": {
        if (!id) return NextResponse.json({ error: "missing id" }, { status: 400, headers: NO_CACHE });
        const job = await q.getJob(id);
        if (!job) return NextResponse.json({ error: "job not found" }, { status: 404, headers: NO_CACHE });
        if (action === "retry") await job.retry();
        else if (action === "remove") await job.remove();
        else await job.promote();
        break;
      }
      default:
        return NextResponse.json({ error: "unknown action" }, { status: 400, headers: NO_CACHE });
    }

    await PublicBackLogger(
      "public",
      "event",
      "admin:queue",
      `queue action: ${action}${id ? ` #${id}` : body.type ? ` ${body.type}` : ""}`,
      { action, id: id ?? null, type: body.type ?? null, detail },
      "queue",
      id ?? action ?? "",
    );
    return NextResponse.json({ ok: true, action, id: id ?? null }, { status: 200, headers: NO_CACHE });
  } catch (err) {
    return NextResponse.json({ ok: false, action, error: String(err) }, { status: 502, headers: NO_CACHE });
  }
}
