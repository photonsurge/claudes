/**
 * Chat command responder — turns viewer messages like ":modes" or "!mode" into
 * replies the connected channel posts back into its own live chat. Invoked from
 * the chat poller (chat.ts) on freshly-polled messages only (never the backlog
 * page, so a worker restart can't answer stale commands).
 *
 * Loop-safe by construction: replies never start with a command prefix, so the
 * bot can't trigger itself when its own messages echo back on the next poll.
 * Each command is rate-limited per run (COOLDOWN_MS) and each poll batch sends
 * at most MAX_REPLIES_PER_BATCH — inserts cost ~50 YouTube quota units apiece.
 */
import { getAppDb } from "@photonsurge/shared/db/index";
import { MAIN_SCENE_ID, type ControlState } from "@photonsurge/shared/control";
import { INTRO_MAP_TYPES, OCEAN_MAP_TYPES } from "@photonsurge/shared/director-rois";
import type { ChatMessage, Run } from "@photonsurge/shared/runs";

const COOLDOWN_MS = 30_000;
const MAX_REPLIES_PER_BATCH = 2;

type Ctx = { run: Run };
type Handler = (ctx: Ctx) => Promise<string | null> | string | null;

/** ":modes", "!mode" etc. → "modes" / "mode"; plain chatter → null. */
export function parseCommand(text: string): string | null {
  const m = /^[!:]([a-z]+)\s*$/i.exec(text.trim());
  return m ? m[1].toLowerCase() : null;
}

async function sceneState(sceneId: string): Promise<ControlState | null> {
  const db = await getAppDb();
  const doc = sceneId === MAIN_SCENE_ID ? await db.getOrInitBroadcastState() : await db.getScene(sceneId);
  return (doc as ControlState | null) ?? null;
}

const COMMANDS: Record<string, Handler> = {
  /** The looks the globe cycles through. */
  modes: () => {
    const world = INTRO_MAP_TYPES.map((t) => t.id).join(" · ");
    const ocean = OCEAN_MAP_TYPES.map((t) => t.id).join(" · ");
    return `Map modes: ${world} — ocean: ${ocean}`;
  },

  /** What's on the globe right now for this stream's scene. */
  mode: async ({ run }) => {
    const state = await sceneState(run.sceneId);
    if (!state) return null;
    const all = [...INTRO_MAP_TYPES, ...OCEAN_MAP_TYPES];
    // Overlay-driven looks first (they run with no scalar field), then the field.
    const match = state.showAurora
      ? all.find((t) => t.id === "aurora")
      : state.showSatImg
        ? all.find((t) => t.id === "satimg")
        : all.find((t) => t.id === state.activeVariable);
    if (match) return `Now showing: ${match.title} — ${match.subtitle}`;
    return state.activeVariable ? `Now showing: ${state.activeVariable}` : "Now showing: the base globe";
  },

  help: () => "Commands: :modes (all map looks) · :mode (what's on now) · :help",
};
COMMANDS.commands = COMMANDS.help;

// Per-(run, command) last-reply time — plain in-process state, like the
// poller's own pageTokens map.
const lastSent = new Map<string, number>();

/** Test hook: clear the cooldown state. */
export function resetChatCommandCooldowns(): void {
  lastSent.clear();
}

/**
 * Replies owed for one freshly-polled batch, in message order. Cooldown state
 * updates as a side effect; a failing handler skips just that command.
 */
export async function commandReplies(run: Run, msgs: ChatMessage[], now = Date.now()): Promise<string[]> {
  const out: string[] = [];
  for (const msg of msgs) {
    if (out.length >= MAX_REPLIES_PER_BATCH) break;
    const cmd = parseCommand(msg.text);
    if (!cmd || !COMMANDS[cmd]) continue;
    const key = `${run.id}:${cmd}`;
    if (now - (lastSent.get(key) ?? 0) < COOLDOWN_MS) continue;
    lastSent.set(key, now);
    try {
      const reply = await COMMANDS[cmd]({ run });
      if (reply) out.push(reply);
    } catch {
      // One bad handler (e.g. a Mongo blip in :mode) never blocks other replies.
    }
  }
  return out;
}
