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
import { buildBroadcastDescription } from "@photonsurge/shared/stream-description";
import { formatStreamTitle } from "@photonsurge/shared/stream-title";
import {
  RUN_STATE,
  RUN_STATUS,
  encoderKeyForRun,
  isScriptRun,
  toRunState,
  runIsFinished,
  type Run,
  type StreamHealth,
} from "@photonsurge/shared/runs";
import { log } from "@photonsurge/shared/utill/logger";
import { emitWorkerEvent } from "../socket";
import { startMonitor, stopMonitor, stopAllMonitors } from "./monitor";
import { queueAnnounce } from "./announce";
import { chaptersEnabled, queueChapters } from "./chapters";
import { channelYoutubeSettings, resolveRunAccountId, type ChannelYoutube } from "./channel-youtube";
import { queueThumbnail, thumbnailsEnabled } from "./thumbnail";
import { startChatPoll, stopChatPoll } from "./chat";
import {
  ObsUnavailableError,
  setStreamKey,
  startStream,
  stopStream,
  ensureOutputStopped,
  getStatus,
  lastStreamStateFor,
  outputInFlight,
  type ObsStreamStatus,
} from "../obs/client";
import {
  encoderOwnSceneId,
  endpointForRun,
  idleEncoderScene,
  provisionEncoderScene,
  watchBaseUrl,
  withEncoderLock,
} from "./encoders";
import {
  getYoutubeClient,
  createBroadcast,
  createStream,
  bindBroadcast,
  transitionBroadcast,
  getBroadcastLifeCycle,
  getStreamStatus,
  getVideoStats,
  resolveLiveChatId,
  type YoutubeCtx,
} from "../youtube/client";
import { stampVideoTimes } from "../youtube/video-times";
import { onScriptRunLive, onScriptRunOver, rearmScriptRun, scriptGoLiveOverdue } from "./script-run";

const TAG = "stream";
const HEARTBEAT_MS = 5_000; // health cadence while live
const CONFIRM_POLL_MS = 3_000; // ingest-confirm cadence while awaiting
const YT_HEALTH_EVERY = 6; // refresh YouTube health ~every 30s (spare API quota)
// Unbounded (persistent) runs poll YouTube health ~every 2 min instead — three
// always-on streams at 30s would eat ~8.6k of the 10k/day default quota alone.
const YT_HEALTH_EVERY_UNBOUNDED = 24;
// Confirm ticks an OBS output may sit inactive (not reconnecting) after StartStream
// before we call it dead — RTMP connect + encoder init take a few seconds, and
// GetStreamStatus.outputActive only flips once data capture begins.
const OBS_OUTPUT_GRACE_TICKS = 4; // ≈12s at CONFIRM_POLL_MS

const autoEndJobId = (runId: string) => `run-end-${runId}`;

export { stopAllMonitors };

// ---- helpers ----

function defaultTitle(run: Run, channel?: ChannelYoutube): string {
  const day = new Date().toISOString().slice(0, 10);
  // The result goes through formatStreamTitle: a "%" in a name is literal.
  const name = (channel?.name || run.sceneId).replace(/%/g, "%%");
  if (channel?.surface === "crossword") return `${name} — Live crossword — ${day}`;
  return `Live — ${run.sceneId.replace(/%/g, "%%")} — ${day}`;
}

/**
 * A crossword channel's description when its YouTube card leaves it blank
 * (crossword plan §10). Not the deployment default or the built-in copy: both
 * describe the weather globe. Date codes as in the title.
 */
export const CROSSWORD_STREAM_DESCRIPTION =
  "A live crossword, played in the chat. Type an answer: the first right one takes the word and its points, " +
  "and the host fills in whatever nobody gets.\n\nStreaming since %A %e %B %Y, %H:%M %Z.";

