import { withApiLog } from "../../../../lib/api-log";
import { NextResponse } from "next/server";
import { clearQueue, getQueue } from "@photonsurge/shared/bull/bull";
import { PublicBackLogger } from "@photonsurge/shared/utill/BackLogger";
import { jobLabel } from "@photonsurge/shared/jobs";

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
  const label = jobLabel(s?.template?.data) ?? s?.id ?? s?.name ?? "repeat";
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
        const l = jobLabel(nextJob?.data as never);
        if (l) s.label = l;
      } catch {
        /* leave the fallback label */
      }
    }),
  );
  return schedules;
}

/** Flatten a BullMQ Job instance into a plain, JSON-safe row for the UI. */
function serializeJob(job: any) {
  const d = (job?.data ?? {}) as { domain?: string; type?: string; event?: string; data?: { source?: string } | null };
  return {
    id: String(job?.id ?? ""),
    name: job?.name ?? "",
    // "alerts.ingest:wmo" — the row's display name. Alerts registers a repeatable
    // PER SOURCE, so the Active list showed four identical `alerts.ingest` rows at
    // once with nothing to tell them apart. See jobLabel.
    //
    // NOT `label`: TriggerableJob.label already means the operator-facing NAME
    // ("Check weather run"), and these two ride the same admin page. A test caught
    // them being confused within an hour of the field existing.
    displayName: jobLabel(d) ?? null,
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

/** The states holding work that hasn't started — what "backlog" means here. */
const QUEUED_STATES = ["waiting", "delayed", "prioritized", "paused"] as const;

/**
 * The backlog broken down by job kind, biggest first.
 *
 * The dashboard lists jobs newest-first up to `limit`, which answers "what's
 * queued" but not "what is the backlog MADE of" — and those differ wildly: a
 * 500-job pile is usually a handful of schedules re-firing work that's already
 * stale, not 500 distinct problems. You can't choose a type to cancel without
 * seeing the shape first, and a truncated page can't show it.
 *
 * Counts across every queued state, `prioritized` included — sendToQueue sets a
 * priority, so BullMQ files those separately from `waiting` and they'd otherwise
 * be invisible here.
 */
async function getBacklog(q: any): Promise<{ type: string; event: string; count: number; oldest: number | null }[]> {
  const jobs = await q.getJobs([...QUEUED_STATES] as any, 0, -1, false);
  const by = new Map<string, { type: string; event: string; count: number; oldest: number | null }>();
  for (const j of jobs) {
    const d = (j?.data ?? {}) as { type?: string; event?: string };
    if (!d.type) continue;
    const key = `${d.type}.${d.event ?? ""}`;
    const hit = by.get(key);
    if (hit) {
      hit.count++;
      if (j?.timestamp && (!hit.oldest || j.timestamp < hit.oldest)) hit.oldest = j.timestamp;
    } else {
      by.set(key, { type: d.type, event: d.event ?? "", count: 1, oldest: j?.timestamp ?? null });
    }
  }
  return [...by.values()].sort((a, b) => b.count - a.count);
}

/**
 * GET /api/admin/queue?state=&limit=&backlog= — a BullMQ dashboard snapshot:
 * per-state counts, whether the queue is paused, the repeatable schedules, and
 * the jobs currently in the requested `state` (newest first, up to `limit`).
 *
 * `backlog=1` adds the queued-work breakdown by kind. Opt-in because it reads
 * every queued job's data, and the dashboard polls on a timer.
 */
async function GET__impl(req: Request) {
  const url = new URL(req.url);
  // `state` may be a single state (the queue dashboard) or a comma-separated
  // list (the jobs-page "active & queued" summary, which wants everything
  // in-flight in one call). Each returned job is tagged with the state it came
  // from so a merged list stays sortable.
  const requested = (url.searchParams.get("state") || "active")
    .split(",")
    .map((s) => s.trim())
    .filter((s): s is State => (STATES as readonly string[]).includes(s));
  const states: State[] = requested.length ? requested : ["active"];
  const limit = Math.min(Math.max(1, Number(url.searchParams.get("limit")) || 100), 1000);

  const wantBacklog = url.searchParams.get("backlog") === "1";

  const q = getQueue();
  try {
    const [counts, paused, repeatables, backlog] = await Promise.all([
      q.getJobCounts(...STATES),
      q.isPaused(),
      getSchedules(q),
      wantBacklog ? getBacklog(q) : Promise.resolve([]),
    ]);
    const perState = await Promise.all(
      states.map(async (s) => {
        const raw = await q.getJobs([s as any], 0, limit - 1, false);
        return raw.filter(Boolean).map((j: any) => ({ ...serializeJob(j), state: s }));
      }),
    );
    const jobs = perState.flat();
    return NextResponse.json(
      { queue: q.name, state: states.length === 1 ? states[0] : states.join(","), counts, paused, jobs, repeatables, backlog, limit },
      { status: 200, headers: NO_CACHE },
    );
  } catch (err) {
    // Redis/worker down — return a shell so the page still renders the error.
    return NextResponse.json(
      { queue: q.name, state: states.join(","), counts: null, paused: false, jobs: [], repeatables: [], backlog: [], error: String(err) },
      { status: 200, headers: NO_CACHE },
    );
  }
}

/**
 * POST /api/admin/queue { action, id?, type? } — mutate the queue.
 *  - retry | remove | promote : act on one job by id
 *  - cancel                    : stop a job — remove it if not yet started, or
 *                                signal a cooperative abort if it's active
 *  - cancelType { type, event? } : bin every not-yet-started job of one kind
 *  - retryAll                  : re-queue every failed job
 *  - clean { type }            : purge a whole job-type (completed/failed/…)
 *  - clear { states?, force? } : purge whole states (default: all of them)
 *  - pause | resume | drain    : queue-wide controls
 */
async function POST__impl(req: Request) {
  let body: {
    action?: string;
    id?: string;
    type?: string;
    event?: string;
    states?: string[];
    force?: boolean;
  } = {};
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
      case "clear": {
        // Purge whole states — `states` omitted means the big hammer, every job
        // in every state. Unarms any schedule holding a job in those states,
        // otherwise BullMQ refuses to remove them (see clearQueue); the worker
        // re-registers schedules at boot. An already-running job still finishes.
        detail = await clearQueue({
          states: Array.isArray(body.states) ? body.states : undefined,
          force: body.force !== false,
        });
        break;
      }
      case "stopChain": {
        // Halts a self-chaining job (e.g. cities.enrichWikiAll) by removing every
        // not-yet-started link still queued for it. The currently active batch,
        // if any, finishes naturally — there's no cooperative mid-batch abort.
        if (!body.type || !body.event) {
          return NextResponse.json({ error: "missing type/event" }, { status: 400, headers: NO_CACHE });
        }
        const pending = await q.getJobs(["waiting", "delayed"], 0, -1, false);
        const matches = pending.filter(
          (j: any) => j?.data?.type === body.type && j?.data?.event === body.event,
        );
        await Promise.all(matches.map((j: any) => j.remove()));
        detail = { removed: matches.length };
        break;
      }
      case "cancelType": {
        // Bin every not-yet-started job of one kind. The backlog arrives by TYPE,
        // not one bad job at a time — ~200 stacked `weather.refresh*` re-runs of
        // work that's already stale — and cancelling those one by one isn't a
        // realistic thing to ask of an operator.
        //
        // `event` is optional: omit it to clear a whole domain ("weather"), pass
        // it to clear one job ("weather.refreshMrms").
        //
        // Sweeps `prioritized` as well, which `stopChain` above does NOT —
        // sendToQueue gives jobs a priority, so BullMQ files them in a separate
        // set from plain `waiting` and a backlog can sit there unseen (69 of them,
        // last time this was measured).
        if (!body.type) {
          return NextResponse.json({ error: "missing type" }, { status: 400, headers: NO_CACHE });
        }
        const pending = await q.getJobs(["waiting", "delayed", "prioritized", "paused"], 0, -1, false);
        const doomed = pending.filter(
          (j: any) =>
            j?.data?.type === body.type && (!body.event || j?.data?.event === body.event),
        );
        // A job that vanishes mid-sweep (picked up, or removed by another
        // operator) is the outcome we wanted anyway — don't fail the whole call.
        const results = await Promise.allSettled(doomed.map((j: any) => j.remove()));
        const removed = results.filter((r) => r.status === "fulfilled").length;
        detail = { removed, matched: doomed.length };
        break;
      }
      case "cancel": {
        // Cancel = stop a job that shouldn't run/finish. A not-yet-started job
        // (waiting/delayed/prioritized/paused) is removed outright. An ACTIVE job
        // can't be force-killed — BullMQ has no preemption — so we publish a
        // cancel to the worker, which cooperatively aborts it + discards it (no
        // retry). That only interrupts handlers that honor the abort signal.
        if (!id) return NextResponse.json({ error: "missing id" }, { status: 400, headers: NO_CACHE });
        const job = await q.getJob(id);
        if (!job) return NextResponse.json({ error: "job not found" }, { status: 404, headers: NO_CACHE });
        const jobState = await job.getState();
        if (jobState === "active") {
          const client = await q.client;
          await client.publish(`${q.name}:cancel`, id);
          detail = { state: jobState, cancel: "signalled" };
        } else {
          await job.remove();
          detail = { state: jobState, cancel: "removed" };
        }
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
    return NextResponse.json({ ok: true, action, id: id ?? null, detail }, { status: 200, headers: NO_CACHE });
  } catch (err) {
    return NextResponse.json({ ok: false, action, error: String(err) }, { status: 502, headers: NO_CACHE });
  }
}

// --- request logging (lib/api-log) ---
export const GET = withApiLog(GET__impl);
export const POST = withApiLog(POST__impl);
