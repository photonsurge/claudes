/**
 * Crossword channel — the game's types and rules (docs/crossword-mode-plan.md §4).
 *
 * Everything here is pure: the worker's host loop runs these functions, public
 * uses the types and the on-air helpers only. A puzzle's answers never leave
 * the worker or the admin: the only thing that is emitted or served to a watch
 * page is `toPublicState`'s projection, which carries a letter only once a
 * hint showed it or its entry is solved.
 */

// ---------------------------------------------------------------------------
// Puzzle (stored, holds the answers)
// ---------------------------------------------------------------------------

export type CrosswordDir = "across" | "down";

export interface CrosswordEntry {
  /** "7A", "12D" — standard crossword numbering. */
  id: string;
  num: number;
  dir: CrosswordDir;
  row: number;
  col: number;
  /** A–Z only. Never leaves the worker or admin. */
  answer: string;
  clue: string;
  /** The approved bank word it came from ("" or a seed id for the seed set). */
  wordId: string;
  /** The approved bank clue it came from ("" or a seed id for the seed set). */
  clueId: string;
}

/**
 * Built only from approved words and clues (§7.4), so a puzzle is `ready` the
 * moment it is built; Reject removes it from play.
 */
export type CrosswordPuzzleStatus = "ready" | "rejected";
export const CROSSWORD_PUZZLE_STATUSES: readonly CrosswordPuzzleStatus[] = ["ready", "rejected"];
export type CrosswordPuzzleSource = "seed" | "bank" | "themed";

export interface CrosswordPlay {
  sceneId: string;
  startedAt: number;
  endedAt?: number;
}

export interface CrosswordPuzzle {
  id: string;
  /** "Puzzle 42", or a theme name later. */
  title: string;
  width: number;
  height: number;
  entries: CrosswordEntry[];
  status: CrosswordPuzzleStatus;
  /** Every word and clue in it carries the family-friendly tag. */
  familyFriendly: boolean;
  source: CrosswordPuzzleSource;
  createdAt: number;
  plays: CrosswordPlay[];
}

// ---------------------------------------------------------------------------
// Game (one per scene, worker-owned)
// ---------------------------------------------------------------------------

export type CrosswordPhase = "idle" | "intro" | "playing" | "finale";

/** Who a word is credited to when nobody solved it. */
export const CROSSWORD_HOST_ID = "host" as const;
export const CROSSWORD_HOST_NAME = "Host" as const;

export interface CrosswordSolved {
  /** Player id (`youtube:<channelId>`, `sim:<name>`) or CROSSWORD_HOST_ID. */
  by: string;
  name: string;
  /** When the word landed on the board (the reveal time for a late credit). */
  at: number;
  points: number;
  /** Taken from the host after the reveal: typed before it, read after (§4.6). */
  late?: boolean;
}

export interface CrosswordScore {
  name: string;
  points: number;
  words: number;
}

export interface CrosswordFeedItem {
  at: number;
  text: string;
}

export interface CrosswordSpotlight {
  entryId: string;
  startedAt: number;
  endsAt: number;
}

export interface CrosswordGame {
  sceneId: string;
  puzzleId: string;
  /** Running count per scene, shown on air. */
  puzzleNo: number;
  /** Bumps on every change. */
  seq: number;
  phase: CrosswordPhase;
  phaseEndsAt: number;
  /** When the current puzzle went to `playing` (the ceiling counts from here). */
  puzzleStartedAt: number;
  spotlight: CrosswordSpotlight | null;
  /** Letters the host leaked. */
  hints: { row: number; col: number; at: number }[];
  solved: Record<string, CrosswordSolved>;
  /** This puzzle's scores, keyed by player id. The host never scores. */
  scores: Record<string, CrosswordScore>;
  /** The last few solves, newest last. */
  feed: CrosswordFeedItem[];
  paused: boolean;
  /** The projection below, stored so public only serves it. */
  pub: CrosswordPublicState;
}

// ---------------------------------------------------------------------------
// What goes on the wire
// ---------------------------------------------------------------------------

export interface CrosswordPublicEntry {
  id: string;
  num: number;
  dir: CrosswordDir;
  row: number;
  col: number;
  length: number;
  clue: string;
  solved?: { name: string; points: number; late?: boolean };
}

export interface CrosswordPublicState {
  sceneId: string;
  seq: number;
  serverNow: number;
  phase: CrosswordPhase;
  phaseEndsAt: number;
  puzzleNo: number;
  title: string;
  width: number;
  height: number;
  /** "#" block, "." empty, a letter = shown. */
  rows: string[];
  entries: CrosswordPublicEntry[];
  spotlight: CrosswordSpotlight | null;
  /** This puzzle, sorted. */
  scores: CrosswordScore[];
  today: { name: string; points: number }[];
  /** The last few solves. */
  feed: CrosswordFeedItem[];
  /** A live run with chat is attached to this scene. */
  inputLive: boolean;
  paused: boolean;
}

/** BullMQ job type for every crossword job (worker/src/jobs/crossword.ts). */
export const CROSSWORD_JOB_TYPE = "crossword" as const;
export const CROSSWORD_JOB_DOMAIN = "crossword" as const;

