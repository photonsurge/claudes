/**
 * Streaming-runs contract — shared by the worker (which owns the OBS + YouTube
 * lifecycle), the socket relay, /control (operator StreamPanel), and /admin/streams.
 *
 * A "run" is a bounded-lifetime live broadcast bound to an existing scene: it can
 * publish the scene's /watch capture to YouTube and monitor platform chat, then
 * auto-end (or be stopped). Scenes stay permanent config; runs are the ephemeral
 * layer on top. See docs/streaming-runs-plan.md.
 *
 * Realtime flow mirrors DIRECTOR_STATE: the worker emits these over the existing
 * `worker:event` relay (emitWorkerEvent), fanned out to every browser under
 * `payload.type`. Because that fan-out reaches ALL browsers (incl. anonymous
 * /watch viewers), the socket projection is DELIBERATELY SECRET-FREE — the RTMP
 * stream key never travels here; it is served only from the admin `/api/streams`
 * surface. Use `toRunState` to project a Run doc before emitting.
 */

/** Worker → every browser: a run's lifecycle changed (secret-free projection). */
export const RUN_STATE = "run:state" as const;
/** Worker → every browser: a live run's health sample (OBS bitrate + YouTube health). Ephemeral. */
export const RUN_STATUS = "run:status" as const;
/** Worker/socket → every browser: one live-platform chat message. Ephemeral, operator-only UI. */
export const CHAT_MESSAGE = "chat:message" as const;

export type RunStatus =
  | "scheduled" // doc created, go-live job enqueued, nothing external yet
  | "awaiting-ingest" // bound to YouTube; waiting for OBS/RTMP bytes (OBS unreachable or not started)
  | "live" // confirmed active + transitioned to live
  | "ending" // finish in progress (transition→complete + OBS stop)
  | "ended" // finished by auto-end (duration elapsed)
  | "stopped" // finished by operator
  | "failed"; // a platform binding step errored (see `error`)

/** Fine-grained progress within goLive, so a resumed job can skip completed steps. */
export type RunPhase =
  | "created"
  | "broadcast" // YouTube liveBroadcast inserted
  | "stream" // YouTube liveStream inserted (ingestion address + key known)
  | "bound" // broadcast bound to stream
  | "obs-config" // OBS stream service settings pointed at the key
  | "obs-start" // OBS StartStream issued
  | "confirmed" // ingest confirmed active
  | "live"; // transitioned to live

export type StreamPlatform = "youtube" | "twitch" | "kick";
export type YoutubePrivacy = "public" | "unlisted" | "private";

/**
 * The implicit encoder id for the single OBS instance configured by
 * `OBS_WEBSOCKET_URL` — the pre-registry behaviour. Runs with no `encoderId`
 * resolve here, so one env-configured OBS keeps working with zero setup.
 */
export const ENV_ENCODER_ID = "env";

/**
 * An OBS instance the worker can drive. Each instance has exactly ONE streaming
 * output, so concurrent runs need one encoder each — the registry is what makes
 * multi-view (N constant streams) possible. `sceneId` records which scene this
 * instance's browser source captures, letting run-creation auto-pick it.
 */
export interface StreamEncoder {
  id: string;
  name?: string;
  /** obs-websocket v5 endpoint, e.g. ws://127.0.0.1:4455. */
  url: string;
  /** AES-GCM secretbox blob of the websocket password — never sent to clients. */
  passwordEnc?: string;
  /** Scene this OBS instance is pointed at (browser source); auto-picked per run. */
  sceneId?: string;
  /**
   * What the instance is for (short-video plan §6.6). `channels` (the default,
   * today's behaviour) serves channel runs; `videos` is kept for rendered
   * videos: it is bound to no channel, its browser source is pointed at each
   * video's scene as the video starts, and it idles on a blank page between
   * videos. Absent = `channels`.
   */
  use?: EncoderUse;
  enabled: boolean;
  created?: Date;
  updated?: Date;
}

