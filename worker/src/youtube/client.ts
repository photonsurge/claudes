/**
 * YouTube Live control for the streaming-runs feature. Wraps googleapis'
 * liveBroadcasts / liveStreams / liveChatMessages behind a small typed surface
 * the run orchestrator uses to create → bind → transition a broadcast and read
 * chat + health.
 *
 * Auth: OAuth2 with a stored REFRESH token. google-auth-library mints (and
 * re-mints) short-lived access tokens on demand — there is nothing to schedule:
 * a token within 5 min of expiry is refreshed before the call, and
 * `forceRefreshOnFailure` retries once after a refresh when Google answers 401/403
 * anyway (clock skew, early revocation). The refresh token is decrypted from Mongo
 * via secretbox — WORKER ONLY; `public` never sees it (it delegates the code→token
 * exchange to `exchangeAuthCode` here).
 *
 * Every API call goes through `apiCall`, which
 *  - bounds the request (YOUTUBE_API_TIMEOUT_MS, default 20 s — a hung call would
 *    otherwise stall a run's monitor, which only re-arms after its tick resolves);
 *  - meters units against the daily quota (./quota) and, on `quotaExceeded`, blocks
 *    further calls until the Pacific-midnight reset instead of failing each tick;
 *  - on `invalid_grant` (refresh token expired/revoked) evicts the cached client and
 *    stamps `authError` on the account so /admin/youtube shows "needs reconnect".
 *
 * Config (`GOOGLE_OAUTH_CLIENT_ID/SECRET/REDIRECT_URI`) comes from env; if unset
 * every call throws `YoutubeNotConfiguredError` so scheduling can no-op cleanly.
 */
import { google, youtube_v3 } from "googleapis";
import { getAppDb } from "@photonsurge/shared/db/index";
import { encryptSecret, decryptSecret } from "@photonsurge/shared/utill/secretbox";
import { YOUTUBE_OAUTH_SCOPES, type YoutubePrivacy } from "@photonsurge/shared/runs";
import { log } from "@photonsurge/shared/utill/logger";
import { classifyYoutubeError, type YoutubeErrorInfo, type YoutubeErrorKind } from "./errors";
import {
  exhaustedUntil,
  fmtResetTime,
  markExhausted,
  nextPacificMidnight,
  quotaSnapshot,
  spend,
  type QuotaSnapshot,
  type YoutubeOp,
} from "./quota";

const TAG = "youtube";

/** Upper bound on any single YouTube / token-endpoint request. */
export const API_TIMEOUT_MS = Number(process.env.YOUTUBE_API_TIMEOUT_MS || 20_000);
// How often a healthy call re-stamps `lastOkAt` on the account (one Mongo write).
const OK_STAMP_EVERY_MS = 10 * 60_000;

export class YoutubeNotConfiguredError extends Error {
  constructor(message = "YouTube OAuth is not configured (set GOOGLE_OAUTH_CLIENT_ID/GOOGLE_OAUTH_SECRET/GOOGLE_OAUTH_REDIRECT_URI)") {
    super(message);
    this.name = "YoutubeNotConfiguredError";
  }
}
export class YoutubeNotConnectedError extends Error {
  constructor(message = "No connected YouTube channel (connect one in /admin/streams)") {
    super(message);
    this.name = "YoutubeNotConnectedError";
  }
}
/** The project's daily API quota is spent; `resetAt` is the next Pacific midnight. */
export class YoutubeQuotaExceededError extends Error {
  readonly kind: YoutubeErrorKind = "quota";
  constructor(
    readonly resetAt: number,
    op: string,
    detail?: string,
  ) {
    super(
      `YouTube API daily quota exhausted (${op}) — calls resume at ${fmtResetTime(resetAt)}` +
        (detail ? `: ${detail}` : "") +
        ". Raise YOUTUBE_QUOTA_DAILY once Google grants more, or lower chat polling.",
    );
    this.name = "YoutubeQuotaExceededError";
  }
}
/** Google refused the stored refresh token (`invalid_grant`) — the channel must be reconnected. */
export class YoutubeAuthRevokedError extends Error {
  readonly kind: YoutubeErrorKind = "auth-revoked";
  constructor(detail?: string) {
    super(
      "YouTube authorization expired or was revoked" +
        (detail ? ` (${detail})` : "") +
        " — reconnect the channel in /admin/youtube (a consent screen still in \"Testing\" expires tokens after 7 days)",
    );
    this.name = "YoutubeAuthRevokedError";
  }
}