/** Payload of `crossword.inject` (foreground): a simulated message or a Desk command. */
export type CrosswordInject =
  | { sceneId: string; kind: "sim"; name: string; text: string; at?: number }
  | { sceneId: string; kind: "command"; command: CrosswordCommand };

export type CrosswordCommand = "pause" | "resume" | "skipClue" | "reveal" | "nextPuzzle";
export const CROSSWORD_COMMANDS: readonly CrosswordCommand[] = ["pause", "resume", "skipClue", "reveal", "nextPuzzle"];

/** Payload of `crossword.generate` (background). */
export interface CrosswordGenerateRequest {
  sceneId: string;
  /** Repeatable build. */
  seed?: number;
}

/** Worker → browser: the full public state, on every change. */
export const CROSSWORD_STATE = "crossword:state" as const;
/** Worker → browser: `{ sceneId, seq, serverNow }` every 5 s. */
export const CROSSWORD_BEAT = "crossword:beat" as const;

export interface CrosswordBeat {
  sceneId: string;
  seq: number;
  serverNow: number;
}

// ---------------------------------------------------------------------------
// Theme (§5.1): the crossword's own look, not the weather broadcast's
// ---------------------------------------------------------------------------

export interface CrosswordThemeColors {
  /** The page behind everything. */
  background: string;
  /** Cards: spotlight, clue lists, scoreboard. */
  panel: string;
  /** An open cell. */
  cell: string;
  /** A cell whose word is solved. */
  cellSolved: string;
  /** A block (no letter). */
  block: string;
  ink: string;
  inkMuted: string;
  accent: string;
}

export interface CrosswordTheme {
  /** A named starting point (CROSSWORD_THEME_PRESETS). */
  preset: string;
  /** The crossword channel's own brand: it goes out on its own YouTube channel. */
  brand: { title: string; logoUrl: string };
  colors: CrosswordThemeColors;
  font: { display: string; text: string };
}

export interface CrosswordThemePreset {
  id: string;
  label: string;
  colors: CrosswordThemeColors;
  font: CrosswordTheme["font"];
}

/**
 * One preset for now: the February prototype's look, carried over as it is
 * (operator, 2026-10-04: it looks poor, use it for now). From its light MUI
 * palette (crosswords/my-app/src/theme.ts, globals.css) and its board
 * renderer's styles (crosswords/src/crossword.ts): a light board, slate-900
 * blocks and ink, slate-blue muted ink, blue highlight.
 */
export const CROSSWORD_THEME_PRESETS: readonly CrosswordThemePreset[] = [
  {
    id: "prototype",
    label: "Prototype",
    colors: {
      background: "#f3f6fb",
      panel: "#ffffff",
      cell: "#f8fafc",
      cellSolved: "#ffffff",
      block: "#0f172a",
      ink: "#0f172a",
      inkMuted: "#4c6078",
      accent: "#2563eb",
    },
    font: {
      display: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif',
      text: 'Roboto, Helvetica, Arial, sans-serif',
    },
  },
];

const PROTOTYPE_PRESET = CROSSWORD_THEME_PRESETS[0];

export const DEFAULT_CROSSWORD_THEME: CrosswordTheme = {
  preset: PROTOTYPE_PRESET.id,
  brand: { title: "Crossword", logoUrl: "" },
  colors: { ...PROTOTYPE_PRESET.colors },
  font: { ...PROTOTYPE_PRESET.font },
};

const COLOR_KEYS = Object.keys(PROTOTYPE_PRESET.colors) as (keyof CrosswordThemeColors)[];
export const BRAND_TITLE_MAX = 60;

/**
 * A CSS colour safe to drop into a custom property: hex, rgb()/rgba()/hsl()/
 * hsla() with plain numbers, or a bare keyword. Nothing that could close the
 * declaration (`;`, `}`) or load anything (`url(`).
 */
export function isThemeColor(v: unknown): v is string {
  if (typeof v !== "string") return false;
  const s = v.trim();
  return (
    s.length <= 64 &&
    (/^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(s) ||
      /^(?:rgb|rgba|hsl|hsla)\(\s*[0-9.%\s,/+-]+\)$/i.test(s) ||
      /^[a-z]{3,20}$/i.test(s))
  );
}