/** What an encoder is assigned to — see `StreamEncoder.use`. */
export type EncoderUse = "channels" | "videos";
export const ENCODER_USES: readonly EncoderUse[] = ["channels", "videos"];

/** An encoder's use, defaulting to `channels`. */
export const encoderUse = (e: Pick<StreamEncoder, "use"> | null | undefined): EncoderUse =>
  e?.use === "videos" ? "videos" : "channels";

/** Client-safe projection of an encoder (no password material). */
export interface StreamEncoderInfo {
  id: string;
  name?: string;
  url: string;
  sceneId?: string;
  /** Always set by `toEncoderInfo`; optional so older payloads still type-check. */
  use?: EncoderUse;
  enabled: boolean;
  hasPassword: boolean;
}

export function toEncoderInfo(e: StreamEncoder): StreamEncoderInfo {
  return {
    id: e.id,
    name: e.name,
    url: e.url,
    sceneId: e.sceneId,
    use: encoderUse(e),
    enabled: !!e.enabled,
    hasPassword: !!e.passwordEnc,
  };
}

/**
 * The encoder a run occupies, for the one-publishing-run-per-encoder guard.
 * Legacy runs (created before the registry) carry no encoderId — they used the
 * env-configured OBS, so they collapse onto ENV_ENCODER_ID.
 */
export function encoderKeyForRun(run: Pick<Run, "encoderId">): string {
  return run.encoderId || ENV_ENCODER_ID;
}

/**
 * Desired-state config for a persistent ("constant") stream: while enabled, the
 * worker reconciler keeps an unbounded run live on this scene/encoder, restarting
 * with backoff whenever the current run dies. Stopping a slot-owned run from the
 * UI disables its slot — otherwise the reconciler would resurrect it.
 */
/**
 * A run's (or constant-stream slot's) chat options. `pollEveryMs` slows the
 * YouTube live-chat poller down to save API quota: every `liveChatMessages.list`
 * costs 5 units whether or not anyone spoke, so the server's suggested 2–5 s
 * cadence is ~90k units/day — 9× the default 10k quota. null / 0 = auto (the
 * quota-paced floor in worker/src/youtube/quota). Commands that pile up between
 * slow polls are coalesced per batch (worker/src/stream/chat-coalesce).
 */
export interface RunChatSettings {
  enabled: boolean;
  promoteToTicker: boolean;
  pollEveryMs?: number | null;
}

/** The poll intervals the admin UI offers (0 = auto / quota-paced). */
export const CHAT_POLL_CHOICES_MS = [0, 15_000, 30_000, 60_000, 120_000, 300_000, 600_000] as const;
/** What a new stream/slot form starts on — every 2 min ≈ 3.6k units/day. */
export const DEFAULT_CHAT_POLL_MS = 120_000;
const CHAT_POLL_MIN_MS = 5_000;
const CHAT_POLL_MAX_MS = 60 * 60_000;

/** Untrusted poll interval → a clamped ms value, or null for auto. */
export function sanitizeChatPollMs(v: unknown): number | null {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(Math.min(CHAT_POLL_MAX_MS, Math.max(CHAT_POLL_MIN_MS, n)));
}

/** Rough YouTube units/day one run's chat polling spends at this interval (5 units a poll). */
export function chatPollUnitsPerDay(pollEveryMs: number): number {
  return Math.round((86_400_000 / pollEveryMs) * 5);
}

/** "2 min", "30 s", "auto" — for the poll-interval pickers. */
export function fmtChatPoll(pollEveryMs?: number | null): string {
  if (!pollEveryMs) return "auto";
  return pollEveryMs < 60_000 ? `${Math.round(pollEveryMs / 1000)} s` : `${+(pollEveryMs / 60_000).toFixed(1)} min`;
}

