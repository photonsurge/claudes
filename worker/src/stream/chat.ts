/**
 * YouTube live-chat poller for a run. In-process (keyed `chat:<runId>` in the same
 * monitor registry the health loop uses) so it starts/stops with the run and
 * needs no self-rescheduling BullMQ job. Polls liveChatMessages.list at the
 * server-suggested interval, LOGS every message to Mongo (db.chatLog — idempotent
 * on the platform message id, so restarts/re-polls never duplicate), and emits
 * each new message as CHAT_MESSAGE over the worker→browser relay. The first
 * (backlog) page is logged but not emitted — the live panel only shows messages
 * arriving after we start streaming, while the log keeps the full history.
 *
 * Chat is OPERATOR-ONLY (a /control panel), never rendered on /watch by default
 * (docs/streaming-runs-plan.md decision 4).
 */
import { getAppDb } from "@photonsurge/shared/db/index";
import { CHAT_MESSAGE, type ChatMessage } from "@photonsurge/shared/runs";
import { log } from "@photonsurge/shared/utill/logger";
import { emitWorkerEvent } from "../socket";
import { startMonitor, stopMonitor } from "./monitor";
import { getYoutubeClient, listChat } from "../youtube/client";

const TAG = "stream-chat";
const chatKey = (runId: string) => `chat:${runId}`;

// Per-run continuation token. Its PRESENCE also marks "we've polled once", so the
// first (backlog) page is skipped for display — only messages arriving after we
// start stream to the operator panel; the log still records the backlog.
const pageTokens = new Map<string, string | undefined>();

export function startChatPoll(runId: string): void {
  startMonitor(chatKey(runId), () => chatTick(runId), 1_000);
}

export function stopChatPoll(runId: string): void {
  stopMonitor(chatKey(runId));
  pageTokens.delete(runId);
}

async function chatTick(runId: string): Promise<number> {
  const db = await getAppDb();
  const run = await db.getRun(runId);
  if (!run || run.status !== "live" || !run.chat?.enabled) return -1; // self-terminate
  const yt = run.platforms?.youtube;
  if (!yt?.liveChatId) return 5_000;

  try {
    const ctx = await getYoutubeClient(yt.accountId);
    const first = !pageTokens.has(runId);
    const page = await listChat(ctx, yt.liveChatId, pageTokens.get(runId));
    pageTokens.set(runId, page.nextPageToken);

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
    }
    return Math.max(2_000, page.pollingIntervalMillis);
  } catch (err) {
    log(TAG, `poll error ${runId}`, String((err as Error)?.message ?? err));
    return 5_000;
  }
}