/**
 * OAuth app credentials. Primary names are the generic `GOOGLE_OAUTH_*` (the client
 * is shared with the other photonsurge apps on the same consent screen); the
 * `YOUTUBE_*` names are accepted as a fallback.
 */
export function googleOauthConfig() {
  return {
    clientId: process.env.GOOGLE_OAUTH_CLIENT_ID || process.env.YOUTUBE_CLIENT_ID || "",
    clientSecret: process.env.GOOGLE_OAUTH_SECRET || process.env.YOUTUBE_CLIENT_SECRET || "",
    redirectUri: process.env.GOOGLE_OAUTH_REDIRECT_URI || process.env.YOUTUBE_REDIRECT_URI || "",
  };
}

export function youtubeConfigured(): boolean {
  const { clientId, clientSecret } = googleOauthConfig();
  return !!(clientId && clientSecret);
}

// Use googleapis' bundled google-auth-library type (google.youtube expects that
// exact copy — a directly-imported google-auth-library is a different declaration).
type OAuth2 = InstanceType<typeof google.auth.OAuth2>;

function newOAuthClient(): OAuth2 {
  const { clientId, clientSecret, redirectUri } = googleOauthConfig();
  if (!clientId || !clientSecret) throw new YoutubeNotConfiguredError();
  return new google.auth.OAuth2({
    clientId,
    clientSecret,
    redirectUri,
    // Retry once after a forced refresh when a call 401/403s despite an unexpired-
    // looking token (skew / server-side revocation). Without it such a call fails
    // until expiry_date passes — up to an hour of "auth broken".
    forceRefreshOnFailure: true,
    // The token-endpoint POST gets the same bound as API calls.
    transporterOptions: { timeout: API_TIMEOUT_MS },
  });
}

export interface YoutubeCtx {
  youtube: youtube_v3.Youtube;
  accountId: string;
  channelId?: string;
  /** The auth client behind `youtube` (diagnostics mint a token through it). */
  oauth2?: OAuth2;
}

// Per-ctx bookkeeping kept off the public shape (tests build bare ctx objects).
interface CtxState {
  /** The account doc carried an `authError` when loaded — clear it on the next success. */
  clearAuthError: boolean;
  lastOkStamp: number;
}
const ctxState = new WeakMap<YoutubeCtx, CtxState>();

// One OAuth2 client per accountId, so the access token is reused across a run's
// many calls instead of re-minted each time.
const clientCache = new Map<string, YoutubeCtx>();

/**
 * Authed YouTube client for a connected channel. Without `accountId`, uses the
 * most-recently connected channel (single-channel default). Throws if not
 * configured / not connected.
 */
export async function getYoutubeClient(accountId?: string): Promise<YoutubeCtx> {
  if (!youtubeConfigured()) throw new YoutubeNotConfiguredError();
  const db = await getAppDb();
  const account = await db.getYoutubeAccount(accountId);
  if (!account || !account.refreshTokenEnc) throw new YoutubeNotConnectedError();

  const cached = clientCache.get(account.id);
  if (cached) return cached;

  const oauth2 = newOAuthClient();
  let refreshToken: string;
  try {
    refreshToken = decryptSecret(account.refreshTokenEnc);
  } catch (err) {
    throw new YoutubeNotConnectedError(
      `stored YouTube token can't be decrypted (${String((err as Error)?.message ?? err)}) — APP_SECRET changed? Reconnect the channel in /admin/youtube`,
    );
  }
  oauth2.setCredentials({ refresh_token: refreshToken });
  // Google rarely rotates the refresh token, but persist it if it does.
  oauth2.on("tokens", (tokens) => {
    if (tokens.refresh_token) {
      db.saveYoutubeAccount({ id: account.id, refreshTokenEnc: encryptSecret(tokens.refresh_token) }).catch((err) =>
        log(TAG, "failed to persist rotated refresh token", String(err)),
      );
    }
  });

  const ctx: YoutubeCtx = {
    youtube: google.youtube({ version: "v3", auth: oauth2, timeout: API_TIMEOUT_MS }),
    accountId: account.id,
    channelId: account.id,
    oauth2,
  };
  ctxState.set(ctx, { clearAuthError: !!account.authError, lastOkStamp: 0 });
  clientCache.set(account.id, ctx);
  return ctx;
}

