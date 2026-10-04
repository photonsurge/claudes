/**
 * Fixture for the *.plan.test files (tests written from the plan, §4.3 / §5):
 * a real puzzle with its answers and a game on it, projected with the shared
 * `toPublicState`, so the tests see exactly what the worker would emit.
 *
 *   Q U A R K      1A QUARK  (open)
 *   U # T # #      1D QUIZ   (solved by rich)
 *   I # O # #      2D ATOM   (open, the host leaked its T)
 *   Z # M # #
 *   # # # # #
 *
 * Shown on the board: Q U I Z (the solved word) and T (the hint). Never shown:
 * the A R K of QUARK, the A O M of ATOM.
 */
import {
  CROSSWORD_HOST_NAME,
  toPublicState,
  type CrosswordGame,
  type CrosswordPublicState,
  type CrosswordPuzzle,
} from "@photonsurge/shared/crossword";

export const PUZZLE: CrosswordPuzzle = {
  id: "pz1",
  title: "Particles",
  width: 5,
  height: 5,
  entries: [
    { id: "1A", num: 1, dir: "across", row: 0, col: 0, answer: "QUARK", clue: "Building block of a proton", wordId: "w1", clueId: "c1" },
    { id: "1D", num: 1, dir: "down", row: 0, col: 0, answer: "QUIZ", clue: "Pub test of knowledge", wordId: "w2", clueId: "c2" },
    { id: "2D", num: 2, dir: "down", row: 0, col: 2, answer: "ATOM", clue: "Smallest unit of an element", wordId: "w3", clueId: "c3" },
  ],
  status: "ready",
  familyFriendly: true,
  source: "seed",
  createdAt: 1,
  plays: [],
};

/** Letters a correct page may draw, and letters it must never draw. */
export const SHOWN_LETTERS = ["I", "Q", "T", "U", "Z"];
export const HIDDEN_ANSWERS = ["QUARK", "ATOM"];

export type GameNoPub = Omit<CrosswordGame, "pub">;

export function game(p: Partial<GameNoPub> = {}): GameNoPub {
  return {
    sceneId: "xw",
    puzzleId: PUZZLE.id,
    puzzleNo: 42,
    seq: 3,
    phase: "playing",
    phaseEndsAt: 0,
    puzzleStartedAt: 0,
    spotlight: { entryId: "2D", startedAt: 1000, endsAt: 61_000 },
    hints: [{ row: 1, col: 2, at: 500 }],
    solved: { "1D": { by: "sim:rich", name: "rich", at: 400, points: 4 } },
    scores: { "sim:rich": { name: "rich", points: 4, words: 1 } },
    feed: [{ at: 400, text: "rich took 1 down +4" }],
    paused: false,
    ...p,
  };
}

export function pub(g: Partial<GameNoPub> = {}, extra: { now?: number; inputLive?: boolean } = {}): CrosswordPublicState {
  return toPublicState(PUZZLE, game(g), { now: extra.now ?? 1000, inputLive: extra.inputLive ?? true, today: [] });
}

/** The finale: every word filled, QUARK by the host, ATOM by ann. */
export function finalePub(p: Partial<GameNoPub> = {}): CrosswordPublicState {
  return pub({
    phase: "finale",
    spotlight: null,
    solved: {
      "1D": { by: "sim:rich", name: "rich", at: 400, points: 4 },
      "2D": { by: "sim:ann", name: "ann", at: 600, points: 3 },
      "1A": { by: "host", name: CROSSWORD_HOST_NAME, at: 900, points: 0 },
    },
    scores: {
      "sim:rich": { name: "rich", points: 4, words: 1 },
      "sim:ann": { name: "ann", points: 3, words: 1 },
    },
    ...p,
  });
}

/** A minimal socket.io-like emitter the hooks can subscribe to. */
export function fakeSocket() {
  const handlers = new Map<string, Set<(m: unknown) => void>>();
  return {
    on(ev: string, fn: (m: unknown) => void) {
      if (!handlers.has(ev)) handlers.set(ev, new Set());
      handlers.get(ev)!.add(fn);
    },
    off(ev: string, fn: (m: unknown) => void) {
      handlers.get(ev)?.delete(fn);
    },
    emit(ev: string, msg?: unknown) {
      for (const fn of [...(handlers.get(ev) ?? [])]) fn(msg);
    },
  };
}
