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
 * `YOUTUBE_CHAT_POLL_MIN_MS` floor, the quota-derived floor from
 * ../youtube/quota, and the stream's own `chat.pollEveryMs` setting (read live
 * from its slot for a constant stream, so an edit applies within
 * SETTING_RECHECK_MS without a restart) — chat is by far the biggest spender of the 10k/day API
 * quota, and left at the server's 2–5 s it empties the quota within hours,
 * taking go-live/end with it. Errors back off by kind: a spent quota pauses
 * until the reset, a dead token waits for a reconnect, transport blips retry.
 *
 * A slow poll returns minutes of chat at once, so command handling runs on a
 * coalesced batch (one vote per viewer, one winner per command — see
 * chat-coalesce.ts) and the replies are packed into as few posts as fit.
 *
 * Chat is OPERATOR-ONLY (a /control panel), never rendered on /watch by default
 * (docs/streaming-runs-plan.md decision 4).
 */
import { getAppDb } from "@photonsurge/shared/db/index";
import { CHAT_MESSAGE, type ChatMessage } from "@photonsurge/shared/runs";
import { log } from "@photonsurge/shared/utill/logger";
import { emitWorkerEvent } from "../socket";
import { startMonitor, stopMonitor } from "./monitor";
import { commandReplies, MAX_REPLIES_PER_BATCH } from "./chat-commands";
import { coalesceCommands, packReplies } from "./chat-coalesce";
import { defaultHandlerDeps, handleChatBatch } from "./chat-handler";
import {
  CHAT_MESSAGE_MAX_LEN,
  getYoutubeClient,
  listChat,
  sendChatMessage,
  youtubeErrorKind,
} from "../youtube/client";
import { CHAT_PAUSE_MAX_MS, chatPacing, fmtResetTime } from "../youtube/quota";

const TAG = "stream-chat";
const chatKey = (runId: string) => `chat:${runId}`;

/** Hard floor on the poll interval regardless of what YouTube suggests. */
const CHAT_POLL_MIN_MS = Number(process.env.YOUTUBE_CHAT_POLL_MIN_MS || 2_000);
const ERROR_BACKOFF_MS = 5_000; // generic failure
const TRANSIENT_BACKOFF_MS = 15_000; // timeout / network / rate-limit
const AUTH_BACKOFF_MS = 5 * 60_000; // token dead — nothing to do until the operator reconnects
/** Longest sleep while waiting out a slow `pollEveryMs`, so a changed setting lands promptly. */
const SETTING_RECHECK_MS = 30_000;

// Per-run continuation token. Its PRESENCE also marks "we've polled once", so the
// first (backlog) page is skipped for display — only messages arriving after we
// start stream to the operator panel; the log still records the backlog.
const pageTokens = new Map<string, string | undefined>();
// Runs currently polling — the quota pacing splits the chat budget across them.
const polling = new Set<string>();
// When each run last called liveChatMessages.list (gates the `pollEveryMs` setting).
const lastPollAt = new Map<string, number>();
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
  lastPollAt.delete(runId);
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

  // The operator's poll interval — a constant stream's slot is the live source of truth.
  const slot = run.slotId ? await db.getStreamSlot(run.slotId) : null;
  const pollEveryMs = (slot ? slot.chat?.pollEveryMs : run.chat?.pollEveryMs) || 0;
  const sincePoll = Date.now() - (lastPollAt.get(runId) ?? -Infinity);
  if (pollEveryMs && sincePoll < pollEveryMs) return Math.min(pollEveryMs - sincePoll, SETTING_RECHECK_MS);

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
    lastPollAt.set(runId, Date.now());
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
      // The info commands always answer; viewer requests (music, palette, …)
      // act on the channel and answer in chat only when its policy says so.
      try {
        const info = await commandReplies(run, msgs);
        const viewer = await handleChatBatch(
          run.sceneId,
          coalesceCommands(msgs).map((m) => ({
            author: m.author,
            text: m.text,
            isMod: m.isMod,
            isOwner: m.isOwner,
            platform: m.platform,
          })),
          await defaultHandlerDeps(),
        );
        const replies = packReplies(
          [...info, ...(viewer.replyInChat ? viewer.replies : [])],
          CHAT_MESSAGE_MAX_LEN,
          MAX_REPLIES_PER_BATCH,
        );
        for (const text of replies) await sendChatMessage(ctx, yt.liveChatId, text);
      } catch (err) {
        log(TAG, `command reply failed ${runId}`, String((err as Error)?.message ?? err));
      }
    }
    // A slow `pollEveryMs` is enforced by the gate above (rechecked every
    // SETTING_RECHECK_MS); this is the fastest YouTube + the quota allow.
    return Math.max(CHAT_POLL_MIN_MS, page.pollingIntervalMillis, pacing.floorMs, Math.min(pollEveryMs, SETTING_RECHECK_MS));
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
