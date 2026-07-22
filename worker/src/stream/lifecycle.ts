/**
 * Streaming-run orchestration: takes a run from create → live across BOTH YouTube
 * (broadcast create/bind/transition) and OBS (encoder configure/start), keeps a
 * live health heartbeat, and finishes cleanly on stop / auto-end.
 *
 * Split of responsibility:
 *  - `goLive` (a BullMQ job): the synchronous, RESUMABLE create/bind/OBS steps.
 *    It never blocks waiting for RTMP ingest — it leaves the run in
 *    `awaiting-ingest` and hands off to the in-process monitor.
 *  - the monitor (in-process, one per run): polls YouTube ingest; the moment bytes
 *    are `active` it transitions the broadcast to live; thereafter it emits health.
 *  - `finishRun` (via the stop / auto-end jobs): transition→complete + OBS stop.
 *
 * Auto-END is a durable BullMQ delayed job (`run-end-<id>`) so it survives a worker
 * restart; the health/confirm monitor is in-process and re-armed at boot by
 * `rearmLiveRuns`. OBS being unreachable is NOT a failure — the run waits in
 * `awaiting-ingest` and the operator pastes the stream key into OBS by hand.
 */
import { getQueue } from "@photonsurge/shared/bull/bull";
import { getAppDb } from "@photonsurge/shared/db/index";
import { RUN_STATE, RUN_STATUS, toRunState, runIsFinished, type Run, type StreamHealth } from "@photonsurge/shared/runs";
import { log } from "@photonsurge/shared/utill/logger";
import { emitWorkerEvent } from "../socket";
import { startMonitor, stopMonitor, stopAllMonitors } from "./monitor";
import { startChatPoll, stopChatPoll } from "./chat";
import { ObsUnavailableError, setStreamKey, startStream, stopStream, getStatus, type ObsStreamStatus } from "../obs/client";
import {
  getYoutubeClient,
  createBroadcast,
  createStream,
  bindBroadcast,
  transitionBroadcast,
  getBroadcastLifeCycle,
  getStreamStatus,
  resolveLiveChatId,
  type YoutubeCtx,
} from "../youtube/client";

const TAG = "stream";
const HEARTBEAT_MS = 5_000; // health cadence while live
const CONFIRM_POLL_MS = 3_000; // ingest-confirm cadence while awaiting
const YT_HEALTH_EVERY = 6; // refresh YouTube health ~every 30s (spare API quota)

const autoEndJobId = (runId: string) => `run-end-${runId}`;

export { stopAllMonitors };

// ---- helpers ----

function defaultTitle(run: Run): string {
  const day = new Date().toISOString().slice(0, 10);
  return `Live — ${run.sceneId} — ${day}`;
}

function withYoutube(run: Run, youtube: Run["platforms"]["youtube"]): Run["platforms"] {
  return { ...run.platforms, youtube };
}

function emitRunState(run: Run): void {
  emitWorkerEvent({ type: RUN_STATE, data: toRunState(run) });
}

function emitHealth(
  run: Run,
  obs: ObsStreamStatus | undefined,
  yt: { health?: "good" | "ok" | "bad" | "noData"; streamStatus?: string } | undefined,
  kbps?: number,
): void {
  const health: StreamHealth = {
    runId: run.id,
    sceneId: run.sceneId,
    obs: obs
      ? {
          active: obs.outputActive,
          kbps,
          droppedRatio: obs.outputTotalFrames ? obs.outputSkippedFrames / obs.outputTotalFrames : 0,
          durationSec: Math.round(obs.outputDurationMs / 1000),
          congestion: obs.outputCongestion,
          reconnecting: obs.outputReconnecting,
        }
      : undefined,
    youtube: yt?.health || yt?.streamStatus ? { health: yt.health, streamStatus: yt.streamStatus } : undefined,
    at: Date.now(),
  };
  emitWorkerEvent({ type: RUN_STATUS, data: health });
}

async function persistPhase(runId: string, phase: Run["phase"], patch: Partial<Run>): Promise<Run> {
  await (await getAppDb()).updateRun(runId, { phase, ...patch });
  const run = await (await getAppDb()).getRun(runId);
  if (!run) throw new Error(`run ${runId} vanished mid-goLive`);
  return run;
}

