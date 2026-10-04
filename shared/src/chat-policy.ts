/**
 * Per-channel viewer chat policy — what the audience may change from live chat
 * (`ControlState.chat.commands`). Three switches, each a gate on the next:
 * Monitor chat (`chat.enabled`) → Viewer commands (`commands.enabled`) →
 * Viewers may steer the director (`commands.director.enabled`). Everything
 * defaults off, so a channel changes nothing until an operator opts in.
 *
 * Also the chat grammar: `[:!]<cmd> [args…] [minutes]`.
 *
 * See docs/done/director-programme-plan.md §3.8 and §5.
 */
import type { AudioMode } from "./control";
import type { SegmentKind } from "./director";

/** One palette viewers may pick with `:theme <id>`. */
export interface ViewerPalette {
  id: string;
  label: string;
  /** Base theme preset id (aurora / command / storm, or a custom one). */
  broadcastTheme: string;
  /** Optional overrides on top of the preset (ThemeOverrides keys). */
  themeOverrides?: Record<string, string>;
}

export interface ChatCommandSettings {
  /** Viewer commands at all (music, palette, map looks, …). */
  enabled: boolean;
  /** Who may use commands. */
  allowFrom: "all" | "mods" | "owner";
  /** Minimum gap between two requests from one viewer, seconds. */
  perUserCooldownS: number;
  /** Confirm in chat (costs YouTube quota: 50 units a reply). */
  replyInChat: boolean;
  /** Show the VIEWER PICK chip on air. */
  onAirChip: boolean;
  /** Most music / palette requests waiting at once (0 = unlimited). */
  maxQueued: number;
  music: {
    enabled: boolean;
    /** Allowed modes; empty = every mode. */
    allowed: AudioMode[];
    holdS: number;
    maxHoldS: number;
    allowSkip: boolean;
    allowShuffle: boolean;
    /** Minimum gap between two skips / shuffles on the channel, seconds. */
    skipCooldownS: number;
  };
  theme: {
    enabled: boolean;
    /** Empty = the built-in presets. */
    palettes: ViewerPalette[];
    holdS: number;
    maxHoldS: number;
  };
  /** Map looks (`:mode aurora`) — routed through the director at the next shot change. */
  mapType: {
    enabled: boolean;
    /** Allowed look ids; empty = every look the channel's spins can show. */
    allowed: string[];
    holdS: number;
    maxHoldS: number;
  };
  /** Viewers may steer the camera (`:show japan`, `:quake`, `:roundup uk`). */
  director: {
    enabled: boolean;
    mode: "boundary" | "immediate";
    ops: { cut: boolean; roundup: boolean; skip: boolean; clear: boolean };
    /** Which `kind` requests viewers may make. */
    kinds: Partial<Record<SegmentKind, boolean>>;
    places: { countries: boolean; regions: boolean; cities: boolean };
    holdS: number;
    maxHoldS: number;
    /** Minimum gap between two viewer cuts on the channel, seconds. */
    everyS: number;
    /** Most viewer director requests waiting at once. */
    maxQueued: number;
  };
}

/** The palettes viewers can pick when a channel lists none of its own. */
export const BUILT_IN_PALETTES: readonly ViewerPalette[] = [
  { id: "command", label: "Command", broadcastTheme: "command" },
  { id: "aurora", label: "Aurora", broadcastTheme: "aurora" },
  { id: "storm", label: "Storm", broadcastTheme: "storm" },
];

export const DEFAULT_CHAT_COMMAND_SETTINGS: ChatCommandSettings = {
  enabled: false,
  allowFrom: "all",
  perUserCooldownS: 60,
  replyInChat: false,
  onAirChip: true,
  maxQueued: 10,
  music: { enabled: true, allowed: [], holdS: 300, maxHoldS: 900, allowSkip: true, allowShuffle: true, skipCooldownS: 30 },
  theme: { enabled: true, palettes: [], holdS: 300, maxHoldS: 900 },
  mapType: { enabled: true, allowed: [], holdS: 300, maxHoldS: 900 },
  director: {
    enabled: false,
    mode: "boundary",
    ops: { cut: true, roundup: true, skip: false, clear: false },
    kinds: { storm: true, quake: true, volcano: true, ocean: true, global: true },
    places: { countries: true, regions: true, cities: false },
    holdS: 60,
    maxHoldS: 180,
    everyS: 120,
    maxQueued: 5,
  },
};

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const bool = (v: unknown, d: boolean) => (typeof v === "boolean" ? v : d);
const num = (v: unknown, d: number, min: number, max: number, integer = false) => {
  if (typeof v !== "number" || !Number.isFinite(v)) return d;
  const c = Math.min(max, Math.max(min, v));
  return integer ? Math.round(c) : c;
};
const ids = (v: unknown, d: string[], allowed?: readonly string[]) =>
  Array.isArray(v)
    ? [...new Set(v.filter((x): x is string => typeof x === "string" && x.length <= 40 && (!allowed || allowed.includes(x))))]
    : d;

/** Hold bounds: a hold of at least 10 s, a max of at most 2 hours, and hold ≤ max. */
function holds(p: Record<string, unknown>, base: { holdS: number; maxHoldS: number }) {
  const maxHoldS = num(p.maxHoldS, base.maxHoldS, 10, 7200);
  return { holdS: Math.min(maxHoldS, num(p.holdS, base.holdS, 10, 7200)), maxHoldS };
}

/**
 * Merge an untrusted policy patch onto a base: unknown keys dropped, every
 * number clamped, nested blocks merged field by field. `sanitizeOverrides`
 * cleans a palette's theme overrides (control.ts's sanitiser, passed in to
 * avoid an import cycle).
 */