/** Drop a cached client (e.g. after an auth failure forces a reconnect). */
export function clearYoutubeClient(accountId: string): void {
  clientCache.delete(accountId);
}

// ---- The guarded call path every API function uses ----

async function noteAuthRevoked(ctx: YoutubeCtx, info: YoutubeErrorInfo): Promise<void> {
  clearYoutubeClient(ctx.accountId);
  log(TAG, `channel ${ctx.accountId}: refresh token rejected (${info.message}) — reconnect it in /admin/youtube`);
  try {
    const db = await getAppDb();
    await db.saveYoutubeAccount({
      id: ctx.accountId,
      authError: { kind: info.kind, message: info.message.slice(0, 300), at: Date.now() },
    });
  } catch (err) {
    log(TAG, "failed to persist authError", String((err as Error)?.message ?? err));
  }
}

/** Throttled "still healthy" stamp; also clears a stale authError after a reconnect. */
function noteOk(ctx: YoutubeCtx): void {
  const st = ctxState.get(ctx);
  if (!st) return;
  const now = Date.now();
  if (!st.clearAuthError && now - st.lastOkStamp < OK_STAMP_EVERY_MS) return;
  st.clearAuthError = false;
  st.lastOkStamp = now;
  getAppDb()
    .then((db) => db.saveYoutubeAccount({ id: ctx.accountId, authError: null, lastOkAt: now }))
    .catch((err) => log(TAG, "failed to stamp lastOkAt", String((err as Error)?.message ?? err)));
}

/**
 * Run one YouTube API call with the timeout/quota/auth policy applied. `op` is
 * the metered method name; the callback does the actual googleapis call.
 */
export async function apiCall<T>(ctx: YoutubeCtx, op: YoutubeOp, fn: () => Promise<T>): Promise<T> {
  const blockedUntil = await exhaustedUntil(ctx.accountId);
  if (blockedUntil) throw new YoutubeQuotaExceededError(blockedUntil, op);
  try {
    const out = await fn();
    spend(ctx.accountId, op).catch(() => {});
    noteOk(ctx);
    return out;
  } catch (err) {
    spend(ctx.accountId, op).catch(() => {}); // Google bills failed calls too
    const info = classifyYoutubeError(err);
    if (info.kind === "quota") {
      const until = nextPacificMidnight();
      await markExhausted(ctx.accountId, until).catch(() => {});
      log(TAG, `channel ${ctx.accountId}: daily API quota exhausted at ${op} — blocking calls until ${fmtResetTime(until)}`);
      throw new YoutubeQuotaExceededError(until, op, info.message);
    }
    if (info.kind === "auth-revoked") {
      await noteAuthRevoked(ctx, info);
      throw new YoutubeAuthRevokedError(info.message);
    }
    if (err instanceof Error) {
      (err as Error & { kind?: YoutubeErrorKind }).kind = info.kind;
      if (!err.message.startsWith(`${op}:`)) err.message = `${op}: ${err.message}`;
    }
    throw err;
  }
}

/** The classifier's verdict for any error thrown out of this module. */
export function youtubeErrorKind(err: unknown): YoutubeErrorKind {
  const k = (err as { kind?: YoutubeErrorKind } | null)?.kind;
  return k ?? classifyYoutubeError(err).kind;
}