async function armAutoEnd(runId: string, delayMs: number): Promise<void> {
  await cancelAutoEnd(runId);
  await getQueue("foreground").add(
    "do",
    { domain: "stream", type: "run-lifecycle", event: "end", data: { runId, reason: "auto" } },
    { delay: Math.max(0, delayMs), jobId: autoEndJobId(runId), removeOnComplete: true, removeOnFail: true },
  );
}

async function cancelAutoEnd(runId: string): Promise<void> {
  const job = await getQueue("foreground").getJob(autoEndJobId(runId));
  if (!job) return;
  const state = await job.getState().catch(() => "unknown");
  if (state !== "active") await job.remove().catch(() => {});
}

/**
 * Another run that already owns the shared OBS encoder, or null.
 *
 * HARD CONSTRAINT: one OBS instance has exactly ONE streaming output, and we hold a
 * single connection to one OBS_WEBSOCKET_URL. So only one run can be publishing at a
 * time — a second would overwrite the first's stream key via SetStreamServiceSettings
 * and then no-op on StartStream (output already active), silently pushing run A's
 * feed while reporting run B live. Concurrency across scenes needs one OBS instance
 * per scene (or a per-scene ffmpeg renderer); until then this guard refuses instead
 * of corrupting a live broadcast.
 */
async function encoderBusyWith(runId: string): Promise<Run | null> {
  const db = await getAppDb();
  const active = await db.listRuns({ status: ["scheduled", "awaiting-ingest", "live", "ending"] });
  return active.find((r) => r.id !== runId && !!r.platforms?.youtube) ?? null;
}

async function failRun(runId: string, step: string, err: unknown): Promise<void> {
  const message = String((err as Error)?.message ?? err);
  log(TAG, `run ${runId} failed at ${step}: ${message}`);
  try {
    await stopStream();
  } catch {
    /* best-effort rollback */
  }
  const db = await getAppDb();
  await db.updateRun(runId, { status: "failed", error: { step, message, at: Date.now() } });
  const run = await db.getRun(runId);
  if (run) emitRunState(run);
  stopMonitor(runId);
}

// ---- go live ----

export async function goLive(runId: string): Promise<void> {
  const db = await getAppDb();
  let run = await db.getRun(runId);
  if (!run) return log(TAG, `goLive: run ${runId} gone`);
  if (runIsFinished(run.status)) return log(TAG, `goLive: run ${runId} already ${run.status}`);

  const wantsYoutube = !!run.platforms?.youtube;
  try {
    if (wantsYoutube) {
      // Checked BEFORE creating any YouTube resources, so a refused run leaves no
      // orphaned broadcast behind. (The API pre-checks too; this catches the race.)
      const busy = await encoderBusyWith(runId);
      if (busy) {
        throw new Error(
          `the OBS encoder is already streaming run ${busy.id} (scene "${busy.sceneId}") — ` +
            `only one concurrent stream is supported by a single OBS instance. Stop that run first.`,
        );
      }
      const ctx = await getYoutubeClient(run.platforms.youtube?.accountId);
      let yt: NonNullable<Run["platforms"]["youtube"]> = {
        ...run.platforms.youtube,
        accountId: ctx.accountId,
        channelId: ctx.channelId,
      };

      // Each step guarded by what's already persisted, so a re-enqueued goLive
      // resumes instead of creating duplicate broadcasts/streams.
      if (!yt.broadcastId) {
        const { broadcastId, watchUrl } = await createBroadcast(ctx, {
          title: run.title || defaultTitle(run),
          privacy: run.privacy || "unlisted",
          scheduledStartTime: new Date().toISOString(),
          monitorStream: !!yt.monitorStream,
        });
        yt = { ...yt, broadcastId, watchUrl };
        run = await persistPhase(runId, "broadcast", { platforms: withYoutube(run, yt) });
      }
      if (!yt.streamId) {
        const { streamId, ingestionAddress, streamName } = await createStream(ctx, {
          title: run.title || defaultTitle(run),
        });
        yt = { ...yt, streamId, ingestionAddress, streamName };
        run = await persistPhase(runId, "stream", { platforms: withYoutube(run, yt) });
      }
      await bindBroadcast(ctx, yt.broadcastId!, yt.streamId!);
      run = await persistPhase(runId, "bound", { platforms: withYoutube(run, yt) });

      await configureAndStartObs(run, yt.ingestionAddress!, yt.streamName!);
    }

    // Move to awaiting-ingest (the monitor confirms + transitions to live). A run
    // with no YouTube binding has nothing to confirm — go straight to live.
    const patch: Partial<Run> = wantsYoutube
      ? { status: "awaiting-ingest" }
      : { status: "live", phase: "live", startAt: Date.now() };
    await db.updateRun(runId, patch);
    const cur = await db.getRun(runId);
    if (cur) {
      emitRunState(cur);
      if (cur.status === "live" && cur.durationMs) await armAutoEnd(runId, cur.durationMs);
    }
    startMonitor(runId, () => monitorTick(runId));
  } catch (err) {
    await failRun(runId, "goLive", err);
  }
}

