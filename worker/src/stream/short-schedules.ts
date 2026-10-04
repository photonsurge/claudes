/**
 * Scheduled video batches (docs/short-video-plan.md §8): the ticker and
 * "Run batch now". State lives in Mongo (`db.shortSchedules`); the 60 s
 * `short-video.tick` job fires every enabled schedule whose `nextAt` has come
 * by queuing its videos, in order, as ShortRenders of one batch, then sets the
 * next `nextAt`. Editing a schedule is a Mongo write (the API recomputes
 * `nextAt`); nothing touches BullMQ.
 *
 * The ticker only queues. Freshness, the round-up refresh, `auto` scope and
 * the script generation happen as each video reaches the front of the render
 * queue (render-queue.ts).
 *
 *  - A fire is claimed (one conditional write on the `nextAt` read) BEFORE
 *    anything is queued: a crash mid-fire loses a batch rather than doubling it.
 *  - More than the missed window (10 min, env) overdue: recorded as `missed`,
 *    nothing queued, the next `nextAt` computed. A powered-off box must not
 *    burst stale videos on boot.
 *  - A once schedule disables itself after its fire (or its miss).
 */
import { randomUUID } from "node:crypto";
import { getAppDb, type AppDb } from "@photonsurge/shared/db/index";
import type { YoutubePrivacy } from "@photonsurge/shared/runs";
import type { ShortRender, ShortRenderRequest } from "@photonsurge/shared/short-render";
import { nextFireAt, type ShortSchedule, type ShortScheduleFire } from "@photonsurge/shared/short-schedule";
import { log } from "@photonsurge/shared/utill/logger";
import { advanceRenderQueues, createRenders } from "./render-queue";

const TAG = "short-schedules";

const envNum = (name: string, dflt: number): number => {
  const raw = process.env[name];
  const n = Number(raw);
  return raw !== undefined && raw !== "" && Number.isFinite(n) && n >= 0 ? n : dflt;
};

/** Deployment settings (§6.9), env with a default. */
export const scheduleEnv = {
  /** A schedule more than this overdue is `missed`, not caught up (§8: 10 min). */
  missedWindowMs: () => envNum("SHORT_SCHEDULE_MISSED_MS", 10 * 60_000),
};

/**
 * PURE: a schedule's batch as render requests, in order. `at` is the time the
 * batch is for (the schedule's time, or now for Run batch now): each video's
 * start-by is `at + startByMs`. Privacy comes from each video's format
 * (`formatPublishAs`) unless the video overrides it; a `publishAs` override
 * (Run batch now, §8.1 step 5) wins over both for the whole batch.
 */
export function batchRequests(
  s: ShortSchedule,
  opts: { at: number; batchId: string; n: number; formatPublishAs: (formatId: string) => YoutubePrivacy; publishAs?: YoutubePrivacy },
): ShortRenderRequest[] {
  return s.videos.map((v) => {
    let video = v.video ? { ...v.video } : undefined;
    if (opts.publishAs && video) {
      delete video.publishAs;
      if (!Object.keys(video).length) video = undefined;
    }
    const req: ShortRenderRequest = {
      encoderId: s.encoderId,
      what:
        v.what.type === "script"
          ? { type: "script", scriptId: v.what.scriptId }
          : { type: "generate", formatId: v.formatId, scope: v.what.scope, ...(v.what.include ? { include: v.what.include } : {}) },
      publishAs: opts.publishAs ?? v.video?.publishAs ?? opts.formatPublishAs(v.formatId),
      offline: s.offline,
      roundup: { ...v.roundup },
      scheduleId: s.id,
      batchId: opts.batchId,
      startBy: opts.at + s.startByMs,
      n: opts.n,
    };
    if (s.accountId) req.accountId = s.accountId;
    if (video) req.video = video;
    if (v.skipIfQuiet) req.skipIfQuiet = true;
    return req;
  });
}

/** Each format's own "publish as" (§8: a schedule takes privacy from each video's format). */
async function formatPrivacies(db: AppDb, s: ShortSchedule): Promise<(id: string) => YoutubePrivacy> {
  const map = new Map<string, YoutubePrivacy>();
  for (const id of new Set(s.videos.map((v) => v.formatId))) {
    const f = await db.shortFormats.get(id).catch(() => null);
    if (f) map.set(id, f.video.publishAs);
  }
  // An unknown format fails its video at the front; unlisted until then (§12).
  return (id) => map.get(id) ?? "unlisted";
}