/**
 * Exchange an OAuth authorization code for tokens, identify the channel, and
 * persist the (encrypted) refresh token. Called by the `youtube.exchangeCode`
 * job on behalf of the public /google/redirect route.
 */
export async function exchangeAuthCode(
  code: string,
  connectedBy?: string,
): Promise<{ channelId: string; channelTitle: string }> {
  if (!youtubeConfigured()) throw new YoutubeNotConfiguredError();
  const oauth2 = newOAuthClient();
  const { tokens } = await oauth2.getToken(code);
  if (!tokens.refresh_token) {
    throw new Error("Google returned no refresh token — re-consent with prompt=consent & access_type=offline");
  }
  oauth2.setCredentials(tokens);
  const youtube = google.youtube({ version: "v3", auth: oauth2, timeout: API_TIMEOUT_MS });
  const me = await youtube.channels.list({ part: ["snippet"], mine: true });
  const channel = me.data.items?.[0];
  const channelId = channel?.id;
  if (!channelId) throw new Error("Could not resolve the authorized YouTube channel");
  const channelTitle = channel?.snippet?.title ?? channelId;

  const db = await getAppDb();
  await db.saveYoutubeAccount({
    id: channelId,
    channelTitle,
    refreshTokenEnc: encryptSecret(tokens.refresh_token),
    scopes: [...YOUTUBE_OAUTH_SCOPES],
    connectedAt: Date.now(),
    connectedBy,
    authError: null,
    lastOkAt: Date.now(),
  });
  clientCache.delete(channelId);
  log(TAG, "connected channel", channelId, channelTitle);
  return { channelId, channelTitle };
}

// ---- Diagnostics ----

export interface YoutubeCheckResult {
  ok: boolean;
  configured: boolean;
  /** The stored refresh token still mints access tokens. */
  tokenOk: boolean;
  /** A real (1-unit) Data API call succeeded. */
  apiOk: boolean;
  accountId?: string;
  channelTitle?: string;
  tokenExpiresAt?: number | null;
  quota?: QuotaSnapshot;
  apiTimeoutMs: number;
  error?: string;
  kind?: YoutubeErrorKind;
}

/**
 * Admin "Check connection": mint an access token straight from the stored
 * refresh token (no API quota; exactly the step that fails with `invalid_grant`
 * when the token is dead), then one cheap `channels.list` to prove the Data API
 * is enabled and quota remains. Never throws.
 */
export async function checkYoutubeConnection(accountId?: string): Promise<YoutubeCheckResult> {
  const base = { configured: youtubeConfigured(), apiTimeoutMs: API_TIMEOUT_MS, tokenOk: false, apiOk: false };
  if (!base.configured) return { ok: false, ...base, error: new YoutubeNotConfiguredError().message };
  let ctx: YoutubeCtx;
  try {
    ctx = await getYoutubeClient(accountId);
  } catch (err) {
    return { ok: false, ...base, error: String((err as Error)?.message ?? err), kind: youtubeErrorKind(err) };
  }
  try {
    await ctx.oauth2!.getAccessToken();
  } catch (err) {
    const info = classifyYoutubeError(err);
    if (info.kind === "auth-revoked") await noteAuthRevoked(ctx, info);
    return {
      ok: false,
      ...base,
      accountId: ctx.accountId,
      error: info.kind === "auth-revoked" ? new YoutubeAuthRevokedError(info.message).message : info.message,
      kind: info.kind,
      quota: await quotaSnapshot(ctx.accountId),
    };
  }
  const tokenExpiresAt = ctx.oauth2!.credentials.expiry_date ?? null;
  const result: YoutubeCheckResult = { ok: false, ...base, tokenOk: true, accountId: ctx.accountId, tokenExpiresAt };
  try {
    const me = await apiCall(ctx, "channels.list", () => ctx.youtube.channels.list({ part: ["snippet"], mine: true }));
    result.channelTitle = me.data.items?.[0]?.snippet?.title ?? undefined;
    result.apiOk = true;
  } catch (err) {
    result.error = String((err as Error)?.message ?? err);
    result.kind = youtubeErrorKind(err);
  }
  result.quota = await quotaSnapshot(ctx.accountId);
  result.ok = result.tokenOk && result.apiOk;
  return result;
}