export interface StreamSlot {
  id: string;
  name?: string;
  sceneId: string;
  /** Pin to an encoder; empty = auto (scene-bound encoder, else the env default). */
  encoderId?: string;
  /** YouTube channel to publish on; empty = the default connected account. */
  accountId?: string;
  /** Title template override; empty = the channel's YouTube title (ControlState.youtube). */
  title?: string;
  privacy?: YoutubePrivacy;
  enabled: boolean;
  monitorStream?: boolean;
  chat?: RunChatSettings;
  /** Recycle cadence: end + relaunch the run every this-many ms; null/0 = never. */
  restartEveryMs?: number | null;
  /** "Notify the world": publish a hydra blog + social fan-out each time a run goes live. */
  announce?: boolean;
  /** The run currently serving this slot (may be finished — reconciler replaces it). */
  runId?: string | null;
  /** Consecutive unhealthy attempts, drives the retry backoff. */
  failCount?: number;
  lastAttemptAt?: number | null;
  created?: Date;
  updated?: Date;
}

/** Minimum gap between slot (re)start attempts; doubles per consecutive failure. */
export const SLOT_RETRY_BASE_MS = 30_000;
export const SLOT_RETRY_MAX_MS = 15 * 60_000;
/** A run live this long proves the slot healthy — the backoff counter resets. */
export const SLOT_HEALTHY_AFTER_MS = 5 * 60_000;
/**
 * Floor for a slot's scheduled-restart interval — must clear the healthy window
 * above, or the restart's attempt bookkeeping would ratchet the backoff forever.
 */
export const SLOT_RESTART_MIN_MS = 10 * 60_000;

export function slotRetryDelayMs(failCount: number): number {
  const n = Math.max(0, Math.floor(failCount));
  return Math.min(SLOT_RETRY_BASE_MS * 2 ** n, SLOT_RETRY_MAX_MS);
}

/**
 * OAuth scopes required to create/bind/transition live broadcasts and read+post
 * live chat. Shared so `public` (builds the consent URL) and `worker` (exchanges
 * the code) agree — `public` can't import from `worker`.
 */
export const YOUTUBE_OAUTH_SCOPES = [
  "https://www.googleapis.com/auth/youtube",
  "https://www.googleapis.com/auth/youtube.force-ssl",
] as const;

/** YouTube binding persisted on a run. `streamName` (the key) is SECRET — admin-only. */
export interface YoutubeBinding {
  accountId?: string;
  channelId?: string;
  broadcastId?: string;
  streamId?: string;
  liveChatId?: string;
  /** RTMP ingestion server URL (not secret). */
  ingestionAddress?: string;
  /** RTMP stream key — SECRET. Never include in a socket payload; admin API only. */
  streamName?: string;
  /** When true the broadcast keeps YouTube's monitor stream, forcing ready→testing→live. */
  monitorStream?: boolean;
  /** Public watch URL, derived from broadcastId. */
  watchUrl?: string;
  /**
   * YouTube's own go-live / end instants (epoch ms, from
   * videos.list liveStreamingDetails.actualStartTime/EndTime) — the VOD's time
   * base, so as-run cuts can be placed at `t=` offsets in the archived video.
   * Stamped by the worker once seen (stats poll + finishRun); absent until then.
   */
  actualStartTime?: number | null;
  actualEndTime?: number | null;
}

export interface TwitchBinding {
  channelLogin: string;
  chatOnly: true;
}
export interface KickBinding {
  channelSlug: string;
  chatOnly: true;
}

export interface RunPlatforms {
  youtube?: YoutubeBinding;
  twitch?: TwitchBinding;
  kick?: KickBinding;
}

/** Live OBS encoder state carried on the run (for health deltas + the UI). */
export interface RunObsState {
  configured: boolean;
  streaming: boolean;
  /** Last GetStreamStatus outputBytes + when — used to compute bitrate deltas. */
  lastBytes?: number;
  lastBytesAt?: number;
}

export interface RunError {
  step: string;
  message: string;
  at: number;
}

