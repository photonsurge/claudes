/**
 * Client calls and wire types for /admin/crosswords/{puzzles,players,desk}
 * (docs/crossword-mode-plan.md §8.3, §8.4). Every call resolves to an outcome,
 * never throws: `{ ok: false, error }` carries the route's own message (a clue
 * refused for leaking its answer, a drop that would split the grid), since it
 * says what to fix.
 */
import type { CrosswordCommand, CrosswordPuzzle, CrosswordPuzzleSource, CrosswordPuzzleStatus } from "@photonsurge/shared/crossword";
import type { CrosswordPlayerRow } from "@photonsurge/shared/crossword-records";

export type Outcome<T> = { ok: true; data: T } | { ok: false; error: string };

export async function call<T>(url: string, init?: RequestInit): Promise<Outcome<T>> {
  try {
    const res = await fetch(url, { cache: "no-store", ...init });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: body?.error || `HTTP ${res.status}` };
    return { ok: true, data: body as T };
  } catch (err) {
    return { ok: false, error: String((err as Error)?.message ?? err) };
  }
}

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

// ---------------------------------------------------------------------------
// Puzzles
// ---------------------------------------------------------------------------

/** A puzzle as the list shows it: no entries, so no answers. */
export interface PuzzleRow {
  id: string;
  title: string;
  theme: string;
  status: CrosswordPuzzleStatus;
  source: CrosswordPuzzleSource;
  model?: string;
  createdAt: number;
  width: number;
  height: number;
  words: number;
  plays: number;
  lastPlayedAt?: number;
  /** Scenes that have played it, in first-play order. */
  scenes: string[];
}

export interface PuzzleListResponse {
  puzzles: PuzzleRow[];
}

/** What PATCH /api/crossword/puzzles/:id accepts. */
export type PuzzlePatch =
  | { action: "approve" }
  | { action: "reject" }
  | { action: "clue"; entryId: string; clue: string }
  | { action: "drop"; entryId: string };

export interface PuzzleFilters {
  status?: CrosswordPuzzleStatus | "";
  source?: CrosswordPuzzleSource | "";
  theme?: string;
}

export function puzzlesUrl(f: PuzzleFilters = {}): string {
  const sp = new URLSearchParams();
  if (f.status) sp.set("status", f.status);
  if (f.source) sp.set("source", f.source);
  if (f.theme?.trim()) sp.set("theme", f.theme.trim());
  const qs = sp.toString();
  return `/api/crossword/puzzles${qs ? `?${qs}` : ""}`;
}

export const listPuzzles = (f: PuzzleFilters = {}) => call<PuzzleListResponse>(puzzlesUrl(f));
export const getPuzzle = (id: string) => call<CrosswordPuzzle>(`/api/crossword/puzzles/${encodeURIComponent(id)}`);
export const patchPuzzle = (id: string, patch: PuzzlePatch) =>
  call<CrosswordPuzzle>(`/api/crossword/puzzles/${encodeURIComponent(id)}`, json("PATCH", patch));
export const generatePuzzle = (sceneId: string, theme?: string) =>
  call<{ queued: true }>("/api/crossword/generate", json("POST", theme?.trim() ? { sceneId, theme: theme.trim() } : { sceneId }));

/** The Words admin, searched for this answer (the bank id isn't on the puzzle). */
export const wordSearchHref = (answer: string) => `/admin/crosswords/words?q=${encodeURIComponent(answer)}`;

// ---------------------------------------------------------------------------
// Players
// ---------------------------------------------------------------------------

export interface PlayerListResponse {
  players: CrosswordPlayerRow[];
}

export const listPlayers = () => call<PlayerListResponse>("/api/crossword/players");
export const setPlayerHidden = (id: string, hidden: boolean) =>
  call<{ ok: true; hidden: boolean }>(`/api/crossword/players/${encodeURIComponent(id)}`, json("PATCH", { hidden }));

// ---------------------------------------------------------------------------
// Desk
// ---------------------------------------------------------------------------

const scenePath = (sceneId: string) => `/api/crossword/${encodeURIComponent(sceneId)}`;

export const sendCommand = (sceneId: string, command: CrosswordCommand) =>
  call<{ queued: true }>(`${scenePath(sceneId)}/command`, json("POST", { command }));
export const sendSim = (sceneId: string, name: string, text: string) =>
  call<{ queued: true }>(`${scenePath(sceneId)}/sim`, json("POST", { name, text }));
export const stateUrl = (sceneId: string) => `${scenePath(sceneId)}/state`;

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

export const fmtTime = (ms?: number): string => {
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms <= 0) return "—";
  return new Date(ms).toLocaleString();
};
