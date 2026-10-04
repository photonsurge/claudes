/**
 * Batch shaping for the chat poller. A slow poll (a stream's `chat.pollEveryMs`,
 * e.g. every 2 min to save quota) hands the handler minutes of chat at once —
 * a busy room can drop thirty `:music …` requests in one page. Fed straight to
 * chat-handler.ts they'd fill the request queue in one go and answer mostly
 * "queue is full". So, per batch:
 *
 *  - each viewer counts once: only their LAST command is kept (spam and
 *    changes of mind collapse to their final word);
 *  - each command word runs once: the batch VOTES on its argument — the most
 *    requested value wins, a tie goes to the most recent, and a mod/owner's
 *    latest request overrides the vote outright;
 *  - the info commands (`:modes`, bare `:mode`, `:help`) are dropped here —
 *    chat-commands.ts answers those from the raw batch with its own cooldowns.
 *
 * Replies are packed the same way: many short answers are joined into as few
 * chat messages as fit YouTube's 200-character limit, since every message
 * posted costs 50 quota units whatever its length.
 */
import { parseChatCommand } from "@photonsurge/shared/chat-policy";

interface CommandMsg {
  author: string;
  text: string;
  isMod?: boolean;
  isOwner?: boolean;
}

const INFO_COMMANDS = new Set(["modes", "help", "commands"]);

/** One winning command per command word, in original message order. */
export function coalesceCommands<T extends CommandMsg>(msgs: T[]): T[] {
  // Latest command per viewer.
  const lastByAuthor = new Map<string, number>();
  msgs.forEach((m, i) => {
    const parsed = parseChatCommand(m.text);
    if (!parsed || INFO_COMMANDS.has(parsed.cmd) || (parsed.cmd === "mode" && !parsed.args.length)) return;
    lastByAuthor.set(m.author.toLowerCase(), i);
  });

  // Group by command word, tallying each argument value.
  type Tally = { count: number; last: number };
  const groups = new Map<string, { values: Map<string, Tally>; staffLast: number }>();
  for (const i of lastByAuthor.values()) {
    const parsed = parseChatCommand(msgs[i].text)!;
    const g = groups.get(parsed.cmd) ?? { values: new Map<string, Tally>(), staffLast: -1 };
    const value = parsed.args.join(" ").toLowerCase();
    const t = g.values.get(value) ?? { count: 0, last: -1 };
    g.values.set(value, { count: t.count + 1, last: Math.max(t.last, i) });
    if (msgs[i].isMod || msgs[i].isOwner) g.staffLast = Math.max(g.staffLast, i);
    groups.set(parsed.cmd, g);
  }

  const keep: number[] = [];
  for (const g of groups.values()) {
    if (g.staffLast >= 0) {
      keep.push(g.staffLast);
      continue;
    }
    let best: Tally | null = null;
    for (const t of g.values.values()) {
      if (!best || t.count > best.count || (t.count === best.count && t.last > best.last)) best = t;
    }
    if (best) keep.push(best.last);
  }
  return keep.sort((a, b) => a - b).map((i) => msgs[i]);
}

/**
 * Join replies into at most `maxMessages` chat messages of at most `maxLen`
 * characters each (" · " between parts). Parts that don't fit are dropped —
 * the on-air VIEWER PICK chip and the operator panel still show the outcome.
 */
export function packReplies(replies: string[], maxLen: number, maxMessages: number): string[] {
  const out: string[] = [];
  let cur = "";
  for (const raw of replies) {
    const part = raw.length > maxLen ? `${raw.slice(0, maxLen - 1)}…` : raw;
    if (!cur) {
      cur = part;
    } else if (cur.length + 3 + part.length <= maxLen) {
      cur += ` · ${part}`;
    } else {
      out.push(cur);
      if (out.length >= maxMessages) return out;
      cur = part;
    }
  }
  if (cur && out.length < maxMessages) out.push(cur);
  return out;
}
