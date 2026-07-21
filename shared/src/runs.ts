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
  /** null / omitted = unbounded (manual stop only). */
  durationMs?: number | null;
  title?: string;
  privacy?: YoutubePrivacy;
  /** Which platforms to bind. `youtube:true` publishes; twitch/kick are chat-only logins. */
  platforms?: { youtube?: boolean; twitch?: string; kick?: string };
  /** Keep YouTube's monitor stream (preview) — forces the testing→live path. */
  monitorStream?: boolean;
  chat?: { enabled?: boolean; promoteToTicker?: boolean };
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
    error: run.error ?? null,
    updated: run.updated ? new Date(run.updated).toISOString() : undefined,
  };
}
