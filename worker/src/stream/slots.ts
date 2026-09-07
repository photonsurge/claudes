/**
 * Persistent-stream reconciler — the "constant streams" layer. A StreamSlot is a
 * standing order: while enabled, its scene should ALWAYS have an unbounded run
 * live on its encoder. This sweep (a repeatable BullMQ job, see index.ts) drives
 * actual state toward that:
 *
 *  - enabled + no active run  → create a run and enqueue goLive, respecting an
 *    exponential backoff (slotRetryDelayMs) so a broken encoder/account doesn't
 *    get hammered every sweep;
 *  - enabled + run live ≥ SLOT_HEALTHY_AFTER_MS → reset the backoff counter;
 *  - enabled + run live longer than the slot's restart interval (if set) → end
 *    it; the next sweep relaunches it (a scheduled recycle onto a fresh
 *    broadcast, e.g. every 12h);
 *  - disabled + its run still active → enqueue end (the slot toggle is the
 *    on/off switch; the /api stop route auto-disables the slot for the same
 *    reason in reverse — otherwise this sweep would resurrect the stream).
 *
 * All external work goes through the run-lifecycle jobs — this file only reads
 * state and enqueues, so a mid-sweep crash can at worst delay one interval.
 */
import { getQueue } from "@photonsurge/shared/bull/bull";
import { getAppDb, type AppDb } from "@photonsurge/shared/db/index";
import {
  SLOT_HEALTHY_AFTER_MS,
  SLOT_RESTART_MIN_MS,
  runIsActive,
  slotRetryDelayMs,
  type StreamSlot,
} from "@photonsurge/shared/runs";
import { log } from "@photonsurge/shared/utill/logger";
import { exhaustedUntil, fmtResetTime } from "../youtube/quota";

const TAG = "stream-slots";
const QUOTA_HOLD_LOG_EVERY_MS = 10 * 60_000;
// Last "holding for quota" log per slot — the sweep runs every minute.
const quotaHoldLoggedAt = new Map<string, number>();

async function enqueueLifecycle(event: "goLive" | "end", data: Record<string, unknown>): Promise<void> {
  await getQueue("foreground").add(
    "do",
    { domain: "stream", type: "run-lifecycle", event, data },
    { removeOnComplete: true, removeOnFail: true },
  );
}

/** One reconcile sweep over every slot. `now` is injectable for tests. */
export async function reconcileSlots(now = Date.now()): Promise<void> {
  const db = await getAppDb();
  const slots = await db.listStreamSlots();
  for (const slot of slots) {
    try {
      await reconcileSlot(db, slot, now);
    } catch (err) {
      log(TAG, `slot ${slot.id} reconcile error`, String((err as Error)?.message ?? err));
    }
  }
}

async function reconcileSlot(db: AppDb, slot: StreamSlot, now: number): Promise<void> {
  const run = slot.runId ? await db.getRun(slot.runId) : null;
  const active = !!run && runIsActive(run.status);

  if (!slot.enabled) {
    if (active) {
      log(TAG, `slot ${slot.id} disabled — ending run ${run!.id}`);
      await enqueueLifecycle("end", { runId: run!.id, reason: "auto" });
    }
    return;
  }

  if (active) {
    // Live long enough proves the slot healthy again — forgive past failures.
    if (
      run!.status === "live" &&
      (slot.failCount ?? 0) > 0 &&
      run!.startAt &&
      now - run!.startAt >= SLOT_HEALTHY_AFTER_MS
    ) {
      await db.saveStreamSlot({ id: slot.id, failCount: 0 });
    }
    // Scheduled recycle: a run that has outlived the slot's restart interval is
    // ended here and relaunched by the next sweep through the normal restart
    // path below (which also keeps the per-encoder guard honest). Gated on
    // status "live" so a run already winding down isn't re-ended every sweep.
    const restartMs = slot.restartEveryMs ? Math.max(slot.restartEveryMs, SLOT_RESTART_MIN_MS) : 0;
    if (restartMs && run!.status === "live" && run!.startAt && now - run!.startAt >= restartMs) {
      log(TAG, `slot ${slot.id}: run ${run!.id} hit its ${Math.round(restartMs / 60_000)}min restart interval — recycling`);
      await enqueueLifecycle("end", { runId: run!.id, reason: "auto" });
    }
    return;
  }

  // No active run — (re)start one, unless we're still inside the backoff window.
  if (slot.lastAttemptAt && now - slot.lastAttemptAt < slotRetryDelayMs(slot.failCount ?? 0)) return;

  const account = await db.getYoutubeAccount(slot.accountId);
  if (!account) {
    log(TAG, `slot ${slot.id}: no connected YouTube account — will retry`);
    await db.saveStreamSlot({ id: slot.id, lastAttemptAt: now, failCount: (slot.failCount ?? 0) + 1 });
    return;
  }

  // A spent daily API quota fails every go-live the same way until midnight
  // Pacific — don't manufacture a failed run per backoff window (each would
  // deepen the slot's backoff and litter /admin/streams). Hold, and say so
  // occasionally; the next sweep after the reset launches as normal.
  const blockedUntil = await exhaustedUntil(account.id, now);
  if (blockedUntil) {
    const lastLog = quotaHoldLoggedAt.get(slot.id) ?? 0;
    if (now - lastLog >= QUOTA_HOLD_LOG_EVERY_MS) {
      quotaHoldLoggedAt.set(slot.id, now);
      log(TAG, `slot ${slot.id}: holding — YouTube API quota exhausted until ${fmtResetTime(blockedUntil)}`);
    }
    return;
  }
  quotaHoldLoggedAt.delete(slot.id);

  // Encoder: explicit pin, else the encoder bound to this scene, else the env OBS.
  const encoderId = slot.encoderId || (await db.encoderForScene(slot.sceneId))?.id;

  const created = await db.createRun({
    sceneId: slot.sceneId,
    encoderId,
    slotId: slot.id,
    status: "scheduled",
    phase: "created",
    title: slot.title || undefined,
    privacy: slot.privacy || "public",
    durationMs: null, // persistent — the slot toggle is the only off switch
    platforms: { youtube: { accountId: account.id, monitorStream: !!slot.monitorStream } },
    // Chat defaults ON (poll + log) — only an explicit opt-out on the slot disables it.
    chat: { enabled: slot.chat?.enabled !== false, promoteToTicker: !!slot.chat?.promoteToTicker },
    // "Notify the world" — announce EVERY (re)launch, incl. scheduled recycles
    // (each gets a fresh broadcast, so each has a new watch URL worth posting).
    announce: !!slot.announce,
    createdBy: `slot:${slot.id}`,
  });
  if (!created) {
    log(TAG, `slot ${slot.id}: failed to create run`);
    await db.saveStreamSlot({ id: slot.id, lastAttemptAt: now, failCount: (slot.failCount ?? 0) + 1 });
    return;
  }

  // failCount ticks up on every attempt and is only forgiven by 5 healthy live
  // minutes — a run that dies young therefore backs the slot off further.
  await db.saveStreamSlot({
    id: slot.id,
    runId: created.id,
    lastAttemptAt: now,
    failCount: (slot.failCount ?? 0) + 1,
  });
  log(TAG, `slot ${slot.id}: starting run ${created.id} (scene ${slot.sceneId}, encoder ${encoderId ?? "env"})`);
  await enqueueLifecycle("goLive", { runId: created.id });
}
