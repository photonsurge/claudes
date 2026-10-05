/**
 * The viewer chat handler: one scene-scoped unit of work for a batch of chat
 * messages, from the live poller (chat.ts) or the operator's simulator
 * (jobs/viewer-chat.ts). It parses commands, applies the channel's chat policy
 * (who, cooldowns, allowed values, hold clamps, queue caps), writes the
 * worker-owned ViewerState and emits it, and returns the replies a viewer
 * would see — the caller decides whether those go to YouTube (each costs
 * quota) or only to the operator panel.
 *
 * On a crossword scene the batch goes to the crossword's consumer instead
 * (`deps.crossword`, crossword/chat.ts): its answers, not the globe's
 * commands, with no replies (docs/crossword-mode-plan.md §6.4).
 *
 * See docs/done/director-programme-plan.md §5.
 */
import { getAppDb, type AppDb } from "@photonsurge/shared/db/index";
import {
  AUDIO_MODES,
  DEFAULT_CONTROL_STATE,
  MAIN_SCENE_ID,
  mergeControlState,
  sceneSurface,
  type AudioMode,
  type ControlState,
} from "@photonsurge/shared/control";
import {
  channelPalettes,
  mayCommand,
  parseChatCommand,
  requestedHoldS,
  type ChatCommandSettings,
  type ParsedCommand,
} from "@photonsurge/shared/chat-policy";
import {
  VIEWER_STATE,
  clearViewerState,
  grantRequest,
  sweepViewerState,
  type ViewerRequest,
  type ViewerSlot,
  type ViewerState,
} from "@photonsurge/shared/viewer";
import type { StreamPlatform } from "@photonsurge/shared/runs";
import { emitWorkerEvent } from "../socket";
import { makeDirectorHook } from "./chat-director";
import { crosswordChatBatch } from "../crossword/chat";

export interface ChatInput {
  author: string;
  text: string;
  isMod?: boolean;
  isOwner?: boolean;
  platform: StreamPlatform | "sim";
  /** The author's platform channel id (the crossword's player key). */
  authorChannelId?: string;
  /** When it was typed (the message's publish time), epoch ms. */
  ts?: number;
}

export interface BatchResult {
  /** What a viewer would read back, in message order. */
  replies: string[];
  /** The channel posts these replies into chat (each costs YouTube quota). */
  replyInChat: boolean;
  /** The viewer state changed (and was saved + emitted). */
  changed: boolean;
}

/** A command handled by the director queue instead (phase-8 grammar). */
export type DirectorHook = (ctx: {
  sceneId: string;
  policy: ChatCommandSettings;
  msg: ChatInput;
  parsed: ParsedCommand;
  now: number;
}) => Promise<string | null | undefined>;

export interface HandlerDeps {
  db: AppDb;
  emit: (state: ViewerState) => void;
  /** Director commands (`:show`, `:quake`, `:mode aurora`, …); undefined = not handled here. */
  director?: DirectorHook;
  /**
   * Batch shaping before the globe's commands run (the live poller's
   * `coalesceCommands`: one vote per viewer); undefined = every message as is.
   */
  coalesce?: (msgs: ChatInput[]) => ChatInput[];
  /** A crossword scene's consumer: the raw batch, as answers. */
  crossword?: (sceneId: string, msgs: ChatInput[], now: number) => Promise<unknown>;
}

const label = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const mins = (ms: number) => `${Math.max(1, Math.round(ms / 60_000))} min`;

// In-process cooldown state, like the poller's own maps.
const userLast = new Map<string, number>();
const skipLast = new Map<string, number>();

/** Test hook: clear the cooldown state. */
export function resetChatHandlerCooldowns(): void {
  userLast.clear();
  skipLast.clear();
}

/** The scene's stored document (ControlState plus metadata such as `surface`), or null. */
async function sceneDoc(db: AppDb, sceneId: string): Promise<(Partial<ControlState> & { surface?: unknown }) | null> {
  const doc = sceneId === MAIN_SCENE_ID ? await db.getOrInitBroadcastState() : await db.getScene(sceneId);
  return (doc as (Partial<ControlState> & { surface?: unknown }) | null) ?? null;
}

