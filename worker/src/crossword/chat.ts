/**
 * The crossword's chat consumer (docs/crossword-mode-plan.md §6.4): on a
 * crossword scene the scene-scoped chat handler (stream/chat-handler.ts)
 * hands its batch here instead of to the globe's viewer commands. Nothing is
 * enqueued — the runner lives in this process, so the batch goes straight to
 * `submitAnswers`.
 *
 * Only what can be a guess is passed on: commands (`:help`, `!mode`) and
 * anything `parseGuess` rejects (too long, no letters) are dropped here, so
 * plain chatter never counts against a player's rate limit. A YouTube author
 * is `youtube:<authorChannelId>` (a message with no channel id is dropped); a
 * simulated one is `sim:<name>`, marked `sim`. The runner does the rest: rate
 * limit, hidden players, cleaned names, earliest typed first.
 *
 * No chat replies: each costs 50 quota units, and the board is the
 * acknowledgement (§6.3).
 */
import { parseGuess } from "@photonsurge/shared/crossword";
import { simPlayerId, youtubePlayerId } from "@photonsurge/shared/crossword-records";
import { log } from "@photonsurge/shared/utill/logger";
import { submitAnswers, type CrosswordChatAnswer, type SubmitResult } from "./runner";

const TAG = "crossword:chat";

/** The slice of a chat message the crossword reads (chat-handler's `ChatInput`). */
export interface CrosswordChatInput {
  author: string;
  text: string;
  platform: string;
  /** YouTube authorDetails.channelId. */
  authorChannelId?: string;
  /** When the viewer typed it (the message's publish time), epoch ms. */
  ts?: number;
}

const isCommand = (text: string) => /^\s*[!:]/.test(text);

/** Chat messages → answers for the runner (guess-shaped, with a player id). */
export function toCrosswordAnswers(msgs: CrosswordChatInput[], now: number): CrosswordChatAnswer[] {
  const out: CrosswordChatAnswer[] = [];
  for (const m of msgs) {
    const text = String(m.text ?? "");
    if (isCommand(text) || !parseGuess(text)) continue;
    const typedAt = typeof m.ts === "number" && Number.isFinite(m.ts) ? Math.min(m.ts, now) : now;
    if (m.platform === "sim") {
      const name = String(m.author ?? "").trim();
      if (name) out.push({ playerId: simPlayerId(name), name, text, typedAt, sim: true });
      continue;
    }
    if (m.platform !== "youtube" || !m.authorChannelId) continue;
    out.push({ playerId: youtubePlayerId(m.authorChannelId), name: m.author, text, typedAt });
  }
  return out;
}

/**
 * One chat batch for a crossword scene. Never throws; a scene with no runner
 * here (disabled, or hosted by another worker) takes nothing.
 */
export async function crosswordChatBatch(
  sceneId: string,
  msgs: CrosswordChatInput[],
  now: number = Date.now(),
  submit: (sceneId: string, answers: CrosswordChatAnswer[]) => Promise<SubmitResult> = submitAnswers,
): Promise<SubmitResult> {
  const answers = toCrosswordAnswers(msgs, now);
  if (!answers.length) return { running: true, solved: [] };
  try {
    const res = await submit(sceneId, answers);
    if (!res.running) log(TAG, `answers dropped: the host is not running here`, { sceneId, count: answers.length });
    return res;
  } catch (err) {
    log(TAG, `answers failed`, { sceneId, err: String((err as Error)?.message ?? err) });
    return { running: false, solved: [] };
  }
}
