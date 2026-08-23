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
  enabled: boolean;
  created?: Date;
  updated?: Date;
}

/** Client-safe projection of an encoder (no password material). */
export interface StreamEncoderInfo {
  id: string;
  name?: string;
  url: string;
  sceneId?: string;
  enabled: boolean;
  hasPassword: boolean;
}

export function toEncoderInfo(e: StreamEncoder): StreamEncoderInfo {
  return {
    id: e.id,
    name: e.name,
    url: e.url,
    sceneId: e.sceneId,
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
export interface StreamSlot {
  id: string;
  name?: string;
  sceneId: string;
  /** Pin to an encoder; empty = auto (scene-bound encoder, else the env default). */
  encoderId?: string;
  /** YouTube channel to publish on; empty = the default connected account. */
  accountId?: string;
  title?: string;
  privacy?: YoutubePrivacy;
  enabled: boolean;
  monitorStream?: boolean;
  chat?: { enabled: boolean; promoteToTicker: boolean };
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
export const SLOT_RESTART_MIN_MS = 15 * 60_000;

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
  /** Broadcast title (templated from ControlState at go-live time). */
  title?: string;
  privacy?: YoutubePrivacy;
  /** Wall-clock ms the run went (or will go) live. */
  startAt?: number | null;
  /** Bounded duration in ms; null = unbounded (manual stop only). */
  durationMs?: number | null;
  endedAt?: number | null;
  platforms: RunPlatforms;
  obs?: RunObsState;
  chat?: { enabled: boolean; promoteToTicker: boolean };
  /** "Notify the world" at go-live: hydra blog post + social fan-out with the watch URL. */
  announce?: boolean;
  /** Set once the hydra announcement has been posted (idempotency for retries). */
  announcedAt?: number | null;
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
    /** Whether a YouTube binding exists at all. */
    bound: boolean;
  };
  obs?: { configured: boolean; streaming: boolean };
  /** True when OBS is unreachable/unstarted and the operator must paste the key manually. */
  needsManualObs: boolean;
  chat?: { enabled: boolean; promoteToTicker: boolean };
  announce?: boolean;
  announcedAt?: number | null;
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
  title?: string;
  privacy?: YoutubePrivacy;
  /** Which platforms to bind. `youtube:true` publishes; twitch/kick are chat-only logins. */
  platforms?: { youtube?: boolean; twitch?: string; kick?: string };
  /** Keep YouTube's monitor stream (preview) — forces the testing→live path. */
  monitorStream?: boolean;
  chat?: { enabled?: boolean; promoteToTicker?: boolean };
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
          bound: !!yt.broadcastId,
        }
      : undefined,
    obs: obs ? { configured: !!obs.configured, streaming: !!obs.streaming } : undefined,
    needsManualObs,
    chat: run.chat,
    announce: run.announce,
    announcedAt: run.announcedAt ?? null,
    error: run.error ?? null,
    updated: run.updated ? new Date(run.updated).toISOString() : undefined,
  };
}
