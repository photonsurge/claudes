/**
 * The host loop's side of the cross-package batch, against
 * docs/crossword-mode-plan.md §4.4, §7.4 and §7.5, written from the plan and
 * the batch's intent:
 *
 *  - a channel whose eligible stock is all inside the no-repeat window
 *    replays the puzzle played longest ago; it idles only with no eligible
 *    ready puzzle;
 *  - a puzzle rejected while on air finishes its current clue and ends
 *    without revealing its open words; rejected in its intro, it never airs
 *    a clue;
 *  - two workers never host one game: saves are conditional on seq and the
 *    loser stands down for a back-off;
 *  - puzzles built from unapproved words never play unless
 *    CROSSWORD_ALLOW_UNAPPROVED=true.
 */
jest.mock("../socket", () => ({ emitWorkerEvent: jest.fn() }));
jest.mock("@photonsurge/shared/utill/logger", () => ({ log: jest.fn() }));

import {
  cellKey,
  entryCells,
  mergeCrosswordConfig,
  numberEntries,
  CROSSWORD_STATE,
  DEFAULT_CROSSWORD_CONFIG,
  type CrosswordConfig,
  type CrosswordGame,
  type CrosswordPublicState,
  type CrosswordPuzzle,
} from "@photonsurge/shared/crossword";
import type { CrosswordSolve } from "@photonsurge/shared/crossword-records";
import { commandTo, newCrosswordRunnerState, step, submitAnswersTo, type CrosswordRunnerDeps, type CrosswordRunnerState } from "./runner";

const SCENE = "batch";
const T0 = Date.UTC(2026, 9, 4, 9, 0, 0);
/** First spotlight, with the default 12 s intro. */
const S = T0 + 12_000;

type Spec = { answer: string; clue: string; row: number; col: number; dir: "across" | "down" };
/**
 *  C A T      1A CAT, 1D CAR, 2D TAD, 3A RODE
 *  A . A
 *  R O D E
 */
const SMALL: Spec[] = [
  { answer: "CAT", clue: "Feline pet", row: 0, col: 0, dir: "across" },
  { answer: "CAR", clue: "Road vehicle", row: 0, col: 0, dir: "down" },
  { answer: "TAD", clue: "A little bit", row: 0, col: 2, dir: "down" },
  { answer: "RODE", clue: "Sat on a horse", row: 2, col: 0, dir: "across" },
];

function mk(id: string, o: Partial<CrosswordPuzzle> = {}): CrosswordPuzzle {
  return {
    id,
    title: `Puzzle ${id}`,
    width: 4,
    height: 3,
    entries: numberEntries(SMALL.map((s, i) => ({ ...s, wordId: `w${i}`, clueId: `c${i}` }))),
    status: "ready",
    familyFriendly: true,
    source: "bank",
    createdAt: 1,
    plays: [],
    ...o,
  };
}

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));

/** A shared Mongo stand-in. Game saves honour the conditional write: only over an older seq. */
function world(opts: { puzzles?: CrosswordPuzzle[]; cfg?: Partial<CrosswordConfig> } = {}) {
  const puzzles = new Map((opts.puzzles ?? [mk("p1")]).map((p) => [p.id, clone(p)]));
  let cfg = mergeCrosswordConfig(DEFAULT_CROSSWORD_CONFIG, { enabled: true, playOffAir: true, ...opts.cfg });
  let game: CrosswordGame | null = null;
  const storedSeqs: number[] = [];
  let refused = 0;
  const solves: CrosswordSolve[] = [];
  const db = {
    crosswordScenes: jest.fn(async () => [SCENE]),
    getOrInitCrosswordConfig: jest.fn(async () => cfg),
    activeRunForScene: jest.fn(async () => null),
    crosswordGames: {
      get: jest.fn(async () => (game ? clone(game) : null)),
      save: jest.fn(async (g: CrosswordGame) => {
        if (game && !(game.seq < g.seq)) {
          refused++;
          return false;
        }
        game = clone(g);
        storedSeqs.push(g.seq);
        return true;
      }),
    },
    crosswordPuzzles: {
      list: jest.fn(async ({ status }: { status?: string } = {}) => clone([...puzzles.values()].filter((p) => !status || p.status === status))),
      get: jest.fn(async (pid: string) => (puzzles.has(pid) ? clone(puzzles.get(pid)!) : null)),
      startPlay: jest.fn(async (pid: string, sceneId: string, startedAt: number) => {
        puzzles.get(pid)?.plays.push({ sceneId, startedAt });
        return true;
      }),
      endPlay: jest.fn(async (pid: string, sceneId: string, startedAt: number, endedAt: number) => {
        const p = puzzles.get(pid)?.plays.find((x) => x.sceneId === sceneId && x.startedAt === startedAt);
        if (p) p.endedAt = endedAt;
        return !!p;
      }),
    },
    crosswordSolves: {
      append: jest.fn(async (s: CrosswordSolve) => void solves.push(clone(s))),
      board: jest.fn(async () => []),
    },
    crosswordPlayers: {
      touch: jest.fn(async (pid: string, name: string, at: number) => ({ id: pid, name, hidden: false, firstSeen: at, lastSeen: at })),
      hiddenIds: jest.fn(async () => []),
    },
  };
  const deps = () => {
    const emitted: { type: string; data: any }[] = [];
    const d: CrosswordRunnerDeps = {
      db: db as unknown as CrosswordRunnerDeps["db"],
      emit: (type, data) => emitted.push({ type, data: clone(data) }),
    };
    return { deps: d, emitted };
  };
  return {
    db,
    puzzles,
    storedSeqs,
    refused: () => refused,
    deps,
    get game() {
      return game;
    },
    setCfg: (patch: Partial<CrosswordConfig>) => (cfg = mergeCrosswordConfig(cfg, patch)),
    reject: (pid: string) => void (puzzles.get(pid)!.status = "rejected"),
  };
}