/** A font-family list: letters, digits, spaces, commas, hyphens and quotes. */
export function isThemeFont(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0 && v.length <= 200 && /^[\w\s,'"-]+$/.test(v);
}

/** A logo source: an http(s) URL or a site path. "" = none. */
function themeLogoUrl(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim().slice(0, 500);
  if (!s) return "";
  return /^https?:\/\/[^\s"'()<>]+$/i.test(s) || /^\/[^\s"'()<>]*$/.test(s) ? s : null;
}

/**
 * Sanitize a theme (or a partial patch) over `base`. A known `preset` that
 * differs from base's resets colours and fonts to that preset before the
 * patch's own colours and fonts apply; the brand is kept. An unknown preset
 * is ignored. Bad values fall back to base's.
 */
export function sanitizeCrosswordTheme(v: unknown, base: CrosswordTheme = DEFAULT_CROSSWORD_THEME): CrosswordTheme {
  const b = base && typeof base === "object" ? base : DEFAULT_CROSSWORD_THEME;
  const p = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const basePreset = CROSSWORD_THEME_PRESETS.find((x) => x.id === b.preset) ?? PROTOTYPE_PRESET;
  const newPreset = typeof p.preset === "string" ? CROSSWORD_THEME_PRESETS.find((x) => x.id === p.preset) : undefined;
  const start =
    newPreset && newPreset.id !== b.preset
      ? { preset: newPreset.id, colors: newPreset.colors, font: newPreset.font }
      : { preset: basePreset.id, colors: { ...basePreset.colors, ...b.colors }, font: { ...basePreset.font, ...b.font } };

  const colors = { ...PROTOTYPE_PRESET.colors };
  const pc = (p.colors && typeof p.colors === "object" ? p.colors : {}) as Record<string, unknown>;
  for (const k of COLOR_KEYS) {
    colors[k] = isThemeColor(pc[k]) ? (pc[k] as string).trim() : isThemeColor(start.colors[k]) ? start.colors[k] : colors[k];
  }
  const pf = (p.font && typeof p.font === "object" ? p.font : {}) as Record<string, unknown>;
  const font = { ...PROTOTYPE_PRESET.font };
  for (const k of ["display", "text"] as const) {
    font[k] = isThemeFont(pf[k]) ? (pf[k] as string).trim() : isThemeFont(start.font[k]) ? start.font[k] : font[k];
  }
  const pb = (p.brand && typeof p.brand === "object" ? p.brand : {}) as Record<string, unknown>;
  const baseTitle = typeof b.brand?.title === "string" ? b.brand.title : DEFAULT_CROSSWORD_THEME.brand.title;
  const title =
    typeof pb.title === "string"
      ? pb.title.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, BRAND_TITLE_MAX)
      : baseTitle.slice(0, BRAND_TITLE_MAX);
  const logoUrl = themeLogoUrl(pb.logoUrl) ?? themeLogoUrl(b.brand?.logoUrl) ?? "";
  return { preset: start.preset, brand: { title, logoUrl }, colors, font };
}

/**
 * The theme as CSS custom properties, set once on the page root (§5.1). Pure;
 * the page spreads the result into its root style.
 */
export function crosswordThemeVars(theme: CrosswordTheme): Record<string, string> {
  const t = sanitizeCrosswordTheme(theme, theme);
  return {
    "--cw-background": t.colors.background,
    "--cw-panel": t.colors.panel,
    "--cw-cell": t.colors.cell,
    "--cw-cell-solved": t.colors.cellSolved,
    "--cw-block": t.colors.block,
    "--cw-ink": t.colors.ink,
    "--cw-ink-muted": t.colors.inkMuted,
    "--cw-accent": t.colors.accent,
    "--cw-font-display": t.font.display,
    "--cw-font-text": t.font.text,
  };
}

// ---------------------------------------------------------------------------
// Config (one document per scene, the DirectorConfig pattern)
// ---------------------------------------------------------------------------

export interface CrosswordConfig {
  /** The host runs for this scene. */
  enabled: boolean;
  /** Keep playing with no live run (a local box, testing). */
  playOffAir: boolean;
  // Pacing (seconds)
  introS: number;
  clueS: number;
  finaleS: number;
  /** Hold after the host reveals a word. */
  revealHoldS: number;
  /** Beat after a viewer solves the spotlight word. */
  solveBeatS: number;
  /** A puzzle still open after this many minutes is finished by the host. */
  ceilingMin: number;
  /** No hints for this fraction of the clue time. */
  hintStartFrac: number;
  /** Hints stop once this fraction of the word shows. */
  hintMaxFrac: number;
  /** The channel's look (§5.1). */
  theme: CrosswordTheme;
  // Difficulty
  /** Word-frequency floor for the candidate pick. */
  minZipf: number;
  // Puzzles
  minWords: number;
  maxWords: number;
  /** Largest grid side, in cells. */
  maxSize: number;
  stockTarget: number;
  /** Build only from words and clues tagged family friendly (untagged counts as not). */
  familyFriendlyOnly: boolean;
  /** A replayed puzzle is never one of the scene's last N. */
  noRepeatPuzzles: number;
  /** A word is not reused within the scene's last N puzzles. */
  noRepeatWordsPuzzles: number;
  // Chat and scoring
  streamDelayS: number;
  rateMax: number;
  rateWindowS: number;
  /** The operator's own blocklist, on top of the built-in one. */
  blocklist: string[];
}

export const DEFAULT_CROSSWORD_CONFIG: CrosswordConfig = {
  enabled: false,
  playOffAir: false,
  introS: 12,
  clueS: 60,
  finaleS: 30,
  revealHoldS: 6,
  solveBeatS: 4,
  ceilingMin: 20,
  hintStartFrac: 0.4,
  hintMaxFrac: 0.5,
  theme: DEFAULT_CROSSWORD_THEME,
  minZipf: 3.5,
  minWords: 10,
  maxWords: 16,
  maxSize: 13,
  stockTarget: 6,
  familyFriendlyOnly: true,
  noRepeatPuzzles: 30,
  noRepeatWordsPuzzles: 20,
  streamDelayS: 10,
  rateMax: 5,
  rateWindowS: 10,
  blocklist: [],
};

type NumKey = {
  [K in keyof CrosswordConfig]: CrosswordConfig[K] extends number ? K : never;
}[keyof CrosswordConfig];

/** Clamp range per numeric field. */
export const CROSSWORD_CONFIG_LIMITS: Record<NumKey, [number, number]> = {
  introS: [3, 120],
  clueS: [15, 600],
  finaleS: [5, 300],
  revealHoldS: [1, 60],
  solveBeatS: [1, 60],
  ceilingMin: [2, 180],
  hintStartFrac: [0, 0.95],
  hintMaxFrac: [0, 0.9],
  minZipf: [0, 8],
  minWords: [4, 30],
  maxWords: [4, 30],
  maxSize: [7, 21],
  stockTarget: [0, 50],
  noRepeatPuzzles: [0, 500],
  noRepeatWordsPuzzles: [0, 500],
  streamDelayS: [0, 120],
  rateMax: [1, 100],
  rateWindowS: [1, 300],
};

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Merge a patch over `base`, dropping unknown keys and clamping numbers. */
export function mergeCrosswordConfig(
  base: CrosswordConfig,
  patch: Partial<Record<keyof CrosswordConfig, unknown>> | null | undefined,
): CrosswordConfig {
  const out: CrosswordConfig = { ...base, theme: sanitizeCrosswordTheme(base.theme), blocklist: [...base.blocklist] };
  if (!patch || typeof patch !== "object") return out;
  for (const k of ["enabled", "playOffAir", "familyFriendlyOnly"] as const) {
    if (typeof patch[k] === "boolean") out[k] = patch[k] as boolean;
  }
  for (const k of Object.keys(CROSSWORD_CONFIG_LIMITS) as NumKey[]) {
    const v = patch[k];
    if (typeof v === "number" && Number.isFinite(v)) {
      const [lo, hi] = CROSSWORD_CONFIG_LIMITS[k];
      out[k] = clamp(v, lo, hi);
    }
  }
  if (Array.isArray(patch.blocklist)) {
    out.blocklist = [
      ...new Set(patch.blocklist.filter((s) => typeof s === "string").map((s: string) => s.trim()).filter(Boolean)),
    ].slice(0, 200);
  }
  if (patch.theme && typeof patch.theme === "object") out.theme = sanitizeCrosswordTheme(patch.theme, out.theme);
  for (const k of ["minWords", "maxWords", "clueS", "introS", "finaleS"] as const) {
    out[k] = Math.round(out[k]);
  }
  if (out.maxWords < out.minWords) out.maxWords = out.minWords;
  return out;
}

// ---------------------------------------------------------------------------
// Grid geometry and numbering
// ---------------------------------------------------------------------------

/** A placed word before numbering. */
export interface CrosswordPlacement {
  answer: string;
  clue: string;
  row: number;
  col: number;
  dir: CrosswordDir;
  /** The bank word and clue it came from; "" when not known. */
  wordId?: string;
  clueId?: string;
}

export const cellKey = (row: number, col: number) => `${row},${col}`;

/** Uppercase, A–Z only. */
export function normalizeAnswer(s: string): string {
  return String(s ?? "").toUpperCase().replace(/[^A-Z]/g, "");
}

/** The cells an entry covers, in reading order. */
export function entryCells(e: { row: number; col: number; dir: CrosswordDir; length?: number; answer?: string }) {
  const n = e.length ?? e.answer?.length ?? 0;
  const out: { row: number; col: number }[] = [];
  for (let i = 0; i < n; i++) {
    out.push(e.dir === "across" ? { row: e.row, col: e.col + i } : { row: e.row + i, col: e.col });
  }
  return out;
}

/**
 * Standard numbering: every cell that starts an entry gets a number, in row
 * order then column order; an across and a down starting in one cell share it.
 * Entries come back sorted across first, then by number.
 */
export function numberEntries(placements: CrosswordPlacement[]): CrosswordEntry[] {
  const starts = [...new Set(placements.map((p) => cellKey(p.row, p.col)))]
    .map((k) => k.split(",").map(Number) as [number, number])
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const nums = new Map(starts.map(([r, c], i) => [cellKey(r, c), i + 1]));
  return placements
    .map((p) => {
      const num = nums.get(cellKey(p.row, p.col))!;
      return {
        id: `${num}${p.dir === "across" ? "A" : "D"}`,
        num,
        dir: p.dir,
        row: p.row,
        col: p.col,
        answer: normalizeAnswer(p.answer),
        clue: p.clue,
        wordId: p.wordId ?? "",
        clueId: p.clueId ?? "",
      };
    })
    .sort((a, b) => (a.dir === b.dir ? a.num - b.num : a.dir === "across" ? -1 : 1));
}

/** Every filled cell's letter, keyed by `cellKey`. */
export function puzzleLetters(puzzle: Pick<CrosswordPuzzle, "entries">): Map<string, string> {
  const m = new Map<string, string>();
  for (const e of puzzle.entries) {
    entryCells(e).forEach((c, i) => m.set(cellKey(c.row, c.col), e.answer[i]));
  }
  return m;
}

/**
 * Cells showing at time `at` (inclusive): leaked by a hint or in a solved
 * entry. With `at` left out, everything showing now.
 */
export function shownCells(
  puzzle: Pick<CrosswordPuzzle, "entries">,
  game: Pick<CrosswordGame, "hints" | "solved">,
  at: number = Infinity,
): Set<string> {
  const shown = new Set<string>();
  for (const h of game.hints) if (h.at <= at) shown.add(cellKey(h.row, h.col));
  for (const e of puzzle.entries) {
    const s = game.solved[e.id];
    if (s && s.at <= at) for (const c of entryCells(e)) shown.add(cellKey(c.row, c.col));
  }
  return shown;
}

const showingIn = (e: CrosswordEntry, shown: Set<string>) =>
  entryCells(e).filter((c) => shown.has(cellKey(c.row, c.col))).length;

// ---------------------------------------------------------------------------
// The host's rules
// ---------------------------------------------------------------------------

/**
 * The next spotlight: the unsolved entry with the most letters already
 * showing, then the longest, then the lowest number (across first). With
 * nothing showing the first pick is the longest word. Null when all solved.
 */
export function pickSpotlight(puzzle: CrosswordPuzzle, game: Pick<CrosswordGame, "hints" | "solved">): CrosswordEntry | null {
  const shown = shownCells(puzzle, game);
  let best: CrosswordEntry | null = null;
  let bestShow = -1;
  for (const e of puzzle.entries) {
    if (game.solved[e.id]) continue;
    const s = showingIn(e, shown);
    if (
      !best ||
      s > bestShow ||
      (s === bestShow &&
        (e.answer.length > best.answer.length ||
          (e.answer.length === best.answer.length &&
            (e.num < best.num || (e.num === best.num && e.dir === "across" && best.dir === "down")))))
    ) {
      best = e;
      bestShow = s;
    }
  }
  return best;
}

/** Most letters the hints may bring a word to: floor(length × maxFrac). */
export const hintCap = (length: number, maxFrac: number) => Math.floor(length * maxFrac);

/**
 * When the hints for a spotlight fall due: none for the first `startFrac` of
 * the clue time, then `cap` hints at even intervals across the rest (the last
 * one lands a step before the reveal).
 */
export function hintTimes(spot: CrosswordSpotlight, length: number, cfg: Pick<CrosswordConfig, "hintStartFrac" | "hintMaxFrac">): number[] {
  const cap = hintCap(length, cfg.hintMaxFrac);
  const dur = spot.endsAt - spot.startedAt;
  const from = spot.startedAt + dur * cfg.hintStartFrac;
  const span = spot.endsAt - from;
  const out: number[] = [];
  for (let k = 0; k < cap; k++) out.push(Math.round(from + (span * k) / cap));
  return out;
}

/**
 * The next hint cell for the spotlight at `now`, or null. A hint is due when
 * more hint times have passed than this spotlight has leaked, and the word is
 * still under the cap (letters filled by crossings count as showing). The
 * cell picked is the hidden one furthest from any showing letter, ties to the
 * earliest, so the first hint is the first letter.
 */
export function nextHint(
  puzzle: CrosswordPuzzle,
  game: Pick<CrosswordGame, "hints" | "solved" | "spotlight">,
  now: number,
  cfg: Pick<CrosswordConfig, "hintStartFrac" | "hintMaxFrac">,
): { row: number; col: number } | null {
  const spot = game.spotlight;
  if (!spot) return null;
  const e = puzzle.entries.find((x) => x.id === spot.entryId);
  if (!e || game.solved[e.id]) return null;
  const cells = entryCells(e);
  const keys = new Set(cells.map((c) => cellKey(c.row, c.col)));
  const given = game.hints.filter((h) => h.at >= spot.startedAt && keys.has(cellKey(h.row, h.col))).length;
  const due = hintTimes(spot, e.answer.length, cfg).filter((t) => t <= now).length;
  if (due <= given) return null;
  const shown = shownCells(puzzle, game);
  const showIdx = cells.map((c, i) => (shown.has(cellKey(c.row, c.col)) ? i : -1)).filter((i) => i >= 0);
  if (showIdx.length >= hintCap(e.answer.length, cfg.hintMaxFrac)) return null;
  let pick = -1;
  let pickDist = -1;
  cells.forEach((c, i) => {
    if (shown.has(cellKey(c.row, c.col))) return;
    const d = showIdx.length ? Math.min(...showIdx.map((j) => Math.abs(i - j))) : Infinity;
    if (d > pickDist) {
      pick = i;
      pickDist = d;
    }
  });
  return pick >= 0 ? cells[pick] : null;
}

/** Every entry solved. */
export const isPuzzleComplete = (puzzle: CrosswordPuzzle, game: Pick<CrosswordGame, "solved">) =>
  puzzle.entries.every((e) => !!game.solved[e.id]);

// ---------------------------------------------------------------------------
// Answering and scoring
// ---------------------------------------------------------------------------

/** Messages longer than this are never guesses. */
export const MAX_GUESS_CHARS = 40;

const REF_RE = /^\s*\d{1,2}\s*[-.:]?\s*(a|d|ac|dn|across|down)\b[\s:.,\-]*/i;

/**
 * A chat message as a guess: drop an optional leading ref ("7a", "7 across",
 * "12-down"), uppercase, keep A–Z only. Null for an over-long message or one
 * with no letters left. The ref is only a habit viewers have; the word is
 * matched against every open entry either way.
 */
export function parseGuess(text: string): string | null {
  const raw = String(text ?? "");
  if (raw.length > MAX_GUESS_CHARS) return null;
  const word = normalizeAnswer(raw.replace(REF_RE, ""));
  return word.length ? word : null;
}

/**
 * Points for a word typed at `typedAt`: its letters not showing at that time
 * less the stream delay (a hint the viewer could not have seen yet does not
 * cost them), minimum 1. Letters filled by crossings count as showing.
 */
export function pointsFor(
  puzzle: CrosswordPuzzle,
  game: Pick<CrosswordGame, "hints" | "solved">,
  entry: CrosswordEntry,
  typedAt: number,
  streamDelayS: number,
): number {
  const asOf = typedAt - streamDelayS * 1000;
  const shown = shownCells(puzzle, { hints: game.hints, solved: withoutEntry(game.solved, entry.id) }, asOf);
  return Math.max(1, entry.answer.length - showingIn(entry, shown));
}

function withoutEntry(solved: Record<string, CrosswordSolved>, id: string) {
  const { [id]: _drop, ...rest } = solved;
  return rest;
}

export interface CrosswordAnswer {
  playerId: string;
  /** Already cleaned for air (cleanPlayerName). */
  name: string;
  text: string;
  /** When the viewer typed it (the chat message's publish time). */
  typedAt: number;
}

export type CrosswordAnswerResult =
  | { kind: "none" }
  | { kind: "solved" | "late"; entryId: string; points: number; game: CrosswordGame };

const dirWord = (d: CrosswordDir) => (d === "across" ? "ACROSS" : "DOWN");
export const FEED_MAX = 8;

const pushFeed = (feed: CrosswordFeedItem[], item: CrosswordFeedItem) => [...feed, item].slice(-FEED_MAX);

/**
 * Apply one answer. An open entry whose answer matches goes to the player.
 * A word the host revealed passes to the player, flagged `late`, if they typed
 * it before the reveal plus the stream delay (§4.6) — the first one processed
 * keeps it. Anything else (wrong, already taken) is "none": no on-air response.
 * Returns a new game; `seq` and `pub` are left to the caller.
 */
export function applyAnswer(
  puzzle: CrosswordPuzzle,
  game: CrosswordGame,
  ans: CrosswordAnswer,
  cfg: Pick<CrosswordConfig, "streamDelayS">,
  now: number,
): CrosswordAnswerResult {
  if (game.phase !== "playing" && game.phase !== "finale") return { kind: "none" };
  const word = parseGuess(ans.text);
  if (!word) return { kind: "none" };
  const matches = puzzle.entries.filter((e) => e.answer === word);
  if (!matches.length) return { kind: "none" };

  const open = matches.filter((e) => !game.solved[e.id]);
  const spotFirst = (es: CrosswordEntry[]) =>
    es.find((e) => e.id === game.spotlight?.entryId) ?? es[0];

  if (open.length && game.phase === "playing") {
    const e = spotFirst(open);
    const points = pointsFor(puzzle, game, e, ans.typedAt, cfg.streamDelayS);
    return {
      kind: "solved",
      entryId: e.id,
      points,
      game: credit(game, e, ans, points, now, false, now),
    };
  }

  const delayMs = cfg.streamDelayS * 1000;
  const late = matches.filter((e) => {
    const s = game.solved[e.id];
    return s && s.by === CROSSWORD_HOST_ID && ans.typedAt <= s.at + delayMs;
  });
  if (!late.length) return { kind: "none" };
  const e = spotFirst(late);
  const points = pointsFor(puzzle, game, e, ans.typedAt, cfg.streamDelayS);
  return { kind: "late", entryId: e.id, points, game: credit(game, e, ans, points, game.solved[e.id].at, true, now) };
}

function credit(
  game: CrosswordGame,
  e: CrosswordEntry,
  ans: CrosswordAnswer,
  points: number,
  at: number,
  late: boolean,
  now: number,
): CrosswordGame {
  const prev = game.scores[ans.playerId];
  const solved: CrosswordSolved = { by: ans.playerId, name: ans.name, at, points, ...(late ? { late } : {}) };
  const text = late
    ? `${ans.name} had ${e.num} ${dirWord(e.dir)} before the reveal +${points}`
    : `${ans.name} took ${e.num} ${dirWord(e.dir)} +${points}`;
  return {
    ...game,
    solved: { ...game.solved, [e.id]: solved },
    scores: {
      ...game.scores,
      [ans.playerId]: {
        name: ans.name,
        points: (prev?.points ?? 0) + points,
        words: (prev?.words ?? 0) + 1,
      },
    },
    feed: pushFeed(game.feed, { at: now, text }),
  };
}

/** The host fills a word itself: credited to the host, no points. */
export function revealEntry(game: CrosswordGame, entry: CrosswordEntry, now: number): CrosswordGame {
  if (game.solved[entry.id]) return game;
  return {
    ...game,
    solved: {
      ...game.solved,
      [entry.id]: { by: CROSSWORD_HOST_ID, name: CROSSWORD_HOST_NAME, at: now, points: 0 },
    },
    feed: pushFeed(game.feed, { at: now, text: `The host filled ${entry.num} ${dirWord(entry.dir)}` }),
  };
}

/** How many words the host had to fill (the finale shows it). */
export const hostSolvedCount = (game: Pick<CrosswordGame, "solved">) =>
  Object.values(game.solved).filter((s) => s.by === CROSSWORD_HOST_ID).length;

/**
 * Per-player rate limit: true if a guess at `at` is within `max` in the
 * trailing `windowS` seconds of `history` (earlier accepted guess times).
 */
export function withinRate(history: number[], at: number, max: number, windowS: number): boolean {
  const from = at - windowS * 1000;
  return history.filter((t) => t > from && t <= at).length < max;
}

/** This puzzle's scores, best first (points, then words, then name). */
export function sortedScores(scores: Record<string, CrosswordScore>): CrosswordScore[] {
  return Object.values(scores).sort(
    (a, b) => b.points - a.points || b.words - a.words || a.name.localeCompare(b.name),
  );
}

// ---------------------------------------------------------------------------
// The wire projection
// ---------------------------------------------------------------------------

/**
 * The only thing that is emitted or served. A cell carries its letter only if
 * a hint showed it or its entry is solved; an entry carries its clue and
 * length, never its answer.
 */
export function toPublicState(
  puzzle: CrosswordPuzzle | null,
  game: Omit<CrosswordGame, "pub">,
  extra: { now: number; today?: { name: string; points: number }[]; inputLive?: boolean },
): CrosswordPublicState {
  const base = {
    sceneId: game.sceneId,
    seq: game.seq,
    serverNow: extra.now,
    phase: game.phase,
    phaseEndsAt: game.phaseEndsAt,
    puzzleNo: game.puzzleNo,
    spotlight: game.spotlight ? { ...game.spotlight } : null,
    scores: sortedScores(game.scores).slice(0, 10),
    today: (extra.today ?? []).slice(0, 10),
    feed: game.feed.slice(-FEED_MAX),
    inputLive: !!extra.inputLive,
    paused: !!game.paused,
  };
  if (!puzzle) {
    return { ...base, title: "", width: 0, height: 0, rows: [], entries: [] };
  }
  const letters = puzzleLetters(puzzle);
  const shown = shownCells(puzzle, game);
  const rows: string[] = [];
  for (let r = 0; r < puzzle.height; r++) {
    let line = "";
    for (let c = 0; c < puzzle.width; c++) {
      const k = cellKey(r, c);
      const ch = letters.get(k);
      line += ch === undefined ? "#" : shown.has(k) ? ch : ".";
    }
    rows.push(line);
  }
  const entries: CrosswordPublicEntry[] = puzzle.entries.map((e) => {
    const s = game.solved[e.id];
    const pe: CrosswordPublicEntry = {
      id: e.id,
      num: e.num,
      dir: e.dir,
      row: e.row,
      col: e.col,
      length: e.answer.length,
      clue: e.clue,
    };
    if (s) pe.solved = { name: s.name, points: s.points, ...(s.late ? { late: true } : {}) };
    return pe;
  });
  return { ...base, title: puzzle.title, width: puzzle.width, height: puzzle.height, rows, entries };
}

/** A fresh, empty game for a scene (phase `idle`). */
export function emptyGame(sceneId: string, now: number): CrosswordGame {
  const g: Omit<CrosswordGame, "pub"> = {
    sceneId,
    puzzleId: "",
    puzzleNo: 0,
    seq: 0,
    phase: "idle",
    phaseEndsAt: 0,
    puzzleStartedAt: 0,
    spotlight: null,
    hints: [],
    solved: {},
    scores: {},
    feed: [],
    paused: false,
  };
  return { ...g, pub: toPublicState(null, g, { now }) };
}

// ---------------------------------------------------------------------------
// Next puzzle
// ---------------------------------------------------------------------------

const lastPlayOn = (p: CrosswordPuzzle, sceneId: string) =>
  Math.max(-Infinity, ...p.plays.filter((x) => x.sceneId === sceneId).map((x) => x.startedAt));

/**
 * The next puzzle for a scene, from `ready` stock: the oldest one this scene
 * has not played; failing that, the one played longest ago, as long as it is
 * not one of the scene's last `noRepeat` plays. Null → `idle`.
 */
export function chooseNextPuzzle(
  puzzles: CrosswordPuzzle[],
  sceneId: string,
  noRepeat: number,
): CrosswordPuzzle | null {
  const ready = puzzles.filter((p) => p.status === "ready" && p.entries.length);
  const fresh = ready
    .filter((p) => !p.plays.some((x) => x.sceneId === sceneId))
    .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  if (fresh.length) return fresh[0];
  const played = ready
    .map((p) => ({ p, at: lastPlayOn(p, sceneId) }))
    .sort((a, b) => a.at - b.at || a.p.id.localeCompare(b.p.id));
  const recent = new Set(
    [...played].sort((a, b) => b.at - a.at).slice(0, noRepeat).map((x) => x.p.id),
  );
  return played.find((x) => !recent.has(x.p.id))?.p ?? null;
}

/** Unplayed ready stock for a scene (the top-up job's measure). */
export const unplayedStock = (puzzles: CrosswordPuzzle[], sceneId: string) =>
  puzzles.filter((p) => p.status === "ready" && !p.plays.some((x) => x.sceneId === sceneId)).length;

// ---------------------------------------------------------------------------
// Names, clues and the blocklist
// ---------------------------------------------------------------------------

/**
 * Built-in blocklist: matched as whole words in clues, and as substrings of a
 * name's letters. The operator adds their own on the config. Kept short and
 * blunt on purpose; it is a backstop, not moderation.
 */
export const BUILTIN_BLOCKLIST: readonly string[] = [
  "fuck", "shit", "cunt", "cock", "dick", "pussy", "bitch", "bastard", "wank", "twat",
  "slut", "whore", "nigger", "nigga", "faggot", "fag", "retard", "spastic", "kike", "chink",
  "paki", "tranny", "dyke", "rape", "rapist", "nazi", "hitler", "porn", "anal", "cum",
];

/** Blocklist terms (built-in + operator's), lowercased letters only. */
export function blocklistTerms(extra: readonly string[] = []): string[] {
  return [...new Set([...BUILTIN_BLOCKLIST, ...extra].map((s) => s.toLowerCase().replace(/[^a-z]/g, "")).filter(Boolean))];
}

/** A clue hits the blocklist when any of its words is a term. */
export function clueHitsBlocklist(clue: string, extra: readonly string[] = []): boolean {
  const terms = new Set(blocklistTerms(extra));
  return clue.toLowerCase().split(/[^a-z]+/).some((w) => w && terms.has(w));
}

/** A name hits the blocklist when its letters contain a term of 4+ letters, or equal a shorter one. */
export function nameHitsBlocklist(name: string, extra: readonly string[] = []): boolean {
  const letters = name.toLowerCase().replace(/[^a-z]/g, "");
  const words = name.toLowerCase().split(/[^a-z]+/).filter(Boolean);
  return blocklistTerms(extra).some((t) => (t.length >= 4 ? letters.includes(t) : words.includes(t)));
}

export const NAME_MAX = 16;

/** Stable "Player 1234" for a player id. */
export function fallbackPlayerName(playerId: string): string {
  let h = 0;
  for (const ch of playerId) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return `Player ${String(h % 10000).padStart(4, "0")}`;
}

/**
 * A display name made safe for air (§4.5): control characters and emoji (OBS
 * Chromium has no emoji font) stripped, whitespace collapsed, a leading "@"
 * dropped, 16 characters at most, checked against the blocklist. A name that
 * fails airs as "Player 1234".
 */
export function cleanPlayerName(name: string, playerId: string, extra: readonly string[] = []): string {
  const s = String(name ?? "")
    .normalize("NFKC")
    .replace(/[\p{Cc}\p{Cf}\p{Extended_Pictographic}\p{Emoji_Modifier}\p{Emoji_Component}]/gu, (m) =>
      /[0-9#*]/.test(m) ? m : "",
    )
    .replace(/[^\p{L}\p{N}\p{P}\p{Zs}]/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^@+/, "")
    .slice(0, NAME_MAX)
    .trim();
  if (!s || !/[\p{L}\p{N}]/u.test(s) || nameHitsBlocklist(s, extra)) return fallbackPlayerName(playerId);
  return s;
}

export const CLUE_MIN = 8;
export const CLUE_MAX = 48;

/** Tidy a stored clue: trim, collapse whitespace, strip a trailing "(N)" / "(3,4)" letter count. */
export function cleanClue(clue: string): string {
  return String(clue ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\s*\(\s*\d+(?:\s*[,-]\s*\d+)*\s*\)\s*$/, "")
    .trim();
}

const ENDINGS = ["INGS", "ING", "IES", "IED", "ERS", "EST", "ED", "ER", "ES", "LY", "S", "Y", "E"];

/**
 * The answer with one common ending removed (≥ 3 letters kept), for the leak
 * test: a clue word starting with the answer or its stem leaks it, and so does
 * an answer of 5+ letters anywhere in the clue's letters ("sea horse").
 */
export function answerStem(answer: string): string {
  const a = normalizeAnswer(answer);
  for (const end of ENDINGS) {
    if (a.endsWith(end) && a.length - end.length >= 3) return a.slice(0, -end.length);
  }
  return a;
}

export type ClueProblem = "short" | "long" | "leak" | "blocked";

/**
 * Why a clue cannot air, or null if it can (§7.3 step 4): under 8 or over 48
 * characters, contains the answer or its stem, or hits the blocklist. Run on
 * a `cleanClue`d clue.
 */
export function validateClue(clue: string, answer: string, extra: readonly string[] = []): ClueProblem | null {
  const c = clue.trim();
  if (c.length < CLUE_MIN) return "short";
  if (c.length > CLUE_MAX) return "long";
  const a = normalizeAnswer(answer);
  const stem = answerStem(a);
  const words = c.toUpperCase().split(/[^A-Z]+/).filter(Boolean);
  if (normalizeAnswer(c).includes(a) && a.length >= 5) return "leak";
  if (words.some((w) => w.startsWith(a) || (stem.length >= 3 && w.startsWith(stem)))) return "leak";
  if (clueHitsBlocklist(c, extra)) return "blocked";
  return null;
}