/** Outcome of the last chapters publish for a run's video. */
export interface RunChapters {
  /** When the description was last written; null = never (or last attempt failed). */
  publishedAt: number | null;
  /** Chapter lines written. */
  count: number;
  /** Last failure, cleared on success. */
  error?: string | null;
}

/** Outcome of the thumbnail upload for a run's video (custom thumbnails need a verified channel). */
export interface RunThumbnail {
  /** When the thumbnail was set on YouTube; null = not yet (or last attempt failed). */
  setAt: number | null;
  /** The image source that was uploaded (URL / path / "default"). */
  source?: string;
  /** Last failure, cleared on success. */
  error?: string | null;
}

/**
 * A run that renders a scripted short video (short-video plan §6.4-6.5): it goes
 * live on the script's scene, plays the script once and ends. Set by the render
 * queue (worker/src/stream/render-queue.ts) when it creates the run; the hooks
 * in worker/src/stream/script-run.ts move it along. Always written whole.
 */
export interface RunScript {
  scriptId: string;
  /** The ShortRender this run makes. */
  renderId?: string;
  scheduleId?: string;
  /** A rehearsal with no YouTube (§7, WP8). */
  offline: boolean;
  /** The privacy applied when the run ends (a render always streams unlisted). */
  publishAs: YoutubePrivacy;
  /** The director play nonce, stored once the script has been started. */
  playNonce?: number | null;
  /** When goLive began working on the run: the go-live deadline counts from here. */
  goLiveAt?: number | null;
  /** Time between going live and starting the script, and after it ends. */
  leadInMs: number;
  leadOutMs: number;
  /** How the play ended: `finished` ran to its last clip; `stopped` was cut short. */
  playEnded?: "finished" | "stopped" | null;
  /** Applied in ONE ordered finalize step at the end, before chapters (§13). */
  tags?: string[];
  categoryId?: string;
  playlistId?: string;
  /** Write the as-run chapters after finalize (the format's `video.chapters`). */
  chapters?: boolean;
  /** The resolved thumbnail image URL or site path; absent = no custom thumbnail. */
  thumbnailUrl?: string;
  /** A frame thumbnail (§6.8): taken from OBS this many ms into the script's
   *  play during a live render, then uploaded like an image. Set instead of
   *  `thumbnailUrl`. */
  thumbnailFrameAtMs?: number;
  /** Finalize outcome: when it completed, the playlist add, and the last error. */
  finalizedAt?: number | null;
  playlistAddedAt?: number | null;
  finalizeError?: string | null;
}

/**
 * One OBS screenshot of a video render (§7 "Evidence"): taken at a clip's
 * midpoint, its bytes in the `short-tests` blob namespace under `blobId`.
 * Only the latest test of a script keeps its shots; older ones are deleted.
 */
export interface RunShot {
  /** Index of the clip in the play (the clips that aired, skipped ones left out). */
  clipIndex: number;
  /** The script clip it shows. */
  clipId: string;
  /** When it was taken (wall clock ms). */
  at: number;
  /** Key in the `short-tests` blob namespace; absent when the capture failed. */
  blobId?: string;
  /** Why there is no image (OBS unreachable, no blob folder…). */
  error?: string;
}

/** True when a run renders a scripted video. */
export const isScriptRun = (run: Pick<Run, "script"> | null | undefined): boolean => !!run?.script?.scriptId;