function host(w = world(), start = T0) {
  const { deps, emitted } = w.deps();
  const state: CrosswordRunnerState = newCrosswordRunnerState();
  let now = start;
  return {
    w,
    deps,
    emitted,
    state,
    get now() {
      return now;
    },
    g: () => state.scenes.get(SCENE)?.game,
    async start() {
      await step(state, now, deps);
    },
    async until(t: number) {
      while (now < t) {
        now = Math.min(t, now + 500);
        await step(state, now, deps);
      }
    },
    /** Step to `t` without running the loop (a worker that died). */
    jump(t: number) {
      now = t;
    },
    answer(name: string, text: string) {
      return submitAnswersTo(state, SCENE, [{ playerId: `youtube:${name}`, name, text, typedAt: now }], now, deps);
    },
  };
}

const states = (emitted: { type: string; data: any }[]) =>
  emitted.filter((e) => e.type === CROSSWORD_STATE).map((e) => e.data as CrosswordPublicState);
const idOf = (p: CrosswordPuzzle, answer: string) => p.entries.find((e) => e.answer === answer)!.id;

let savedEnv: string | undefined;
beforeEach(() => {
  savedEnv = process.env.CROSSWORD_ALLOW_UNAPPROVED;
  delete process.env.CROSSWORD_ALLOW_UNAPPROVED;
});
afterEach(() => {
  if (savedEnv === undefined) delete process.env.CROSSWORD_ALLOW_UNAPPROVED;
  else process.env.CROSSWORD_ALLOW_UNAPPROVED = savedEnv;
});

// ---------------------------------------------------------------------------
// Replay rather than idle (§4.4, §7.5)
// ---------------------------------------------------------------------------

describe("replay rather than idle", () => {
  test("every puzzle inside the no-repeat window: the one played longest ago goes on air", async () => {
    const h = host(
      world({
        puzzles: [
          mk("recent", { plays: [{ sceneId: SCENE, startedAt: T0 - 1_000, endedAt: T0 - 500 }] }),
          mk("oldest", { plays: [{ sceneId: SCENE, startedAt: T0 - 9_000, endedAt: T0 - 8_000 }] }),
          mk("middle", { plays: [{ sceneId: SCENE, startedAt: T0 - 5_000, endedAt: T0 - 4_000 }] }),
        ],
        cfg: { noRepeatPuzzles: 30 },
      }),
    );
    await h.start();
    expect(h.g()).toMatchObject({ phase: "intro", puzzleId: "oldest" });
  });

  test("a channel whose only puzzle just finished plays it again instead of idling", async () => {
    const h = host(world({ puzzles: [mk("only")], cfg: { noRepeatPuzzles: 30 } }));
    await h.start();
    expect(h.g()).toMatchObject({ phase: "intro", puzzleId: "only", puzzleNo: 1 });
    await h.answer("ann", "rode");
    await h.until(S + 1_000);
    for (const w of ["car", "cat", "tad", "rode"]) await h.answer("ann", w);
    // Through the finale and on.
    await h.until(h.now + 45_000);
    expect(h.g()).toMatchObject({ phase: expect.stringMatching(/intro|playing/), puzzleId: "only", puzzleNo: 2 });
    expect(h.w.puzzles.get("only")!.plays.filter((x) => x.sceneId === SCENE)).toHaveLength(2);
  });

  test("idle when no ready puzzle fits the channel", async () => {
    const h = host(
      world({
        puzzles: [mk("notff", { familyFriendly: false }), mk("rej", { status: "rejected" })],
        cfg: { familyFriendlyOnly: true },
      }),
    );
    await h.start();
    await h.until(T0 + 10_000);
    expect(h.g()?.phase).toBe("idle");
    expect(h.g()?.puzzleId ?? "").toBe("");
  });
});