async function configureAndStartObs(run: Run, server: string, key: string): Promise<void> {
  try {
    await setStreamKey(server, key);
    await persistPhase(run.id, "obs-config", { obs: { ...(run.obs ?? {}), configured: true, streaming: false } });
    await startStream();
    await persistPhase(run.id, "obs-start", { obs: { configured: true, streaming: true } });
  } catch (err) {
    if (err instanceof ObsUnavailableError) {
      // Graceful manual handoff: leave the run awaiting ingest with the key
      // surfaced (admin API) so the operator can point OBS at it by hand.
      log(TAG, `OBS unreachable for run ${run.id} — manual handoff: ${err.message}`);
      await (await getAppDb()).updateRun(run.id, { obs: { configured: false, streaming: false } });
      return;
    }
    throw err;
  }
}

// ---- monitor tick (confirm ingest, then emit health) ----

async function monitorTick(runId: string): Promise<number> {
  const db = await getAppDb();
  const run = await db.getRun(runId);
  if (!run || runIsFinished(run.status)) return -1;

  if (run.status === "awaiting-ingest") return confirmTick(run);
  if (run.status === "live") return healthTick(run);
  return HEARTBEAT_MS; // scheduled / ending — idle
}

async function confirmTick(run: Run): Promise<number> {
  const yt = run.platforms?.youtube;
  if (!yt?.streamId || !yt.broadcastId) return HEARTBEAT_MS;

  let obs: ObsStreamStatus | undefined;
  try {
    obs = await getStatus();
  } catch {
    /* OBS may be unreachable during manual handoff — keep polling YouTube */
  }
  try {
    const ctx = await getYoutubeClient(yt.accountId);
    const { streamStatus, health } = await getStreamStatus(ctx, yt.streamId);
    emitHealth(run, obs, { health, streamStatus });
    if (streamStatus === "active") {
      const committed = await transitionToLive(run, ctx);
      return committed ? HEARTBEAT_MS : CONFIRM_POLL_MS;
    }
  } catch (err) {
    log(TAG, `confirm error ${run.id}`, String((err as Error)?.message ?? err));
  }
  return CONFIRM_POLL_MS;
}

/** Drive YouTube from ready→(testing→)live. Returns true once the run is committed live. */
async function transitionToLive(run: Run, ctx: YoutubeCtx): Promise<boolean> {
  const yt = run.platforms.youtube!;
  const life = await getBroadcastLifeCycle(ctx, yt.broadcastId!);

  if (life !== "live") {
    if (yt.monitorStream) {
      // Monitor stream on → mandatory ready→testing→live, one hop per tick.
      if (life === "ready" || life === "created") {
        await transitionBroadcast(ctx, yt.broadcastId!, "testing");
        return false;
      }
      if (life === "testing") {
        await transitionBroadcast(ctx, yt.broadcastId!, "live");
      } else if (life === "testStarting" || life === "liveStarting") {
        return false; // transition in flight — wait for the next tick
      }
    } else {
      await transitionBroadcast(ctx, yt.broadcastId!, "live"); // monitor off → direct
    }
  }

  const db = await getAppDb();
  const liveChatId = yt.liveChatId ?? (await resolveLiveChatId(ctx, yt.broadcastId!).catch(() => undefined));
  const startAt = Date.now();
  await db.updateRun(run.id, {
    status: "live",
    phase: "live",
    error: null,
    startAt,
    platforms: withYoutube(run, { ...yt, liveChatId }),
    obs: { ...(run.obs ?? { configured: false }), streaming: true },
  });
  const updated = await db.getRun(run.id);
  if (updated) emitRunState(updated);
  if (run.durationMs && run.durationMs > 0) await armAutoEnd(run.id, run.durationMs);
  if (run.chat?.enabled && liveChatId) startChatPoll(run.id);
  log(TAG, `run live ${run.id}`);
  return true;
}