async function queueBatch(db: AppDb, s: ShortSchedule, at: number, batchId: string, now: number, publishAs?: YoutubePrivacy) {
  const reqs = batchRequests(s, { at, batchId, n: s.fireCount, formatPublishAs: await formatPrivacies(db, s), publishAs });
  return createRenders(reqs, now);
}

export interface TickResult {
  fired: { scheduleId: string; batchId: string; renders: string[] }[];
  missed: string[];
}

/**
 * Fire every due schedule (the 60 s `short-video.tick`). Then advance the
 * render queue without waiting for it — the videos' own work happens there.
 */
export async function tickSchedules(now = Date.now()): Promise<TickResult> {
  const db = await getAppDb();
  const result: TickResult = { fired: [], missed: [] };
  for (const s of await db.shortSchedules.due(now)) {
    const at = s.nextAt!;
    const once = s.when.type === "once";
    // Never at or before now: a late fire mustn't leave the next one already due.
    const next = once ? null : nextFireAt(s.when, Math.max(now, at));
    const base: Partial<ShortSchedule> = { nextAt: next, ...(once ? { enabled: false } : {}) };
    const lateMs = now - at;
    try {
      if (lateMs > scheduleEnv.missedWindowMs()) {
        const lastFire: ShortScheduleFire = { at, outcome: "missed", note: `the worker was ${Math.round(lateMs / 60_000)} min late; nothing queued` };
        if (await db.shortSchedules.claimFire(s.id, at, { ...base, lastFire }, false)) {
          result.missed.push(s.id);
          log(TAG, `schedule ${s.id} (${s.name}): missed ${new Date(at).toISOString()} — ${lastFire.note}`);
        }
        continue;
      }
      const batchId = randomUUID();
      const lastFire: ShortScheduleFire = { at, batchId, outcome: "queued", ...(s.videos.length ? {} : { note: "no videos in the batch" }) };
      const claimed = await db.shortSchedules.claimFire(s.id, at, { ...base, lastFire }, true);
      if (!claimed) continue; // edited or fired elsewhere meanwhile
      const renders = await queueBatch(db, claimed, at, batchId, now);
      result.fired.push({ scheduleId: s.id, batchId, renders: renders.map((r) => r.id) });
      log(TAG, `schedule ${s.id} (${s.name}) #${claimed.fireCount}: queued ${renders.length} video(s), next ${next ? new Date(next).toISOString() : "none"}`);
    } catch (err) {
      log(TAG, `schedule ${s.id} fire failed`, String((err as Error)?.message ?? err));
    }
  }
  if (result.fired.length) void advanceRenderQueues(now);
  return result;
}

export type RunBatchResult =
  | { ok: true; scheduleId: string; batchId: string; n: number; renders: ShortRender[] }
  | { ok: false; error: string };

/**
 * "Run batch now" (§6.7, §8.1 step 5): queue the schedule's batch immediately,
 * enabled or not, leaving `nextAt` alone. It counts as a fire (`%{n}`,
 * `lastFire`). `publishAs` overrides every video's privacy for this batch.
 */
export async function runBatchNow(scheduleId: string, publishAs?: YoutubePrivacy, now = Date.now()): Promise<RunBatchResult> {
  const db = await getAppDb();
  const s = await db.shortSchedules.get(scheduleId);
  if (!s) return { ok: false, error: "no such schedule" };
  if (!s.videos.length) return { ok: false, error: "the schedule has no videos" };
  const batchId = randomUUID();
  const counted = await db.shortSchedules.countFire(s.id, { at: now, batchId, outcome: "queued", note: "run now" });
  if (!counted) return { ok: false, error: "no such schedule" };
  const renders = await queueBatch(db, counted, now, batchId, now, publishAs);
  log(TAG, `schedule ${s.id} (${s.name}) run now #${counted.fireCount}: queued ${renders.length} video(s)${publishAs ? ` as ${publishAs}` : ""}`);
  void advanceRenderQueues(now);
  return { ok: true, scheduleId: s.id, batchId, n: counted.fireCount, renders };
}