const mergedControl = (doc: Partial<ControlState> | null): ControlState | null =>
  doc ? mergeControlState(DEFAULT_CONTROL_STATE, doc) : null;

/** The scene's merged ControlState (policy defaults filled in), or null. */
export async function sceneControl(db: AppDb, sceneId: string): Promise<ControlState | null> {
  return mergedControl(await sceneDoc(db, sceneId));
}

/** The scene is a crossword channel (`surface` is scene metadata, not ControlState). */
export async function isCrosswordScene(db: AppDb, sceneId: string): Promise<boolean> {
  return sceneSurface(await sceneDoc(db, sceneId)) === "crossword";
}

/** `:help` — what THIS channel allows, built from its policy. */
export function helpText(policy: ChatCommandSettings): string {
  const parts = [":modes", ":mode"];
  if (policy.music.enabled) {
    parts.push(":music <mode> [min]");
    if (policy.music.allowSkip) parts.push(":skip");
    if (policy.music.allowShuffle) parts.push(":shuffle");
  }
  if (policy.theme.enabled) parts.push(":theme <name> [min]");
  if (policy.director.enabled) {
    parts.push(":show <place>");
    if (policy.director.ops.roundup) parts.push(":roundup [place]");
    if (policy.mapType.enabled) parts.push(":mode <look>");
  }
  parts.push(":queue");
  return `Commands: ${parts.join(" · ")}`;
}

/**
 * Handle one batch for one scene. Commands from authors the policy doesn't
 * allow, unknown commands and plain chatter are silent (no quota spent).
 */