/** The broadcast description for a channel run, from its YouTube card. */
function channelDescription(channel: ChannelYoutube): string {
  if (channel.surface === "crossword") {
    // No "watch the map" link: the crossword's page is tokened and is not the site.
    return buildBroadcastDescription({ template: channel.description || CROSSWORD_STREAM_DESCRIPTION });
  }
  return buildBroadcastDescription({
    template: channel.description,
    fallback: process.env.YOUTUBE_DESCRIPTION,
    siteUrl: watchBaseUrl(),
  });
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

/**
 * End a run `delayMs` from now through the durable auto-end job — replacing the
 * run's safety cap. A video render ends this way after its lead-out (§6.5).
 */
export async function endRunAfter(runId: string, delayMs: number): Promise<void> {
  await armAutoEnd(runId, delayMs);
}

async function cancelAutoEnd(runId: string): Promise<void> {
  const job = await getQueue("foreground").getJob(autoEndJobId(runId));
  if (!job) return;
  const state = await job.getState().catch(() => "unknown");
  if (state !== "active") await job.remove().catch(() => {});
}

/**
 * Another run already publishing through the SAME encoder, or null.
 *
 * HARD CONSTRAINT: one OBS instance has exactly ONE streaming output. A second run
 * on the same instance would overwrite the first's stream key via
 * SetStreamServiceSettings and then no-op on StartStream (output already active),
 * silently pushing run A's feed while reporting run B live. Concurrency comes from
 * the StreamEncoder registry — one OBS instance per scene — so the guard is scoped
 * per encoder (legacy no-encoderId runs collapse onto the env instance).
 */
async function encoderBusyWith(run: Run): Promise<Run | null> {
  const db = await getAppDb();
  return db.activeRunForEncoder(encoderKeyForRun(run), run.id);
}

/** Best-effort stop of the run's OBS output (rollback/finish paths). */
async function stopRunObs(run: Run): Promise<void> {
  // An offline test (§7) never started an output, so it has none to stop — an
  // output running on that OBS is not this run's.
  if (isScriptRun(run) && run.script!.offline && !run.platforms?.youtube) return;
  try {
    await stopStream(await endpointForRun(run));
  } catch {
    /* best-effort — unreachable/unconfigured OBS is fine here */
  }
}

async function failRun(runId: string, step: string, err: unknown): Promise<void> {
  const message = String((err as Error)?.message ?? err);
  log(TAG, `run ${runId} failed at ${step}: ${message}`);
  const db = await getAppDb();
  const before = await db.getRun(runId);
  // Never stop an output another run owns: a run refused by the busy guard
  // fails here too, and its encoder is streaming that OTHER run.
  if (before && !(await encoderBusyWith(before))) await stopRunObs(before);
  await db.updateRun(runId, { status: "failed", error: { step, message, at: Date.now() } });
  const run = await db.getRun(runId);
  if (run) emitRunState(run);
  stopMonitor(runId);
  confirmState.delete(runId);
  await cancelAutoEnd(runId).catch(() => {});
  // A failed render leaves nothing behind (§6.4): broadcast deleted, play
  // stopped, encoder restored, and the queue moves on.
  if (run && isScriptRun(run)) await onScriptRunOver(run);
  else if (run) await restoreBorrowedEncoder(run);
}

// ---- go live ----

export async function goLive(runId: string): Promise<void> {
  const db = await getAppDb();
  let run = await db.getRun(runId);
  if (!run) return log(TAG, `goLive: run ${runId} gone`);
  if (runIsFinished(run.status)) return log(TAG, `goLive: run ${runId} already ${run.status}`);

  const wantsYoutube = !!run.platforms?.youtube;
  const scripted = isScriptRun(run);
  try {
    if (wantsYoutube || scripted) {
      // Checked BEFORE creating any YouTube resources, so a refused run leaves no
      // orphaned broadcast behind. (The API pre-checks too; this catches the race.)
      // A video render takes its encoder even offline (no YouTube): it repoints
      // the browser source, so the guard runs on that branch too (§13).
      const busy = await encoderBusyWith(run);
      if (busy) {
        throw new Error(
          `encoder "${encoderKeyForRun(run)}" is already streaming run ${busy.id} (scene "${busy.sceneId}") — ` +
            `one OBS instance supports one concurrent stream. Stop that run or use another encoder.`,
        );
      }
    }
    if (scripted && !run.script!.goLiveAt) {
      // The go-live deadline (§6.4) counts from the first goLive attempt.
      run = await persistPhase(runId, run.phase ?? "created", { script: { ...run.script!, goLiveAt: Date.now() } });
    }
    if (wantsYoutube) {
      // The channel decides the account when the run names none (§10); a
      // crossword channel with neither is refused here, before any YouTube call.
      // A video render publishes where its render queue said, as before.
      const channel = scripted ? null : await channelYoutubeSettings(run.sceneId);
      const accountId = channel
        ? await resolveRunAccountId(run.sceneId, run.platforms.youtube?.accountId, channel)
        : run.platforms.youtube?.accountId;
      const ctx = await getYoutubeClient(accountId);
      let yt: NonNullable<Run["platforms"]["youtube"]> = {
        ...run.platforms.youtube,
        accountId: ctx.accountId,
        channelId: ctx.channelId,
      };

      // Each step guarded by what's already persisted, so a re-enqueued goLive
      // resumes instead of creating duplicate broadcasts/streams.
      if (!yt.broadcastId) {
        // Title + description come from the CHANNEL's YouTube settings
        // (/admin/scenes/:id); a run/slot title overrides. Both resolve once,
        // here — the description falls back to the deployment default, then the
        // built-in copy, with the site link appended. The as-run chapters land
        // BELOW this text after the run ends.
        // A video render's title and description were resolved by the render
        // queue from its format (§6.8) and are used exactly as written — never
        // run through the channel's title template again.
        let title: string;
        let description: string;
        if (scripted) {
          title = run.title || defaultTitle(run);
          description = run.description ?? "";
        } else {
          title = formatStreamTitle(run.title || channel!.title || defaultTitle(run, channel!));
          description = channelDescription(channel!);
        }
        const { broadcastId, watchUrl } = await createBroadcast(ctx, {
          title,
          description,
          privacy: run.privacy || "unlisted",
          scheduledStartTime: new Date().toISOString(),
          monitorStream: !!yt.monitorStream,
          // Chat is a crossword's input, so its picture should trail by
          // seconds, not tens of seconds (§6.3). Weather keeps the default.
          ...(channel?.surface === "crossword" ? { latency: "low" as const } : {}),
        });
        yt = { ...yt, broadcastId, watchUrl };
        run = await persistPhase(runId, "broadcast", { title, description, platforms: withYoutube(run, yt) });
        // Thumbnail as its own retried job — a slow image host must never delay go-live.
        if (thumbnailsEnabled()) {
          await queueThumbnail(runId).catch((err) =>
            log(TAG, `thumbnail enqueue failed ${runId}`, String((err as Error)?.message ?? err)),
          );
        }
      }
      if (!yt.streamId) {
        const { streamId, ingestionAddress, streamName } = await createStream(ctx, {
          title: run.title || defaultTitle(run, channel ?? undefined),
        });
        yt = { ...yt, streamId, ingestionAddress, streamName };
        run = await persistPhase(runId, "stream", { platforms: withYoutube(run, yt) });
      }
      await bindBroadcast(ctx, yt.broadcastId!, yt.streamId!);
      run = await persistPhase(runId, "bound", { platforms: withYoutube(run, yt) });

      await configureAndStartObs(run, yt.ingestionAddress!, yt.streamName!);
    } else if (scripted) {
      // Offline rehearsal (§7): point the encoder's browser source at the
      // script's scene (the format's /watch page) — no broadcast, no key, no
      // StartStream, no YouTube call of any kind. The screenshots are taken
      // off the play's start (script-shots.ts).
      await provisionForScript(run);
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
    // The no-YouTube branch is live already: start the script the same way
    // transitionToLive does for a broadcast (§6.5 step 2).
    if (cur && cur.status === "live" && isScriptRun(cur)) await onScriptRunLive(cur);
  } catch (err) {
    await failRun(runId, "goLive", err);
  }
}

/**
 * Best-effort full auto-provision of the run's encoder, always on the RUN's
 * scene (the `sceneId` override): a video render shows its script's scene
 * (short-video plan §6.4), and a channel run on a picked encoder shows the
 * run's channel, not the encoder's usual one (crossword plan §10). The
 * encoder's own scene comes back when the run ends (script-run.ts for a
 * render, `restoreBorrowedEncoder` for a channel run). Never fails the run.
 */
async function provisionForRun(run: Run): Promise<void> {
  try {
    // Under the encoder's lock, so a hand-back of the same encoder by a run
    // that just ended can't land on top of this one (§10).
    const p = await withEncoderLock(run.encoderId, () => provisionEncoderScene(run.encoderId, { sceneId: run.sceneId }));
    const swept =
      p.removedInputs.length || p.removedScenes.length
        ? ` (swept ${p.removedInputs.length} stray source(s), ${p.removedScenes.length} scene(s))`
        : "";
    log(
      TAG,
      `provisioned OBS scene for run ${run.id}: "${p.sceneName}" → ${p.url}${p.recreated ? " (hard reset: browser source rebuilt)" : ""}${swept}`,
    );
  } catch (e) {
    log(TAG, `OBS auto-provision skipped for run ${run.id}: ${String((e as Error)?.message ?? e)}`);
  }
}

/**
 * The offline (no-YouTube) branch of a video render: only the provision. Here
 * it is the whole rehearsal, so unlike a channel run's best-effort provision
 * an OBS that can't be reached or provisioned FAILS the render — nobody is
 * watching it, and a test that "passed" without OBS proves nothing (§6.4).
 */
async function provisionForScript(run: Run): Promise<void> {
  const p = await provisionEncoderScene(run.encoderId, { sceneId: run.sceneId });
  log(TAG, `offline test ${run.id}: OBS scene "${p.sceneName}" → ${p.url}`);
}

/** Phases from which goLive has (or may have) provisioned the run's encoder. */
const PROVISIONED_PHASES = new Set<Run["phase"]>(["bound", "obs-config", "obs-start", "confirmed", "live"]);

/**
 * Hand an encoder a channel run borrowed back to its own scene (crossword plan
 * §10): when the run's channel is not the one the encoder is bound to, its own
 * channel is provisioned again — or, for a video encoder or a registered one
 * bound to no channel, the blank idle page. Only after a run that got as far as
 * provisioning (the "bound" phase is persisted just before it, so a run that
 * fails at the stream key or StartStream is still handed back). Skipped while
 * another run holds the encoder (checked under the encoder's lock, so a new
 * go-live can't interleave) and while the run's standing slot is still on: its
 * next recycle provisions the same scene again. Best-effort: a failure is
 * logged, never fails the finish.
 */
async function restoreBorrowedEncoder(run: Run): Promise<void> {
  if (isScriptRun(run)) return; // script-run.ts restores a render's encoder itself
  if (!run.platforms?.youtube || !PROVISIONED_PHASES.has(run.phase)) return;
  try {
    const own = await encoderOwnSceneId(run.encoderId);
    if (own === run.sceneId) return;
    const db = await getAppDb();
    if (run.slotId) {
      const slot = await db.getStreamSlot(run.slotId);
      if (slot?.enabled) return;
    }
    const url = await withEncoderLock(run.encoderId, async () => {
      if (await db.activeRunForEncoder(encoderKeyForRun(run), run.id)) return null;
      return own === null
        ? (await idleEncoderScene(run.encoderId)).url
        : (await provisionEncoderScene(run.encoderId)).url;
    });
    if (url) log(TAG, `run ${run.id}: encoder ${encoderKeyForRun(run)} ${own === null ? "idle (blank page)" : `back on ${url}`}`);
  } catch (err) {
    log(TAG, `run ${run.id}: encoder restore skipped`, String((err as Error)?.message ?? err));
  }
}

async function configureAndStartObs(run: Run, server: string, key: string): Promise<void> {
  try {
    // Resolving the endpoint throws ObsUnavailableError when the encoder is
    // missing/disabled/unconfigured — same manual-handoff branch as unreachable.
    const ep = await endpointForRun(run);
    // Hard-reset the instance before configuring it. Step 1: a stale streaming
    // output (a crashed run's leftover — the per-encoder guard means no live
    // run of ours owns it) must stop first, or StartStream below would "already
    // be streaming" to the OLD destination and the run would sit on AWAITING
    // INGEST forever. Best-effort: unreachable OBS lands on the manual-handoff
    // branch via setStreamKey below.
    try {
      if (await ensureOutputStopped(ep)) {
        log(TAG, `run ${run.id}: stopped a stale OBS output on ${ep.url} before reconfiguring`);
      }
    } catch {
      /* handled by setStreamKey's manual-handoff branch */
    }
    // Step 2: best-effort full auto-provision — by default a hard reset that
    // rebuilds the browser source (fresh Chromium, zero accumulated state) on
    // the channel's tokened /watch URL. Never fail the run on this.
    await provisionForRun(run);
    await setStreamKey(ep, server, key);
    log(TAG, `run ${run.id}: OBS ${ep.url} stream settings set → ${server} (key …${key.slice(-4)})`);
    await persistPhase(run.id, "obs-config", { obs: { ...(run.obs ?? {}), configured: true, streaming: false } });
    await startStream(ep);
    log(TAG, `run ${run.id}: StartStream accepted by OBS ${ep.url} — waiting for its output, then YouTube ingest`);
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

  // Nobody watches a scheduled render, so unreachable OBS or no ingest is a
  // failure, not a manual handoff: a video still not live by its deadline
  // fails and cleans up after itself (§6.4).
  if (run.status === "awaiting-ingest" && scriptGoLiveOverdue(run, Date.now())) {
    await failRun(run.id, "deadline", new Error("the video did not go live within its go-live deadline (no ingest from OBS)"));
    return -1;
  }
  if (run.status === "awaiting-ingest") return confirmTick(run);
  if (run.status === "live") return healthTick(run);
  return HEARTBEAT_MS; // scheduled / ending — idle
}

// Per-run confirm bookkeeping (in-process, like the monitors themselves).
const confirmState = new Map<string, { inactiveTicks: number; ingest?: string; lastError?: string }>();

async function confirmTick(run: Run): Promise<number> {
  const yt = run.platforms?.youtube;
  if (!yt?.streamId || !yt.broadcastId) return HEARTBEAT_MS;

  let obs: ObsStreamStatus | undefined;
  try {
    obs = await getStatus(await endpointForRun(run));
    run = await reconcileObsOutput(run, obs);
  } catch {
    /* OBS may be unreachable during manual handoff — keep polling YouTube */
  }
  try {
    const ctx = await getYoutubeClient(yt.accountId);
    const { streamStatus, health } = await getStreamStatus(ctx, yt.streamId);
    noteIngestStatus(run.id, streamStatus);
    emitHealth(run, obs, { health, streamStatus });
    if (streamStatus === "active") {
      const committed = await transitionToLive(run, ctx);
      return committed ? HEARTBEAT_MS : CONFIRM_POLL_MS;
    }
  } catch (err) {
    // A persistent condition (spent quota, dead token, OBS down) would otherwise
    // log every CONFIRM_POLL_MS — say it when it changes.
    const message = String((err as Error)?.message ?? err);
    const st = confirmState.get(run.id) ?? { inactiveTicks: 0 };
    if (st.lastError !== message) {
      st.lastError = message;
      confirmState.set(run.id, st);
      log(TAG, `confirm error ${run.id}`, message);
    }
  }
  return CONFIRM_POLL_MS;
}

/** Log YouTube's ingest status for a run whenever it changes (inactive → ready → active). */
function noteIngestStatus(runId: string, streamStatus: string | undefined): void {
  const st = confirmState.get(runId) ?? { inactiveTicks: 0 };
  st.lastError = undefined; // a successful poll clears the repeat-suppression
  if (st.ingest !== streamStatus) {
    log(TAG, `run ${runId}: YouTube ingest ${st.ingest ?? "?"} → ${streamStatus ?? "?"}`);
    st.ingest = streamStatus;
  }
  confirmState.set(runId, st);
}

/**
 * Compare what OBS says about its streaming output with what the run believes.
 * obs-websocket's StartStream is fire-and-forget: OBS accepts it and only later
 * fails (encoder init, RTMP connect…), which the worker would otherwise never
 * see — the run would sit in awaiting-ingest with no clue why. So an output we
 * started that is neither active nor reconnecting (past a short grace, or as soon
 * as OBS's own StreamStateChanged says STOPPED) is flagged on the run — visible on
 * /admin/streams + /control — and logged with OBS's last state. The flag clears
 * itself the moment OBS's output is running (operator restarted it by hand).
 */
async function reconcileObsOutput(run: Run, obs: ObsStreamStatus): Promise<Run> {
  const believed = !!run.obs?.streaming;
  const actual = obs.outputActive || obs.outputReconnecting;
  const st = confirmState.get(run.id) ?? { inactiveTicks: 0 };
  st.inactiveTicks = actual ? 0 : st.inactiveTicks + 1;
  confirmState.set(run.id, st);
  if (believed === actual) return run;

  const db = await getAppDb();
  if (!actual) {
    const ep = await endpointForRun(run).catch(() => null);
    const last = ep ? lastStreamStateFor(ep.url) : undefined;
    // Still coming up (OBS said STARTING / RECONNECTING, or no verdict yet within grace)? Wait.
    if (outputInFlight(last)) return run;
    const stopped = !!last && !last.outputActive;
    if (!stopped && st.inactiveTicks < OBS_OUTPUT_GRACE_TICKS) return run;

    const message =
      "OBS accepted StartStream but its streaming output is not running" +
      (last ? ` (last OBS state: ${last.outputState})` : "") +
      " — check the OBS log on the encoder host (encoder init / RTMP connect failure), then press Start Streaming in OBS or Stop and Go Live again";
    log(TAG, `run ${run.id}: ${message}`);
    await db.updateRun(run.id, {
      obs: { ...(run.obs ?? { configured: false }), streaming: false },
      error: { step: "obs-output", message, at: Date.now() },
    });
  } else {
    log(TAG, `run ${run.id}: OBS streaming output is running (active=${obs.outputActive}, reconnecting=${obs.outputReconnecting})`);
    await db.updateRun(run.id, {
      obs: { ...(run.obs ?? { configured: false }), streaming: true },
      error: run.error?.step === "obs-output" ? null : (run.error ?? null),
    });
  }
  const cur = await db.getRun(run.id);
  if (cur) emitRunState(cur);
  return cur ?? run;
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
  // A video render has no chat (§6.3): no chat id lookup, no poller, no announce.
  const scripted = isScriptRun(run);
  const liveChatId = scripted
    ? undefined
    : yt.liveChatId ?? (await resolveLiveChatId(ctx, yt.broadcastId!).catch(() => undefined));
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
  if (!scripted && run.chat?.enabled && liveChatId) startChatPoll(run.id);
  // "Notify the world": fan the announcement out as its own retried job — a down
  // hydra must never affect the live commit.
  if (!scripted && updated?.announce && !updated.announcedAt) {
    await queueAnnounce(run.id).catch((err) =>
      log(TAG, `announce enqueue failed ${run.id}`, String((err as Error)?.message ?? err)),
    );
  }
  log(TAG, `run live ${run.id}`);
  // A video render starts its script after the lead-in (§6.5 step 2).
  if (scripted && updated) await onScriptRunLive(updated);
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
    obs = await getStatus(await endpointForRun(run));
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
  const ytEvery = run.durationMs ? YT_HEALTH_EVERY : YT_HEALTH_EVERY_UNBOUNDED;
  if (yt?.streamId && ticks % ytEvery === 0) {
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

/**
 * End a run: YouTube complete, OBS stopped, status `stopped` (manual) or `ended`
 * (auto). With `fail`, the run ends the same way but lands in `failed` with that
 * error — a video render whose play was cut short (§6.5).
 */
export async function finishRun(
  runId: string,
  reason: "manual" | "auto",
  opts: { fail?: { step: string; message: string }; resume?: boolean } = {},
): Promise<void> {
  const db = await getAppDb();
  const run = await db.getRun(runId);
  if (!run) return;

  // Idempotency: covers the auto/manual race + a BullMQ retry. `resume` takes
  // over a finish a restart cut short (the run was left "ending").
  const resuming = opts.resume && run.status === "ending";
  if (!resuming && (run.status === "ending" || runIsFinished(run.status))) {
    await cancelAutoEnd(runId);
    stopMonitor(runId);
    stopChatPoll(runId);
    healthTicks.delete(runId);
    confirmState.delete(runId);
    return;
  }

  await db.updateRun(runId, { status: "ending" });
  const ending = await db.getRun(runId);
  if (ending) emitRunState(ending);

  const yt = run.platforms?.youtube;
  // A render stopped before it went live has a broadcast that never aired:
  // script-run.ts deletes it instead (completing it would 4xx anyway).
  const neverLiveRender = isScriptRun(run) && !run.startAt;
  if (yt?.broadcastId && !neverLiveRender) {
    try {
      const ctx = await getYoutubeClient(yt.accountId);
      const life = await getBroadcastLifeCycle(ctx, yt.broadcastId).catch(() => undefined);
      if (life !== "complete") await transitionBroadcast(ctx, yt.broadcastId, "complete");
    } catch (err) {
      log(TAG, `finish: youtube complete failed ${runId}`, String((err as Error)?.message ?? err));
    }
    // VOD time base for the as-run page (docs/vod-as-run-plan.md): YouTube's own
    // go-live/end instants. One 1-unit videos.list; the stats poll re-stamps
    // later if the end instant isn't set yet. Best-effort, never fails the finish.
    try {
      const ctx = await getYoutubeClient(yt.accountId);
      const [video] = await getVideoStats(ctx, [yt.broadcastId]);
      await stampVideoTimes(db, run, video);
    } catch (err) {
      log(TAG, `finish: video times failed ${runId}`, String((err as Error)?.message ?? err));
    }
  }
  await stopRunObs(run);

  await db.updateRun(runId, {
    status: opts.fail ? "failed" : reason === "manual" ? "stopped" : "ended",
    endedAt: Date.now(),
    obs: { ...(run.obs ?? { configured: false }), streaming: false },
    ...(opts.fail ? { error: { ...opts.fail, at: Date.now() } } : {}),
  });
  const done = await db.getRun(runId);
  if (done) emitRunState(done);

  // As-run chapters into the video description — its own delayed, retried job
  // (docs/vod-as-run-plan.md §4); a YouTube hiccup must never affect the finish.
  // A video render queues them from its finalize step instead, AFTER tags,
  // category and privacy are written: both rewrite the snippet (§13).
  if (yt?.broadcastId && chaptersEnabled() && !isScriptRun(run)) {
    await queueChapters(runId).catch((err) =>
      log(TAG, `chapters enqueue failed ${runId}`, String((err as Error)?.message ?? err)),
    );
  }

  await cancelAutoEnd(runId);
  stopMonitor(runId);
  stopChatPoll(runId);
  healthTicks.delete(runId);
  confirmState.delete(runId);

  // Video render: stop the play, restore the encoder, finalize or clean up,
  // record the outcome and start the next video (§6.5 steps 3 and 6).
  if (done && isScriptRun(done)) await onScriptRunOver(done);
  else if (done) await restoreBorrowedEncoder(done);
}

// ---- boot reconciler ----

/**
 * After a worker restart, restore the in-process monitors for still-running runs
 * and re-arm their (durable) auto-end jobs. Runs whose bounded duration already
 * elapsed while the worker was down are finished immediately.
 */
export async function rearmLiveRuns(): Promise<void> {
  const db = await getAppDb();
  const runs = await db.listRuns({ status: ["live", "awaiting-ingest", "ending"] });
  for (const run of runs) {
    // A finish the restart cut short: complete it (YouTube, OBS, status, the
    // encoder's hand-back) instead of leaving the run "ending" for ever.
    if (run.status === "ending") {
      await finishRun(run.id, "auto", { resume: true });
      continue;
    }
    // A live video render whose play the restart cut short is ended and failed
    // here; one that hasn't started its script yet has its start re-armed (§6.5
    // step 5). Otherwise it is rearmed like any run (the safety cap ends it).
    if (isScriptRun(run) && (await rearmScriptRun(run))) continue;
    if (run.status === "live" && run.durationMs && run.startAt) {
      const remaining = run.startAt + run.durationMs - Date.now();
      if (remaining <= 0) {
        await finishRun(run.id, "auto");
        continue;
      }
      await armAutoEnd(run.id, remaining);
    }
    startMonitor(run.id, () => monitorTick(run.id));
    if (!isScriptRun(run) && run.chat?.enabled && run.platforms?.youtube?.liveChatId) startChatPoll(run.id);
  }
  if (runs.length) log(TAG, `rearmed ${runs.length} live run(s)`);
}