// ---- Broadcast + stream lifecycle ----

export async function createBroadcast(
  ctx: YoutubeCtx,
  opts: { title: string; description?: string; privacy: YoutubePrivacy; scheduledStartTime: string; monitorStream: boolean },
): Promise<{ broadcastId: string; watchUrl: string }> {
  const res = await apiCall(ctx, "liveBroadcasts.insert", () =>
    ctx.youtube.liveBroadcasts.insert({
      part: ["snippet", "contentDetails", "status"],
      requestBody: {
        snippet: {
          title: opts.title,
          description: opts.description,
          scheduledStartTime: opts.scheduledStartTime,
        },
        status: {
          privacyStatus: opts.privacy,
          selfDeclaredMadeForKids: false,
        },
        contentDetails: {
          // Worker drives transitions explicitly; disabling monitor collapses the
          // state machine to ready→live (no mandatory testing hop) and disabling
          // autostart keeps go-live timing deterministic.
          enableAutoStart: false,
          enableAutoStop: false,
          monitorStream: { enableMonitorStream: opts.monitorStream },
        },
      },
    }),
  );
  const broadcastId = res.data.id;
  if (!broadcastId) throw new Error("liveBroadcasts.insert returned no id");
  return { broadcastId, watchUrl: `https://youtu.be/${broadcastId}` };
}

export async function createStream(
  ctx: YoutubeCtx,
  opts: { title: string },
): Promise<{ streamId: string; ingestionAddress: string; streamName: string }> {
  const res = await apiCall(ctx, "liveStreams.insert", () =>
    ctx.youtube.liveStreams.insert({
      part: ["snippet", "cdn", "contentDetails"],
      requestBody: {
        snippet: { title: opts.title },
        cdn: { ingestionType: "rtmp", resolution: "variable", frameRate: "variable" },
        contentDetails: { isReusable: false },
      },
    }),
  );
  const streamId = res.data.id;
  const ingestion = res.data.cdn?.ingestionInfo;
  const ingestionAddress = ingestion?.ingestionAddress;
  const streamName = ingestion?.streamName;
  if (!streamId || !ingestionAddress || !streamName) {
    throw new Error("liveStreams.insert returned no ingestion address/key");
  }
  return { streamId, ingestionAddress, streamName };
}

export async function bindBroadcast(ctx: YoutubeCtx, broadcastId: string, streamId: string): Promise<void> {
  await apiCall(ctx, "liveBroadcasts.bind", () =>
    ctx.youtube.liveBroadcasts.bind({
      part: ["id", "contentDetails"],
      id: broadcastId,
      streamId,
    }),
  );
}

export type LifeCycleStatus =
  | "created"
  | "ready"
  | "testing"
  | "live"
  | "complete"
  | "revoked"
  | "testStarting"
  | "liveStarting";

export async function transitionBroadcast(
  ctx: YoutubeCtx,
  broadcastId: string,
  status: "testing" | "live" | "complete",
): Promise<void> {
  await apiCall(ctx, "liveBroadcasts.transition", () =>
    ctx.youtube.liveBroadcasts.transition({
      part: ["id", "status"],
      id: broadcastId,
      broadcastStatus: status,
    }),
  );
}

/** Current broadcast lifecycle status (for idempotent, resumable transitions). */
export async function getBroadcastLifeCycle(ctx: YoutubeCtx, broadcastId: string): Promise<LifeCycleStatus | undefined> {
  const res = await apiCall(ctx, "liveBroadcasts.list", () =>
    ctx.youtube.liveBroadcasts.list({ part: ["status"], id: [broadcastId] }),
  );
  return res.data.items?.[0]?.status?.lifeCycleStatus as LifeCycleStatus | undefined;
}