export async function handleChatBatch(
  sceneId: string,
  msgs: ChatInput[],
  deps: HandlerDeps,
  now: number = Date.now(),
): Promise<BatchResult> {
  const replies: string[] = [];
  const doc = await sceneDoc(deps.db, sceneId);
  if (doc && sceneSurface(doc) === "crossword") {
    // No globe here: the batch is answers, and answers get no replies.
    if (deps.crossword) await deps.crossword(sceneId, msgs, now);
    return { replies, replyInChat: false, changed: false };
  }
  const scene = mergedControl(doc);
  const policy = scene?.chat.commands;
  if (!scene || !scene.chat.enabled || !policy) return { replies, replyInChat: false, changed: false };

  const original = await deps.db.viewerState.get(sceneId);
  let state = sweepViewerState(original, now);
  let changed = state !== original;

  const request = (msg: ChatInput, slot: ViewerSlot, value: string, shown: string, holdS: number) => {
    const req: Omit<ViewerRequest, "until"> = {
      slot,
      value,
      label: shown,
      by: { author: msg.author, platform: msg.platform, ...(msg.isMod ? { isMod: true } : {}) },
      requestedAt: now,
      holdMs: Math.round(holdS * 1000),
    };
    const res = grantRequest(state, req, policy.maxQueued, now);
    if (res.outcome === "full") return `@${msg.author} the queue is full, try again in a minute`;
    state = res.state;
    changed = true;
    return res.outcome === "active"
      ? `@${msg.author} → ${shown} for ${mins(req.holdMs)}`
      : `@${msg.author} → ${shown} is queued (#${res.position})`;
  };

  for (const msg of deps.coalesce ? deps.coalesce(msgs) : msgs) {
    const parsed = parseChatCommand(msg.text);
    if (!parsed) continue;
    // `:modes`, `:mode` (no argument) and `:help` are the always-on info
    // commands (chat-commands.ts) — not policy-gated, not handled here.
    if (["modes", "help", "commands"].includes(parsed.cmd) || (parsed.cmd === "mode" && !parsed.args.length)) continue;
    if (!mayCommand(policy, msg)) continue;

    const userKey = `${sceneId}:${msg.author.toLowerCase()}`;
    const coolingUser = now - (userLast.get(userKey) ?? -Infinity) < policy.perUserCooldownS * 1000;
    const mod = !!msg.isMod || !!msg.isOwner;

    let reply: string | null | undefined = null;
    let acted = false;
    switch (parsed.cmd) {
      case "music": {
        if (!policy.music.enabled) break;
        const allowed: AudioMode[] = (policy.music.allowed.length ? policy.music.allowed : AUDIO_MODES).filter((m) => m !== "auto");
        const wanted = parsed.args[0]?.toLowerCase();
        if (!wanted) {
          reply = `Music: ${allowed.join(" · ")}`;
          break;
        }
        if (!allowed.includes(wanted as AudioMode)) {
          reply = `@${msg.author} "${wanted}" isn't a music mode here — try :music`;
          break;
        }
        if (coolingUser) break;
        reply = request(msg, "audioMode", wanted, label(wanted), requestedHoldS(parsed.minutes, policy.music));
        acted = true;
        break;
      }

      case "skip":
      case "shuffle": {
        const isSkip = parsed.cmd === "skip";
        if (!policy.music.enabled || !(isSkip ? policy.music.allowSkip : policy.music.allowShuffle)) break;
        if (now - (skipLast.get(sceneId) ?? -Infinity) < policy.music.skipCooldownS * 1000 || coolingUser) break;
        skipLast.set(sceneId, now);
        state = isSkip
          ? { ...state, audioSkipEpoch: state.audioSkipEpoch + 1, updatedAt: now }
          : { ...state, audioSeed: (Math.floor(Math.random() * 0x7fffffff) || 1) >>> 0, updatedAt: now };
        changed = true;
        acted = true;
        reply = isSkip ? `@${msg.author} skipped to the next tune` : `@${msg.author} shuffled the music`;
        break;
      }

      case "themes":
      case "theme": {
        if (!policy.theme.enabled) break;
        const palettes = channelPalettes(policy);
        const wanted = parsed.args.join(" ").toLowerCase();
        if (parsed.cmd === "themes" || !wanted) {
          reply = `Themes: ${palettes.map((p) => p.id).join(" · ")}`;
          break;
        }
        const pick = palettes.find((p) => p.id === wanted || p.label.toLowerCase() === wanted);
        if (!pick) {
          reply = `@${msg.author} "${wanted}" isn't a theme here — try :themes`;
          break;
        }
        if (coolingUser) break;
        reply = request(msg, "theme", pick.id, pick.label, requestedHoldS(parsed.minutes, policy.theme));
        acted = true;
        break;
      }

      case "queue": {
        const on = Object.values(state.active).map((r) => `${r!.label} (@${r!.by.author}, ${mins(r!.until - now)} left)`);
        const waiting = state.queue.map((r) => r.label);
        reply = on.length || waiting.length
          ? `Now: ${on.join(", ") || "nothing"}${waiting.length ? ` · next: ${waiting.join(", ")}` : ""}`
          : "Nothing requested right now";
        break;
      }

      case "reset": {
        if (!mod) break;
        state = clearViewerState(state, now);
        changed = true;
        reply = "Viewer picks cleared";
        break;
      }

      default:
        // Everything else (director requests) belongs to the director queue.
        if (deps.director && !coolingUser) {
          reply = await deps.director({ sceneId, policy, msg, parsed, now });
          acted = reply != null;
        }
    }
    if (acted) userLast.set(userKey, now);
    if (reply) replies.push(reply);
  }

  if (changed) {
    await deps.db.viewerState.save(state);
    deps.emit(state);
  }
  return { replies, replyInChat: policy.replyInChat, changed };
}

/** The worker's default wiring: the app db and the socket relay. */
export async function defaultHandlerDeps(): Promise<HandlerDeps> {
  const db = await getAppDb();
  return {
    db,
    emit: (state) => emitWorkerEvent({ type: VIEWER_STATE, data: state }),
    director: makeDirectorHook(db),
    crossword: crosswordChatBatch,
  };
}
