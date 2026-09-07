/**
 * YouTube live-chat poller for a run. In-process (keyed `chat:<runId>` in the same
 * monitor registry the health loop uses) so it starts/stops with the run and
 * needs no self-rescheduling BullMQ job. Polls liveChatMessages.list, LOGS every
 * message to Mongo (db.chatLog — idempotent on the platform message id, so
 * restarts/re-polls never duplicate), emits each new message as CHAT_MESSAGE over
 * the worker→browser relay, and ANSWERS viewer commands (":modes" etc. — see
 * chat-commands.ts) by posting back into the chat as the connected channel. The
 * first (backlog) page is logged but neither emitted nor answered — the live
 * panel only shows messages arriving after we start streaming, and a restart
 * must not reply to stale commands.
 *
 * Cadence: the LONGEST of YouTube's suggested `pollingIntervalMillis`, the
 * `YOUTUBE_CHAT_POLL_MIN_MS` floor, and the quota-derived floor from
 * ../youtube/quota — chat is by far the biggest spender of the 10k/day API
 * quota, and left at the server's 2–5 s it empties the quota within hours,
 * taking go-live/end with it. Errors back off by kind: a spent quota pauses
 * until the reset, a dead token waits for a reconnect, transport blips retry.
 *
 * Chat is OPERATOR-ONLY (a /control panel), never rendered on /watch by default
 * (docs/streaming-runs-plan.md decision 4).
 */
import { getAppDb } from "@photonsurge/shared/db/index";
import { CHAT_MESSAGE, type ChatMessage } from "@photonsurge/shared/runs";
import { log } from "@photonsurge/shared/utill/logger";
import { emitWorkerEvent } from "../socket";
import { startMonitor, stopMonitor } from "./monitor";
import { commandReplies } from "./chat-commands";
import { getYoutubeClient, listChat, sendChatMessage, youtubeErrorKind } from "../youtube/client";
import { CHAT_PAUSE_MAX_MS, chatPacing, fmtResetTime } from "../youtube/quota";

const TAG = "stream-chat";
const chatKey = (runId: string) => `chat:${runId}`;

/** Hard floor on the poll interval regardless of what YouTube suggests. */
const CHAT_POLL_MIN_MS = Number(process.env.YOUTUBE_CHAT_POLL_MIN_MS || 2_000);
const ERROR_BACKOFF_MS = 5_000; // generic failure
const TRANSIENT_BACKOFF_MS = 15_000; // timeout / network / rate-limit
const AUTH_BACKOFF_MS = 5 * 60_000; // token dead — nothing to do until the operator reconnects

// Per-run continuation token. Its PRESENCE also marks "we've polled once", so the
// first (backlog) page is skipped for display — only messages arriving after we
// start stream to the operator panel; the log still records the backlog.
const pageTokens = new Map<string, string | undefined>();
// Runs currently polling — the quota pacing splits the chat budget across them.
const polling = new Set<string>();
// Last error kind per run, so a persistent condition logs once, not every tick.
const lastErrorKind = new Map<string, string>();
// Runs whose last tick was a quota pause (log the pause once, and the resume once).
const paused = new Set<string>();

export function startChatPoll(runId: string): void {
  polling.add(runId);
  startMonitor(chatKey(runId), () => chatTick(runId), 1_000);
}

export function stopChatPoll(runId: string): void {
  stopMonitor(chatKey(runId));
  pageTokens.delete(runId);
  polling.delete(runId);
  lastErrorKind.delete(runId);
  paused.delete(runId);
}

function logOnce(runId: string, kind: string, message: string): void {
  if (lastErrorKind.get(runId) === kind) return;
  lastErrorKind.set(runId, kind);
  log(TAG, `poll error ${runId} [${kind}]`, message);
}

async function chatTick(runId: string): Promise<number> {
  const db = await getAppDb();
  const run = await db.getRun(runId);
  if (!run || run.status !== "live" || !run.chat?.enabled) {
    polling.delete(runId);
    return -1; // self-terminate
  }
  const yt = run.platforms?.youtube;
  if (!yt?.liveChatId) return 5_000;

  // Budget check BEFORE the call: a spent quota (or a paced-out budget) means
  // wait, not poll — and say so once, not every tick.
  const pacing = await chatPacing(yt.accountId ?? "default", Math.max(1, polling.size));
  if (pacing.pauseMs) {
    if (!paused.has(runId)) {
      paused.add(runId);
      log(TAG, `chat poll paused ${runId}: daily YouTube quota budget spent — resumes around ${fmtResetTime(Date.now() + pacing.floorMs)}`);
    }
    return Math.max(1_000, Math.min(pacing.pauseMs, CHAT_PAUSE_MAX_MS));
  }
  if (paused.delete(runId)) log(TAG, `chat poll resumed ${runId}`);

  try {
    const ctx = await getYoutubeClient(yt.accountId);
    const first = !pageTokens.has(runId);
    const page = await listChat(ctx, yt.liveChatId, pageTokens.get(runId));
    pageTokens.set(runId, page.nextPageToken);
    lastErrorKind.delete(runId);

    const msgs: ChatMessage[] = page.messages.map((m) => ({
      runId,
      sceneId: run.sceneId,
      platform: "youtube",
      id: m.id,
      author: m.author,
      text: m.text,
      ts: m.ts,
      isMod: m.isMod,
      isOwner: m.isOwner,
      authorPhoto: m.authorPhoto,
      superchatAmount: m.superchatAmount,
    }));

    // Log first — but never let a Mongo hiccup break the live relay.
    if (msgs.length) {
      try {
        await db.chatLog.append(msgs);
      } catch (err) {
        log(TAG, `log append failed ${runId}`, String((err as Error)?.message ?? err));
      }
    }

    if (!first) {
      for (const msg of msgs) emitWorkerEvent({ type: CHAT_MESSAGE, data: msg });
      // Command replies (":modes" etc.) — best-effort; never breaks the poll.
      try {
        for (const text of await commandReplies(run, msgs)) {
          await sendChatMessage(ctx, yt.liveChatId, text);
        }
      } catch (err) {
        log(TAG, `command reply failed ${runId}`, String((err as Error)?.message ?? err));
      }
    }
    return Math.max(CHAT_POLL_MIN_MS, page.pollingIntervalMillis, pacing.floorMs);
  } catch (err) {
    const kind = youtubeErrorKind(err);
    const message = String((err as Error)?.message ?? err);
    logOnce(runId, kind, message);
    switch (kind) {
      case "quota": {
        // The client already blocked calls until the reset; sleep toward it.
        const resetAt = (err as { resetAt?: number })?.resetAt;
        const wait = resetAt ? resetAt - Date.now() : CHAT_PAUSE_MAX_MS;
        return Math.max(ERROR_BACKOFF_MS, Math.min(wait, CHAT_PAUSE_MAX_MS));
      }
      case "auth-revoked":
      case "auth":
        return AUTH_BACKOFF_MS;
      case "timeout":
      case "network":
      case "rate":
        return TRANSIENT_BACKOFF_MS;
      default:
        return ERROR_BACKOFF_MS;
    }
  }
}