export function mergeChatCommandSettings(
  base: ChatCommandSettings,
  patch: unknown,
  opts: { audioModes: readonly string[]; sanitizeOverrides: (v: unknown) => Record<string, string> | undefined },
): ChatCommandSettings {
  const p = isObj(patch) ? patch : {};
  const music = isObj(p.music) ? p.music : {};
  const theme = isObj(p.theme) ? p.theme : {};
  const map = isObj(p.mapType) ? p.mapType : {};
  const dir = isObj(p.director) ? p.director : {};
  const ops = isObj(dir.ops) ? dir.ops : {};
  const places = isObj(dir.places) ? dir.places : {};
  const palettes = Array.isArray(theme.palettes)
    ? theme.palettes
        .filter(isObj)
        .filter((x) => typeof x.id === "string" && x.id.trim() && typeof x.broadcastTheme === "string")
        .slice(0, 12)
        .map((x): ViewerPalette => {
          const overrides = opts.sanitizeOverrides(x.themeOverrides);
          return {
            id: String(x.id).trim().toLowerCase().slice(0, 24),
            label: typeof x.label === "string" && x.label.trim() ? x.label.trim().slice(0, 40) : String(x.id),
            broadcastTheme: String(x.broadcastTheme),
            ...(overrides && Object.keys(overrides).length ? { themeOverrides: overrides } : {}),
          };
        })
    : base.theme.palettes;
  const kinds: Partial<Record<SegmentKind, boolean>> = { ...base.director.kinds };
  if (isObj(dir.kinds)) for (const [k, v] of Object.entries(dir.kinds)) if (typeof v === "boolean") kinds[k as SegmentKind] = v;
  return {
    enabled: bool(p.enabled, base.enabled),
    allowFrom: p.allowFrom === "all" || p.allowFrom === "mods" || p.allowFrom === "owner" ? p.allowFrom : base.allowFrom,
    perUserCooldownS: num(p.perUserCooldownS, base.perUserCooldownS, 0, 3600),
    replyInChat: bool(p.replyInChat, base.replyInChat),
    onAirChip: bool(p.onAirChip, base.onAirChip),
    maxQueued: num(p.maxQueued, base.maxQueued, 0, 100, true),
    music: {
      enabled: bool(music.enabled, base.music.enabled),
      allowed: ids(music.allowed, base.music.allowed, opts.audioModes) as AudioMode[],
      ...holds(music, base.music),
      allowSkip: bool(music.allowSkip, base.music.allowSkip),
      allowShuffle: bool(music.allowShuffle, base.music.allowShuffle),
      skipCooldownS: num(music.skipCooldownS, base.music.skipCooldownS, 0, 3600),
    },
    theme: { enabled: bool(theme.enabled, base.theme.enabled), palettes, ...holds(theme, base.theme) },
    mapType: { enabled: bool(map.enabled, base.mapType.enabled), allowed: ids(map.allowed, base.mapType.allowed), ...holds(map, base.mapType) },
    director: {
      enabled: bool(dir.enabled, base.director.enabled),
      mode: dir.mode === "boundary" || dir.mode === "immediate" ? dir.mode : base.director.mode,
      ops: {
        cut: bool(ops.cut, base.director.ops.cut),
        roundup: bool(ops.roundup, base.director.ops.roundup),
        skip: bool(ops.skip, base.director.ops.skip),
        clear: bool(ops.clear, base.director.ops.clear),
      },
      kinds,
      places: {
        countries: bool(places.countries, base.director.places.countries),
        regions: bool(places.regions, base.director.places.regions),
        cities: bool(places.cities, base.director.places.cities),
      },
      ...holds(dir, base.director),
      everyS: num(dir.everyS, base.director.everyS, 0, 3600),
      maxQueued: num(dir.maxQueued, base.director.maxQueued, 1, 50, true),
    },
  };
}

/** The palettes a channel offers (its own, else the built-ins). */
export function channelPalettes(policy: ChatCommandSettings): readonly ViewerPalette[] {
  return policy.theme.palettes.length ? policy.theme.palettes : BUILT_IN_PALETTES;
}

/** A parsed chat command: `:music deep 10` → { cmd: "music", args: ["deep"], minutes: 10 }. */
export interface ParsedCommand {
  cmd: string;
  args: string[];
  /** A trailing whole number, read as minutes. */
  minutes?: number;
}

/**
 * `[:!]<cmd> [args…] [minutes]` → the parts, or null for ordinary chatter.
 * The command word is letters only; a trailing number is the hold in minutes.
 */
export function parseChatCommand(text: string): ParsedCommand | null {
  const m = /^[!:]([a-z]+)(?:\s+(.*))?$/i.exec(text.trim());
  if (!m) return null;
  const words = (m[2] ?? "").trim().split(/\s+/).filter(Boolean).slice(0, 6);
  let minutes: number | undefined;
  if (words.length && /^\d{1,3}$/.test(words[words.length - 1])) minutes = Number(words.pop());
  return { cmd: m[1].toLowerCase(), args: words.map((w) => w.slice(0, 40)), ...(minutes !== undefined ? { minutes } : {}) };
}

/** A requested hold, seconds: the viewer's minutes (clamped to the max) or the default. */
export function requestedHoldS(minutes: number | undefined, slot: { holdS: number; maxHoldS: number }): number {
  if (minutes === undefined || minutes <= 0) return slot.holdS;
  return Math.min(slot.maxHoldS, minutes * 60);
}

/** May this author use commands at all on this channel? */
export function mayCommand(policy: ChatCommandSettings, author: { isMod?: boolean; isOwner?: boolean }): boolean {
  if (!policy.enabled) return false;
  if (policy.allowFrom === "all") return true;
  if (policy.allowFrom === "mods") return !!author.isMod || !!author.isOwner;
  return !!author.isOwner;
}