// Per-run tick counter so we can throttle the (quota-costed) YouTube health poll.
const healthTicks = new Map<string, number>();

async function healthTick(run: Run): Promise<number> {
  const db = await getAppDb();
  const ticks = (healthTicks.get(run.id) ?? 0) + 1;
  healthTicks.set(run.id, ticks);

  let obs: ObsStreamStatus | undefined;
  let kbps: number | undefined;
  try {
    obs = await getStatus();
    const prevBytes = run.obs?.lastBytes;
    const prevAt = run.obs?.lastBytesAt;
    const now = Date.now();
    if (typeof prevBytes === "number" && typeof prevAt === "number" && now > prevAt) {
      kbps = ((obs.outputBytes - prevBytes) * 8) / (now - prevAt); // bits / ms == kbit/s
    }
    await db.updateRun(run.id, {
      obs: { ...(run.obs ?? { configured: true }), streaming: obs.outputActive, lastBytes: obs.outputBytes, lastBytesAt: now },
    });
  } catch {
    /* OBS blip — still emit YouTube-side health below */
  }

  let ytHealth: { health?: "good" | "ok" | "bad" | "noData"; streamStatus?: string } | undefined;
  const yt = run.platforms?.youtube;
  if (yt?.streamId && ticks % YT_HEALTH_EVERY === 0) {
    try {
      const ctx = await getYoutubeClient(yt.accountId);
      ytHealth = await getStreamStatus(ctx, yt.streamId);
    } catch {
      /* transient — skip this sample */
    }
  }
  emitHealth(run, obs, ytHealth, kbps);
  return HEARTBEAT_MS;
}

// ---- finish (stop / auto-end) ----

export async function finishRun(runId: string, reason: "manual" | "auto"): Promise<void> {
  const db = await getAppDb();
  const run = await db.getRun(runId);
  if (!run) return;

  // Idempotency: covers the auto/manual race + a BullMQ retry.
  if (run.status === "ending" || runIsFinished(run.status)) {
    await cancelAutoEnd(runId);
    stopMonitor(runId);
    stopChatPoll(runId);
    healthTicks.delete(runId);
    return;
  }

  await db.updateRun(runId, { status: "ending" });
  const ending = await db.getRun(runId);
  if (ending) emitRunState(ending);

  const yt = run.platforms?.youtube;
  if (yt?.broadcastId) {
    try {
      const ctx = await getYoutubeClient(yt.accountId);
      const life = await getBroadcastLifeCycle(ctx, yt.broadcastId).catch(() => undefined);
      if (life !== "complete") await transitionBroadcast(ctx, yt.broadcastId, "complete");
    } catch (err) {
      log(TAG, `finish: youtube complete failed ${runId}`, String((err as Error)?.message ?? err));
    }
  }
  try {
    await stopStream();
  } catch {
    /* best-effort */
  }

  await db.updateRun(runId, {
    status: reason === "manual" ? "stopped" : "ended",
    endedAt: Date.now(),
    obs: { ...(run.obs ?? { configured: false }), streaming: false },
  });
  const done = await db.getRun(runId);
  if (done) emitRunState(done);

  await cancelAutoEnd(runId);
  stopMonitor(runId);
  stopChatPoll(runId);
  healthTicks.delete(runId);
}

// ---- boot reconciler ----

/**
 * After a worker restart, restore the in-process monitors for still-running runs
 * and re-arm their (durable) auto-end jobs. Runs whose bounded duration already
 * elapsed while the worker was down are finished immediately.
 */
export async function rearmLiveRuns(): Promise<void> {
  const db = await getAppDb();
  const runs = await db.listRuns({ status: ["live", "awaiting-ingest"] });
  for (const run of runs) {
    if (run.status === "live" && run.durationMs && run.startAt) {
      const remaining = run.startAt + run.durationMs - Date.now();
      if (remaining <= 0) {
        await finishRun(run.id, "auto");
        continue;
      }
      await armAutoEnd(run.id, remaining);
    }
    startMonitor(run.id, () => monitorTick(run.id));
    if (run.chat?.enabled && run.platforms?.youtube?.liveChatId) startChatPoll(run.id);
  }
  if (runs.length) log(TAG, `rearmed ${runs.length} live run(s)`);
}