// ---------------------------------------------------------------------------
// Unapproved puzzles (§7.4 dev switch)
// ---------------------------------------------------------------------------

describe("puzzles built from unapproved words", () => {
  test("never play without CROSSWORD_ALLOW_UNAPPROVED=true", async () => {
    const h = host(world({ puzzles: [mk("u", { unapproved: true })], cfg: { familyFriendlyOnly: false } }));
    await h.start();
    await h.until(T0 + 10_000);
    expect(h.g()?.phase).toBe("idle");
  });

  test("any other value of the switch is off", async () => {
    process.env.CROSSWORD_ALLOW_UNAPPROVED = "1";
    const h = host(world({ puzzles: [mk("u", { unapproved: true })], cfg: { familyFriendlyOnly: false } }));
    await h.start();
    expect(h.g()?.phase).toBe("idle");
  });

  test("an approved puzzle is chosen over an older unapproved one", async () => {
    const h = host(world({ puzzles: [mk("u", { unapproved: true, createdAt: 1 }), mk("ok", { createdAt: 2 })] }));
    await h.start();
    expect(h.g()?.puzzleId).toBe("ok");
  });

  test("play with the switch on", async () => {
    process.env.CROSSWORD_ALLOW_UNAPPROVED = "true";
    const h = host(world({ puzzles: [mk("u", { unapproved: true, familyFriendly: false })], cfg: { familyFriendlyOnly: false } }));
    await h.start();
    expect(h.g()).toMatchObject({ phase: "intro", puzzleId: "u" });
  });
});

// ---------------------------------------------------------------------------
// Rejected on air (§7.4)
// ---------------------------------------------------------------------------