/** The full persisted run document (Mongo). Superset of the socket projection. */
export interface Run {
  id: string;
  sceneId: string;
  /** Encoder this run publishes through (registry id, or ENV_ENCODER_ID / unset = env OBS). */
  encoderId?: string;
  /** Set when a persistent StreamSlot started this run (reconciler-owned). */
  slotId?: string;
  status: RunStatus;
  phase?: RunPhase;
  /** Broadcast title — the run/slot override until go-live, the resolved text after. */
  title?: string;
  /** Broadcast description as created on YouTube (resolved from the channel's template at go-live). */
  description?: string;
  privacy?: YoutubePrivacy;
  /** Wall-clock ms the run went (or will go) live. */
  startAt?: number | null;
  /** Bounded duration in ms; null = unbounded (manual stop only). */
  durationMs?: number | null;
  endedAt?: number | null;
  platforms: RunPlatforms;
  obs?: RunObsState;
  chat?: RunChatSettings;
  /** "Notify the world" at go-live: hydra blog post + social fan-out with the watch URL. */
  announce?: boolean;
  /** Set once the hydra announcement has been posted (idempotency for retries). */
  announcedAt?: number | null;
  /** Last hydra announce outcome when it did NOT post: attempt count, reason, HTTP status (cleared on success). */
  announceError?: { at: number; attempts: number; message: string; status?: number } | null;
  /** YouTube chapters (the as-run digest) written into the video description — docs/vod-as-run-plan.md §4. */
  chapters?: RunChapters | null;
  /** Custom thumbnail upload outcome (set right after the broadcast is created). */
  thumbnail?: RunThumbnail | null;
  /** Set when the run renders a scripted video (§6.4). */
  script?: RunScript | null;
  /** OBS screenshots, one per clip, of an offline test (or a live render with
   *  RENDER_SHOTS_LIVE on) — §7. Emptied when a newer test of the script lands. */
  shots?: RunShot[] | null;
  error?: RunError | null;
  createdBy?: string;
  /** Managed by Mongo timestamps (Date at rest); present on persisted docs. */
  created?: Date;
  updated?: Date;
}

/**
 * Secret-free projection broadcast over the socket. Same as `Run` minus the RTMP
 * stream key; adds `needsManualObs` so the operator UI can prompt a manual OBS
 * key paste (the key itself is then fetched from the admin API).
 */
export interface RunState {
  id: string;
  sceneId: string;
  encoderId?: string;
  slotId?: string;
  status: RunStatus;
  phase?: RunPhase;
  title?: string;
  description?: string;
  privacy?: YoutubePrivacy;
  startAt?: number | null;
  durationMs?: number | null;
  endedAt?: number | null;
  youtube?: {
    channelId?: string;
    broadcastId?: string;
    ingestionAddress?: string;
    watchUrl?: string;
    monitorStream?: boolean;
    actualStartTime?: number | null;
    actualEndTime?: number | null;
    /** Whether a YouTube binding exists at all. */
    bound: boolean;
  };
  obs?: { configured: boolean; streaming: boolean };
  /** True when OBS is unreachable/unstarted and the operator must paste the key manually. */
  needsManualObs: boolean;
  chat?: RunChatSettings;
  announce?: boolean;
  announcedAt?: number | null;
  announceError?: Run["announceError"];
  chapters?: RunChapters | null;
  thumbnail?: RunThumbnail | null;
  /** Present on a video render: which script and render, and the end privacy. */
  script?: { scriptId: string; renderId?: string; offline: boolean; publishAs: YoutubePrivacy } | null;
  /** The render's OBS screenshots (§7), when it took any. */
  shots?: RunShot[] | null;
  error?: RunError | null;
  updated?: string;
}

/** Ephemeral health sample for a live run (mirrors DIRECTOR_STATE cadence). */
export interface StreamHealth {
  runId: string;
  sceneId: string;
  obs?: {
    active?: boolean;
    kbps?: number;
    droppedRatio?: number;
    durationSec?: number;
    congestion?: number;
    reconnecting?: boolean;
  };
  youtube?: {
    health?: "good" | "ok" | "bad" | "noData";
    streamStatus?: string;
  };
  at: number;
}

/** Normalised chat message — both YouTube poll + (later) Twitch/Kick push funnel into this. */
export interface ChatMessage {
  runId: string;
  sceneId: string;
  platform: StreamPlatform;
  id: string;
  author: string;
  text: string;
  ts: number;
  isMod?: boolean;
  isOwner?: boolean;
  authorPhoto?: string;
  /** Formatted super-chat amount (e.g. "$5.00"), if this is a paid message. */
  superchatAmount?: string;
}

