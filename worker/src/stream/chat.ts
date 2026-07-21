/**
 * YouTube live-chat poller for a run. In-process (keyed `chat:<runId>` in the same
 * monitor registry the health loop uses) so it starts/stops with the run and
 * needs no self-rescheduling BullMQ job. Polls liveChatMessages.list at the
 * server-suggested interval and emits each new message as CHAT_MESSAGE over the
 * worker→browser relay. Ephemeral — chat is never persisted.
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
// first (backlog) page is skipped — only messages arriving after we start stream.
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

    if (!first) {
      for (const m of page.messages) {
        const msg: ChatMessage = {
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
        };
        emitWorkerEvent({ type: CHAT_MESSAGE, data: msg });
      }
    }
    return Math.max(2_000, page.pollingIntervalMillis);
  } catch (err) {
    log(TAG, `poll error ${runId}`, String((err as Error)?.message ?? err));
    return 5_000;
  }
}