/** Ingest + health of the bound stream. `streamStatus === "active"` means bytes are flowing. */
export async function getStreamStatus(
  ctx: YoutubeCtx,
  streamId: string,
): Promise<{ streamStatus?: string; health?: "good" | "ok" | "bad" | "noData" }> {
  const res = await apiCall(ctx, "liveStreams.list", () => ctx.youtube.liveStreams.list({ part: ["status"], id: [streamId] }));
  const status = res.data.items?.[0]?.status;
  return {
    streamStatus: status?.streamStatus ?? undefined,
    health: (status?.healthStatus?.status as "good" | "ok" | "bad" | "noData" | undefined) ?? undefined,
  };
}

export async function resolveLiveChatId(ctx: YoutubeCtx, broadcastId: string): Promise<string | undefined> {
  const res = await apiCall(ctx, "liveBroadcasts.list", () =>
    ctx.youtube.liveBroadcasts.list({ part: ["snippet"], id: [broadcastId] }),
  );
  return res.data.items?.[0]?.snippet?.liveChatId ?? undefined;
}

/** Delete an abandoned broadcast (cleanup after a failed, non-resumable go-live). */
export async function deleteBroadcast(ctx: YoutubeCtx, broadcastId: string): Promise<void> {
  await apiCall(ctx, "liveBroadcasts.delete", () => ctx.youtube.liveBroadcasts.delete({ id: broadcastId }));
}

export interface ChatPage {
  messages: {
    id: string;
    author: string;
    authorChannelId?: string;
    text: string;
    ts: number;
    isMod: boolean;
    isOwner: boolean;
    authorPhoto?: string;
    superchatAmount?: string;
  }[];
  nextPageToken?: string;
  pollingIntervalMillis: number;
}

/** One page of live chat. Returns the server-suggested poll interval for re-scheduling. */
export async function listChat(ctx: YoutubeCtx, liveChatId: string, pageToken?: string): Promise<ChatPage> {
  const res = await apiCall(ctx, "liveChatMessages.list", () =>
    ctx.youtube.liveChatMessages.list({
      liveChatId,
      part: ["snippet", "authorDetails"],
      pageToken,
      maxResults: 200,
    }),
  );
  const messages = (res.data.items ?? []).map((m) => {
    const superChat = m.snippet?.superChatDetails;
    const superSticker = m.snippet?.superStickerDetails;
    return {
      id: m.id ?? "",
      author: m.authorDetails?.displayName ?? "",
      authorChannelId: m.authorDetails?.channelId ?? undefined,
      text: m.snippet?.displayMessage ?? superChat?.userComment ?? "",
      ts: m.snippet?.publishedAt ? new Date(m.snippet.publishedAt).getTime() : Date.now(),
      isMod: !!m.authorDetails?.isChatModerator,
      isOwner: !!m.authorDetails?.isChatOwner,
      authorPhoto: m.authorDetails?.profileImageUrl ?? undefined,
      superchatAmount: superChat?.amountDisplayString ?? superSticker?.amountDisplayString ?? undefined,
    };
  });
  return {
    messages,
    nextPageToken: res.data.nextPageToken ?? undefined,
    pollingIntervalMillis: Number(res.data.pollingIntervalMillis ?? 5000),
  };
}

/** YouTube's hard cap on a live-chat text message. */
export const CHAT_MESSAGE_MAX_LEN = 200;

/**
 * Post a message into a live chat AS the connected channel (the stream owner) —
 * the chat responder's write path. Costs 50 quota units per insert, so callers
 * rate-limit (see stream/chat-commands.ts).
 */
export async function sendChatMessage(ctx: YoutubeCtx, liveChatId: string, text: string): Promise<void> {
  await apiCall(ctx, "liveChatMessages.insert", () =>
    ctx.youtube.liveChatMessages.insert({
      part: ["snippet"],
      requestBody: {
        snippet: {
          liveChatId,
          type: "textMessageEvent",
          textMessageDetails: { messageText: text.slice(0, CHAT_MESSAGE_MAX_LEN) },
        },
      },
    }),
  );
}