/** Body accepted by POST /api/streams to create + start a run. */
export interface CreateRunRequest {
  sceneId: string;
  /** Explicit encoder pick; omitted = auto (scene-bound encoder, else env OBS). */
  encoderId?: string;
  /** YouTube channel to publish on; omitted = the default connected account. */
  accountId?: string;
  /** null / omitted = unbounded (manual stop only). */
  durationMs?: number | null;
  /** Title template override; omitted = the channel's YouTube title (ControlState.youtube). */
  title?: string;
  privacy?: YoutubePrivacy;
  /** Which platforms to bind. `youtube:true` publishes; twitch/kick are chat-only logins. */
  platforms?: { youtube?: boolean; twitch?: string; kick?: string };
  /** Keep YouTube's monitor stream (preview) — forces the testing→live path. */
  monitorStream?: boolean;
  chat?: { enabled?: boolean; promoteToTicker?: boolean; pollEveryMs?: number | null };
  /** "Notify the world" at go-live (hydra blog + social fan-out with the watch URL). */
  announce?: boolean;
}

const RUNNING_STATUSES: RunStatus[] = ["scheduled", "awaiting-ingest", "live", "ending"];
/** True while a run still owns its scene (blocks a second concurrent run there). */
export function runIsActive(status: RunStatus): boolean {
  return RUNNING_STATUSES.includes(status);
}

/** True once a run has reached a terminal state. */
export function runIsFinished(status: RunStatus): boolean {
  return status === "ended" || status === "stopped" || status === "failed";
}

/** Public YouTube live-chat popout URL for a broadcast (the broadcast id IS the
 *  watch-page video id). Secret-free — safe for anonymous surfaces. */
export function youtubeChatUrl(broadcastId?: string | null): string | null {
  return broadcastId
    ? `https://www.youtube.com/live_chat?is_popout=1&v=${encodeURIComponent(broadcastId)}`
    : null;
}

/**
 * Project a persisted Run into the secret-free RunState for the socket. Strips
 * the RTMP stream key; keeps the (non-secret) ingestion address + watch URL.
 */
export function toRunState(run: Run): RunState {
  const yt = run.platforms?.youtube;
  const obs = run.obs;
  const needsManualObs =
    (run.status === "awaiting-ingest" || (!!yt && !obs?.streaming)) && (!obs || !obs.configured);
  return {
    id: run.id,
    sceneId: run.sceneId,
    encoderId: run.encoderId,
    slotId: run.slotId,
    status: run.status,
    phase: run.phase,
    title: run.title,
    description: run.description,
    privacy: run.privacy,
    startAt: run.startAt ?? null,
    durationMs: run.durationMs ?? null,
    endedAt: run.endedAt ?? null,
    youtube: yt
      ? {
          channelId: yt.channelId,
          broadcastId: yt.broadcastId,
          ingestionAddress: yt.ingestionAddress,
          watchUrl: yt.watchUrl,
          monitorStream: yt.monitorStream,
          actualStartTime: yt.actualStartTime ?? null,
          actualEndTime: yt.actualEndTime ?? null,
          bound: !!yt.broadcastId,
        }
      : undefined,
    obs: obs ? { configured: !!obs.configured, streaming: !!obs.streaming } : undefined,
    needsManualObs,
    chat: run.chat,
    announce: run.announce,
    announcedAt: run.announcedAt ?? null,
    announceError: run.announceError ?? null,
    chapters: run.chapters ?? null,
    thumbnail: run.thumbnail ?? null,
    script: run.script?.scriptId
      ? {
          scriptId: run.script.scriptId,
          renderId: run.script.renderId,
          offline: !!run.script.offline,
          publishAs: run.script.publishAs,
        }
      : null,
    shots: run.shots?.length ? run.shots : null,
    error: run.error ?? null,
    updated: run.updated ? new Date(run.updated).toISOString() : undefined,
  };
}
