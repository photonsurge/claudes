/**
 * YouTube Live control for the streaming-runs feature. Wraps googleapis'
 * liveBroadcasts / liveStreams / liveChatMessages behind a small typed surface
 * the run orchestrator uses to create → bind → transition a broadcast and read
 * chat + health.
 *
 * Auth: OAuth2 with a stored REFRESH token (google-auth-library auto-mints access
 * tokens on demand). The refresh token is decrypted from Mongo via ../.../secretbox
 * — WORKER ONLY; `public` never sees it (it delegates the code→token exchange to
 * `exchangeAuthCode` here). Config (`YOUTUBE_CLIENT_ID/SECRET/REDIRECT_URI`) comes
 * from env; if unset every call throws `YoutubeNotConfiguredError` so scheduling
 * can no-op cleanly.
 */
import { google, youtube_v3 } from "googleapis";
import { getAppDb } from "@photonsurge/shared/db/index";
import { encryptSecret, decryptSecret } from "@photonsurge/shared/utill/secretbox";
import { YOUTUBE_OAUTH_SCOPES, type YoutubePrivacy } from "@photonsurge/shared/runs";
import { log } from "@photonsurge/shared/utill/logger";

const TAG = "youtube";

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
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

export interface YoutubeCtx {
  youtube: youtube_v3.Youtube;
  accountId: string;
  channelId?: string;
}

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
  oauth2.setCredentials({ refresh_token: decryptSecret(account.refreshTokenEnc) });
  // Google rarely rotates the refresh token, but persist it if it does.
  oauth2.on("tokens", (tokens) => {
    if (tokens.refresh_token) {
      db.saveYoutubeAccount({ id: account.id, refreshTokenEnc: encryptSecret(tokens.refresh_token) }).catch((err) =>
        log(TAG, "failed to persist rotated refresh token", String(err)),
      );
    }
  });

  const ctx: YoutubeCtx = {
    youtube: google.youtube({ version: "v3", auth: oauth2 }),
    accountId: account.id,
    channelId: account.id,
  };
  clientCache.set(account.id, ctx);
  return ctx;
}

/** Drop a cached client (e.g. after an auth failure forces a reconnect). */
export function clearYoutubeClient(accountId: string): void {
  clientCache.delete(accountId);
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
  const youtube = google.youtube({ version: "v3", auth: oauth2 });
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
  });
  clientCache.delete(channelId);
  log(TAG, "connected channel", channelId, channelTitle);
  return { channelId, channelTitle };
}

// ---- Broadcast + stream lifecycle ----

export async function createBroadcast(
  ctx: YoutubeCtx,
  opts: { title: string; description?: string; privacy: YoutubePrivacy; scheduledStartTime: string; monitorStream: boolean },
): Promise<{ broadcastId: string; watchUrl: string }> {
  const res = await ctx.youtube.liveBroadcasts.insert({
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
  });
  const broadcastId = res.data.id;
  if (!broadcastId) throw new Error("liveBroadcasts.insert returned no id");
  return { broadcastId, watchUrl: `https://youtu.be/${broadcastId}` };
}

export async function createStream(
  ctx: YoutubeCtx,
  opts: { title: string },
): Promise<{ streamId: string; ingestionAddress: string; streamName: string }> {
  const res = await ctx.youtube.liveStreams.insert({
    part: ["snippet", "cdn", "contentDetails"],
    requestBody: {
      snippet: { title: opts.title },
      cdn: { ingestionType: "rtmp", resolution: "variable", frameRate: "variable" },
      contentDetails: { isReusable: false },
    },
  });
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
  await ctx.youtube.liveBroadcasts.bind({
    part: ["id", "contentDetails"],
    id: broadcastId,
    streamId,
  });
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
  await ctx.youtube.liveBroadcasts.transition({
    part: ["id", "status"],
    id: broadcastId,
    broadcastStatus: status,
  });
}

/** Current broadcast lifecycle status (for idempotent, resumable transitions). */
export async function getBroadcastLifeCycle(ctx: YoutubeCtx, broadcastId: string): Promise<LifeCycleStatus | undefined> {
  const res = await ctx.youtube.liveBroadcasts.list({ part: ["status"], id: [broadcastId] });
  return res.data.items?.[0]?.status?.lifeCycleStatus as LifeCycleStatus | undefined;
}

/** Ingest + health of the bound stream. `streamStatus === "active"` means bytes are flowing. */
export async function getStreamStatus(
  ctx: YoutubeCtx,
  streamId: string,
): Promise<{ streamStatus?: string; health?: "good" | "ok" | "bad" | "noData" }> {
  const res = await ctx.youtube.liveStreams.list({ part: ["status"], id: [streamId] });
  const status = res.data.items?.[0]?.status;
  return {
    streamStatus: status?.streamStatus ?? undefined,
    health: (status?.healthStatus?.status as "good" | "ok" | "bad" | "noData" | undefined) ?? undefined,
  };
}

export async function resolveLiveChatId(ctx: YoutubeCtx, broadcastId: string): Promise<string | undefined> {
  const res = await ctx.youtube.liveBroadcasts.list({ part: ["snippet"], id: [broadcastId] });
  return res.data.items?.[0]?.snippet?.liveChatId ?? undefined;
}

/** Delete an abandoned broadcast (cleanup after a failed, non-resumable go-live). */
export async function deleteBroadcast(ctx: YoutubeCtx, broadcastId: string): Promise<void> {
  await ctx.youtube.liveBroadcasts.delete({ id: broadcastId });
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
  const res = await ctx.youtube.liveChatMessages.list({
    liveChatId,
    part: ["snippet", "authorDetails"],
    pageToken,
    maxResults: 200,
  });
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