describe("a puzzle rejected while on air", () => {
  const p = mk("bad");

  test("finishes the clue on air, then ends without revealing its open words", async () => {
    const h = host(world({ puzzles: [p, mk("next", { createdAt: 2 })] }));
    await h.start();
    await h.until(S + 5_000);
    const first = h.g()!.spotlight!.entryId;
    expect(first).toBe(idOf(p, "RODE"));
    h.w.reject("bad");

    // Well after any status check: the same clue is still on air.
    await h.until(S + 30_000);
    expect(h.g()).toMatchObject({ phase: "playing", puzzleId: "bad" });
    expect(h.g()!.spotlight!.entryId).toBe(first);

    // The clue runs out (the host fills it, as at every clue's end), and the puzzle ends there.
    await h.until(S + 75_000);
    const g = h.g()!;
    expect(g.puzzleId === "bad" ? g.phase : "moved on").not.toBe("playing");
    // No other spotlight ever came up on the rejected puzzle.
    const spotlit = new Set(states(h.emitted).filter((s) => s.title === "Puzzle bad" && s.spotlight).map((s) => s.spotlight!.entryId));
    expect([...spotlit]).toEqual([first]);

    // No open word was revealed on the wire: only the clue on air is solved,
    // and no cell that belongs only to an open word ever showed.
    const bad = states(h.emitted).filter((s) => s.title === "Puzzle bad");
    const openOnly = new Set<string>();
    const firstCells = new Set(entryCells(p.entries.find((e) => e.id === first)!).map((c) => cellKey(c.row, c.col)));
    for (const e of p.entries) {
      if (e.id === first) continue;
      for (const c of entryCells(e)) if (!firstCells.has(cellKey(c.row, c.col))) openOnly.add(cellKey(c.row, c.col));
    }
    for (const s of bad) {
      for (const e of s.entries) if (e.id !== first) expect(e.solved).toBeUndefined();
      for (const k of openOnly) {
        const [r, c] = k.split(",").map(Number);
        const ch = s.rows[r]?.[c];
        // Hints only ever go into the spotlight word, so nothing shows here.
        expect([k, ch]).toEqual([k, "."]);
      }
    }
    // The stored game never shows the open words as solved either.
    const stored = h.w.game!;
    if (stored.puzzleId === "bad") for (const e of p.entries) if (e.id !== first) expect(stored.solved[e.id]).toBeUndefined();
  });

  test("a viewer may still take the clue on air; then the puzzle ends", async () => {
    const h = host(world({ puzzles: [p] }));
    await h.start();
    await h.until(S + 2_000);
    h.w.reject("bad");
    await h.until(S + 12_000);
    expect((await h.answer("ann", "rode")).solved).toEqual([idOf(p, "RODE")]);
    await h.until(S + 20_000);
    const g = h.g()!;
    expect(g.phase === "playing" && g.puzzleId === "bad").toBe(false);
    expect(states(h.emitted).filter((s) => s.title === "Puzzle bad").pop()!.entries.filter((e) => e.solved)).toHaveLength(1);
  });

  test("rejected in its intro, no clue of it ever airs", async () => {
    const h = host(world({ puzzles: [p, mk("next", { createdAt: 2 })] }));
    await h.start();
    expect(h.g()).toMatchObject({ phase: "intro", puzzleId: "bad" });
    h.w.reject("bad");
    await h.until(S + 20_000);
    expect(states(h.emitted).some((s) => s.title === "Puzzle bad" && s.phase === "playing")).toBe(false);
    expect(h.g()?.puzzleId).toBe("next");
  });

  test("Next puzzle from the Desk does not reveal a rejected puzzle's open words", async () => {
    const h = host(world({ puzzles: [p] }));
    await h.start();
    await h.until(S + 2_000);
    h.w.reject("bad");
    await h.until(S + 12_000);
    await commandTo(h.state, SCENE, { command: "nextPuzzle" } as never, h.now, h.deps);
    const last = states(h.emitted).filter((s) => s.title === "Puzzle bad").pop()!;
    expect(last.entries.filter((e) => e.solved)).toHaveLength(0);
    expect(last.rows.join("")).not.toMatch(/[A-Z]/);
  });

  test("a rejected puzzle is not played again", async () => {
    const h = host(world({ puzzles: [p] }));
    await h.start();
    await h.until(S + 2_000);
    h.w.reject("bad");
    await h.until(S + 200_000);
    expect(h.g()?.phase).toBe("idle");
    expect(h.w.puzzles.get("bad")!.plays).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Two workers never host one game (§4.4)
// ---------------------------------------------------------------------------

describe("two workers on one scene", () => {
  async function race() {
    const w = world({ puzzles: [mk("a"), mk("b", { createdAt: 2 })] });
    const A = host(w);
    const B = host(w);
    const both = async (t: number) => {
      while (A.now < t) {
        const next = Math.min(t, A.now + 500);
        await A.until(next);
        await B.until(next);
      }
    };
    return { w, A, B, both };
  }

  /** Both run until the first change after the intro (S), the first save they contest. */
  const SETTLED = S + 3_000;

  test("once they contest a save, exactly one of them hosts the scene", async () => {
    const { A, B, both } = await race();
    await both(SETTLED);
    const hosting = [A, B].filter((h) => h.state.scenes.has(SCENE));
    expect(hosting).toHaveLength(1);
  });

  test("the stored game's seq never goes backwards", async () => {
    const { w, both } = await race();
    await both(T0 + 120_000);
    const seqs = w.storedSeqs;
    expect(seqs.length).toBeGreaterThan(5);
    for (let i = 1; i < seqs.length; i++) expect(seqs[i]).toBeGreaterThan(seqs[i - 1]);
  });

  test("the loser stands down: no state, no save, for the back-off and longer while the other host is alive", async () => {
    const { w, A, B, both } = await race();
    await both(SETTLED);
    const loser = A.state.scenes.has(SCENE) ? B : A;
    const winner = loser === A ? B : A;
    const mark = loser.emitted.length;
    const winnerMark = winner.emitted.length;
    const refused = w.refused();
    await both(T0 + 200_000);
    expect(states(loser.emitted.slice(mark))).toHaveLength(0);
    expect(loser.state.scenes.has(SCENE)).toBe(false);
    expect(w.refused()).toBe(refused);
    // The winner carried on.
    expect(states(winner.emitted.slice(winnerMark)).length).toBeGreaterThan(5);
  });

  test("between its lost save and standing down, the loser takes no answer (no solve logged for a game nobody hosts)", async () => {
    const { w, A, B, both } = await race();
    // Step until one of them has lost a save (and not yet polled again).
    let loser: ReturnType<typeof host> | undefined;
    for (let t = T0 + 500; !loser && t < T0 + 30_000; t += 500) {
      await both(t);
      loser = [A, B].find((h) => h.state.scenes.get(SCENE)?.stopped);
    }
    expect(loser).toBeDefined();
    const res = await loser!.answer("ann", "rode");
    expect(res.solved).toEqual([]);
    expect(w.db.crosswordSolves.append).not.toHaveBeenCalled();
  });

  test("when the other host goes quiet, the loser takes the scene back after the back-off, not before", async () => {
    const { A, B, both } = await race();
    await both(SETTLED);
    const loser = A.state.scenes.has(SCENE) ? B : A;
    const mark = loser.emitted.length;
    // The winner dies: only the loser steps from here.
    await loser.until(T0 + 200_000);
    expect(loser.state.scenes.has(SCENE)).toBe(true);
    const back = states(loser.emitted.slice(mark));
    expect(back.length).toBeGreaterThan(0);
    // Not back before a back-off counted from the lost save (at S at the earliest).
    expect(back[0].serverNow).toBeGreaterThanOrEqual(S + 60_000);
  });
});
