/**
 * The host loop against docs/crossword-mode-plan.md §4.2–§4.6, §7.5 and §12
 * (worker lines). Written from the plan; runner.test.ts holds the build's own.
 */
jest.mock("../socket", () => ({ emitWorkerEvent: jest.fn() }));
jest.mock("@photonsurge/shared/utill/logger", () => ({ log: jest.fn() }));

import {
  cellKey,
  entryCells,
  mergeCrosswordConfig,
  numberEntries,
  CROSSWORD_BEAT,
  CROSSWORD_HOST_ID,
  CROSSWORD_STATE,
  DEFAULT_CROSSWORD_CONFIG,
  type CrosswordConfig,
  type CrosswordGame,
  type CrosswordPublicState,
  type CrosswordPuzzle,
} from "@photonsurge/shared/crossword";
import type { CrosswordPlayer, CrosswordSolve } from "@photonsurge/shared/crossword-records";
import {
  newCrosswordRunnerState,
  step,
  submitAnswersTo,
  type CrosswordChatAnswer,
  type CrosswordRunnerDeps,
  type CrosswordRunnerState,
} from "./runner";
import { handleInject } from "./inject";

const SCENE = "plan";
const T0 = Date.UTC(2026, 9, 4, 9, 0, 0);
/** When the first spotlight starts with the default 12 s intro. */
const S = T0 + 12_000;

type Spec = { answer: string; clue: string; row: number; col: number; dir: "across" | "down" };

/**
 *  C A T .      1A CAT  (3)   1D CAR (3)
 *  A . A .      3A RODE (4)   2D TAD (3)
 *  R O D E
 */
const SMALL: Spec[] = [
  { answer: "CAT", clue: "Feline pet", row: 0, col: 0, dir: "across" },
  { answer: "CAR", clue: "Road vehicle", row: 0, col: 0, dir: "down" },
  { answer: "TAD", clue: "A little bit", row: 0, col: 2, dir: "down" },
  { answer: "RODE", clue: "Sat on a horse", row: 2, col: 0, dir: "across" },
];

/** ELEPHANT across with LAB down through its L. */
const LONG: Spec[] = [
  { answer: "ELEPHANT", clue: "Large grey mammal", row: 0, col: 0, dir: "across" },
  { answer: "LAB", clue: "Science room", row: 0, col: 1, dir: "down" },
];

function mk(
  id: string,
  o: { createdAt?: number; familyFriendly?: boolean; status?: "ready" | "rejected"; specs?: Spec[]; plays?: CrosswordPuzzle["plays"] } = {},
): CrosswordPuzzle {
  const specs = o.specs ?? SMALL;
  return {
    id,
    title: `Puzzle ${id}`,
    width: Math.max(...specs.map((s) => s.col + (s.dir === "across" ? s.answer.length : 1))),
    height: Math.max(...specs.map((s) => s.row + (s.dir === "down" ? s.answer.length : 1))),
    entries: numberEntries(specs),
    status: o.status ?? "ready",
    familyFriendly: o.familyFriendly ?? true,
    source: "seed",
    createdAt: o.createdAt ?? 1,
    plays: o.plays ?? [],
  };
}

const id = (p: CrosswordPuzzle, answer: string) => p.entries.find((e) => e.answer === answer)!.id;

function world(opts: { puzzles?: CrosswordPuzzle[]; cfg?: Partial<CrosswordConfig> } = {}) {
  const puzzles = new Map((opts.puzzles ?? [mk("p1")]).map((p) => [p.id, p]));
  let cfg = mergeCrosswordConfig(DEFAULT_CROSSWORD_CONFIG, { enabled: true, playOffAir: true, ...opts.cfg });
  let run: { id: string; status: string; startAt?: number; chat?: { enabled: boolean } } | null = null;
  let game: CrosswordGame | null = null;
  const solves: CrosswordSolve[] = [];
  const players = new Map<string, CrosswordPlayer>();
  const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));
  const base = {
    crosswordScenes: jest.fn(async () => [SCENE]),
    getOrInitCrosswordConfig: jest.fn(async () => cfg),
    activeRunForScene: jest.fn(async () => run),
    crosswordGames: {
      get: jest.fn(async () => (game ? clone(game) : null)),
      save: jest.fn(async (g: CrosswordGame) => void (game = clone(g))),
    },
    crosswordPuzzles: {
      list: jest.fn(async ({ status }: { status?: string } = {}) =>
        clone([...puzzles.values()].filter((p) => !status || p.status === status)),
      ),
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
      board: jest.fn(async (o: { since?: number; hiddenIds?: string[] }) => {
        const m = new Map<string, { playerId: string; name: string; points: number; words: number }>();
        for (const s of solves) {
          if ((o.since != null && s.at < o.since) || o.hiddenIds?.includes(s.playerId)) continue;
          const r = m.get(s.playerId) ?? { playerId: s.playerId, name: s.name, points: 0, words: 0 };
          r.points += s.points;
          r.words += 1;
          m.set(s.playerId, r);
        }
        return [...m.values()].sort((a, b) => b.points - a.points);
      }),
    },
    crosswordPlayers: {
      touch: jest.fn(async (pid: string, name: string, at: number) => {
        const p = players.get(pid) ?? { id: pid, name, hidden: false, firstSeen: at, lastSeen: at };
        p.name = name;
        p.lastSeen = at;
        players.set(pid, p);
        return { ...p };
      }),
      hiddenIds: jest.fn(async () => [...players.values()].filter((p) => p.hidden).map((p) => p.id)),
    },
    chatLog: { append: jest.fn(), add: jest.fn(), insert: jest.fn() },
  };
  // Every top-level db property the runner touches, so a stray chat write shows up.
  const touched = new Set<string>();
  const db = new Proxy(base, {
    get(t, k, r) {
      if (typeof k === "string") touched.add(k);
      return Reflect.get(t, k, r);
    },
  });
  const emitted: { type: string; data: any }[] = [];
  const deps: CrosswordRunnerDeps = {
    db: db as unknown as CrosswordRunnerDeps["db"],
    emit: (type, data) => emitted.push({ type, data: clone(data) }),
  };
  return {
    db: base,
    deps,
    emitted,
    solves,
    puzzles,
    players,
    touched,
    get game() {
      return game;
    },
    setCfg: (patch: Partial<CrosswordConfig>) => (cfg = mergeCrosswordConfig(cfg, patch)),
    setRun: (r: typeof run) => (run = r),
  };
}

function host(w = world(), state: CrosswordRunnerState = newCrosswordRunnerState(), start = T0) {
  let now = start;
  return {
    w,
    state,
    get now() {
      return now;
    },
    g: () => state.scenes.get(SCENE)!.game,
    pub: () => state.scenes.get(SCENE)!.game.pub,
    async start() {
      await step(state, now, w.deps);
    },
    /** Step every 500 ms until `t` (absolute). */
    async until(t: number) {
      while (now < t) {
        now = Math.min(t, now + 500);
        await step(state, now, w.deps);
      }
    },
    async for(ms: number) {
      await this.until(now + ms);
    },
    answer(msgs: Partial<CrosswordChatAnswer>[]) {
      return submitAnswersTo(
        state,
        SCENE,
        msgs.map((m) => ({ playerId: `youtube:${m.name}`, name: "", text: "", typedAt: now, ...m })),
        now,
        w.deps,
      );
    },
  };
}

const pubStates = (emitted: { type: string; data: any }[]) =>
  emitted.filter((e) => e.type === CROSSWORD_STATE).map((e) => e.data as CrosswordPublicState);

// ---------------------------------------------------------------------------
// §4.4 phases
// ---------------------------------------------------------------------------

describe("phases (§4.4)", () => {
  test("intro 12 s → playing → finale 30 s → the next puzzle's intro", async () => {
    const h = host(world({ puzzles: [mk("a", { createdAt: 1 }), mk("b", { createdAt: 2 })] }));
    await h.start();
    expect(h.g()).toMatchObject({ phase: "intro", puzzleId: "a", puzzleNo: 1, phaseEndsAt: T0 + 12_000 });
    await h.until(T0 + 11_500);
    expect(h.g().phase).toBe("intro");
    await h.until(T0 + 12_000);
    expect(h.g().phase).toBe("playing");
    expect(h.g().spotlight).toMatchObject({ startedAt: S, endsAt: S + 60_000 });

    // Nobody answers: four clues of 60 s, each with a 6 s hold.
    const finaleAt = S + 4 * 66_000;
    await h.until(finaleAt - 500);
    expect(h.g().phase).toBe("playing");
    await h.until(finaleAt);
    expect(h.g()).toMatchObject({ phase: "finale", phaseEndsAt: finaleAt + 30_000 });
    expect(h.g().spotlight).toBeNull();

    await h.until(finaleAt + 29_500);
    expect(h.g().phase).toBe("finale");
    await h.until(finaleAt + 30_000);
    expect(h.g()).toMatchObject({ phase: "intro", puzzleId: "b", puzzleNo: 2 });
    expect(h.g().solved).toEqual({});
    expect(h.w.puzzles.get("a")!.plays[0]).toMatchObject({ sceneId: SCENE, startedAt: T0, endedAt: finaleAt + 30_000 });
  });

  test("spotlight order: most letters showing first, ties to the lowest number; the first pick is the longest word", async () => {
    const h = host();
    const p = mk("p1");
    await h.start();
    const order: string[] = [];
    for (let t = T0; t <= S + 4 * 66_000; t += 500) {
      await h.until(t);
      const e = h.g().spotlight?.entryId;
      if (e && order[order.length - 1] !== e) order.push(e);
    }
    // RODE first (longest); then CAR (its R shows) over CAT (nothing shows);
    // then CAT and TAD tie on one letter each, so 1A before 2D.
    expect(order).toEqual([id(p, "RODE"), id(p, "CAR"), id(p, "CAT"), id(p, "TAD")]);
  });
});

// ---------------------------------------------------------------------------
// Hints and auto-reveal
// ---------------------------------------------------------------------------

describe("hints (§4.4)", () => {
  test("none for the first 40 % of the clue, then at even steps up to half the word", async () => {
    const p = mk("long", { specs: LONG });
    const h = host(world({ puzzles: [p] }));
    await h.start();
    await h.until(S);
    expect(h.g().spotlight!.entryId).toBe(id(p, "ELEPHANT"));
    await h.until(S + 24_000 - 500);
    expect(h.g().hints).toHaveLength(0);
    await h.until(S + 59_500);
    const hints = h.g().hints;
    expect(hints).toHaveLength(4); // half of 8
    const ele = new Set(entryCells(p.entries.find((e) => e.answer === "ELEPHANT")!).map((c) => cellKey(c.row, c.col)));
    for (const x of hints) expect(ele.has(cellKey(x.row, x.col))).toBe(true);
    const at = hints.map((x) => x.at);
    expect(at[0]).toBeGreaterThanOrEqual(S + 24_000);
    expect(at[at.length - 1]).toBeLessThan(S + 60_000);
    const gaps = at.slice(1).map((t, i) => t - at[i]);
    expect(Math.max(...gaps) - Math.min(...gaps)).toBeLessThanOrEqual(500);
    expect(Math.min(...gaps)).toBeGreaterThan(0);
  });

  test("letters filled by a crossing count toward the half", async () => {
    const p = mk("long", { specs: LONG });
    const h = host(world({ puzzles: [p] }));
    await h.start();
    await h.until(S + 2_000);
    // LAB fills the L of ELEPHANT before any hint.
    expect((await h.answer([{ name: "v", text: "lab" }])).solved).toEqual([id(p, "LAB")]);
    await h.until(S + 59_500);
    expect(h.g().hints).toHaveLength(3);
  });
});

describe("auto-reveal (§4.4)", () => {
  test("at clue end the host fills the word, no points, holds 6 s, then the next spotlight", async () => {
    const p = mk("p1");
    const h = host();
    await h.start();
    await h.until(S + 59_500);
    expect(h.g().solved[id(p, "RODE")]).toBeUndefined();
    await h.until(S + 60_000);
    expect(h.g().solved[id(p, "RODE")]).toMatchObject({ by: CROSSWORD_HOST_ID, points: 0 });
    expect(h.g().scores[CROSSWORD_HOST_ID]?.points ?? 0).toBe(0);
    expect(h.w.solves.filter((s) => s.points > 0)).toHaveLength(0);
    expect(h.pub().today).toEqual([]);
    // The revealed word is on the board.
    expect(h.pub().rows[2]).toBe("RODE");
    await h.until(S + 65_500);
    expect(h.g().spotlight!.entryId).toBe(id(p, "RODE"));
    await h.until(S + 66_000);
    expect(h.g().spotlight).toMatchObject({ entryId: id(p, "CAR"), startedAt: S + 66_000, endsAt: S + 126_000 });
  });

  test("the 20-minute ceiling: the host finishes an open puzzle", async () => {
    // 10-minute clues: four of them would take 40 minutes.
    const p = mk("p1");
    const h = host(world({ cfg: { clueS: 600 } }));
    await h.start();
    await h.until(T0 + 20 * 60_000 - 500);
    expect(h.g().phase).toBe("playing");
    await h.until(S + 20 * 60_000);
    expect(h.g().phase).toBe("finale");
    for (const e of p.entries) expect(h.g().solved[e.id]).toMatchObject({ points: 0 });
    expect(Object.values(h.g().solved).every((s) => s.by === CROSSWORD_HOST_ID)).toBe(true);
    expect(h.g().phaseEndsAt).toBe(h.now + 30_000);
  });
});

// ---------------------------------------------------------------------------
// Viewer solves
// ---------------------------------------------------------------------------

describe("viewer solves (§4.4, §4.5)", () => {
  test("solving the spotlight word: a 4 s beat, then the next spotlight", async () => {
    const p = mk("p1");
    const h = host();
    await h.start();
    await h.until(S + 5_000);
    const t = h.now;
    expect((await h.answer([{ name: "ann", text: "rode" }])).solved).toEqual([id(p, "RODE")]);
    expect(h.g().solved[id(p, "RODE")]).toMatchObject({ by: "youtube:ann" });
    await h.until(t + 3_500);
    expect(h.g().spotlight!.entryId).toBe(id(p, "RODE"));
    await h.until(t + 4_000);
    expect(h.g().spotlight).toMatchObject({ entryId: id(p, "CAR"), startedAt: t + 4_000, endsAt: t + 64_000 });
  });

  test("solving another word fills it at once and leaves the spotlight alone", async () => {
    const p = mk("p1");
    const h = host();
    await h.start();
    await h.until(S + 5_000);
    const before = h.g().spotlight;
    expect((await h.answer([{ name: "ann", text: "tad" }])).solved).toEqual([id(p, "TAD")]);
    expect(h.g().spotlight).toEqual(before);
    expect(h.pub().rows.map((r) => r[2]).join("")).toBe("TAD");
    await h.for(10_000);
    expect(h.g().spotlight).toEqual(before);
  });

  test("the earliest message time wins, whatever order the batch is in", async () => {
    const p = mk("p1");
    const h = host();
    await h.start();
    await h.until(S + 10_000);
    await h.answer([
      { name: "c", text: "rode", typedAt: h.now - 1_000 },
      { name: "a", text: "Rode!", typedAt: h.now - 4_000 },
      { name: "b", text: "3 across rode", typedAt: h.now - 2_000 },
    ]);
    expect(h.g().solved[id(p, "RODE")].by).toBe("youtube:a");
    expect(h.w.solves.map((s) => s.playerId)).toEqual(["youtube:a"]);
  });

  test("more than 5 guesses in 10 s from one player: the excess is ignored", async () => {
    const p = mk("p1");
    const h = host();
    await h.start();
    await h.until(S + 12_000);
    const wrong = ["dog", "cow", "pig", "hen"].map((text, i) => ({ name: "spam", text, typedAt: h.now - 9_000 + i * 1_000 }));
    // Fifth guess in the window still counts…
    expect((await h.answer([...wrong, { name: "spam", text: "tad", typedAt: h.now - 4_000 }])).solved).toEqual([id(p, "TAD")]);
    // …the sixth and seventh do not.
    expect((await h.answer([{ name: "spam", text: "rode", typedAt: h.now - 3_000 }])).solved).toEqual([]);
    expect((await h.answer([{ name: "spam", text: "car", typedAt: h.now - 2_000 }])).solved).toEqual([]);
    // Another player is not held back.
    expect((await h.answer([{ name: "other", text: "car" }])).solved).toEqual([id(p, "CAR")]);
    // Once the window has passed, the spammer is heard again.
    await h.for(10_000);
    expect((await h.answer([{ name: "spam", text: "rode" }])).solved).toEqual([id(p, "RODE")]);
  });

  test("hidden players are ignored", async () => {
    const p = mk("p1");
    const h = host();
    h.w.players.set("youtube:ghost", { id: "youtube:ghost", name: "ghost", hidden: true, firstSeen: 0, lastSeen: 0 });
    await h.start();
    await h.until(S + 5_000);
    expect((await h.answer([{ name: "ghost", text: "rode", typedAt: h.now - 3_000 }, { name: "live", text: "rode" }])).solved).toEqual([
      id(p, "RODE"),
    ]);
    expect(h.g().solved[id(p, "RODE")].by).toBe("youtube:live");
    expect(h.w.solves.some((s) => s.playerId === "youtube:ghost")).toBe(false);
  });

  test.each([
    ["emoji stripped", "🎉Rich🔥", "Rich"],
    ["16 characters at most", "AbcdefghijKlmnopQRST", "AbcdefghijKlmnop"],
    ["built-in blocklist", "shithead", /^Player \d{4}$/],
    ["operator blocklist", "Gromit99", /^Player \d{4}$/],
    ["nothing left", "🎉🎉", /^Player \d{4}$/],
  ])("names cleaned before air: %s", async (_, raw, want) => {
    const p = mk("p1");
    const h = host(world({ cfg: { blocklist: ["gromit"] } }));
    await h.start();
    await h.until(S + 5_000);
    await h.answer([{ playerId: "youtube:UCx", name: raw, text: "rode" }]);
    const name = h.g().solved[id(p, "RODE")].name;
    if (typeof want === "string") expect(name).toBe(want);
    else expect(name).toMatch(want);
    expect(h.pub().scores[0].name).toBe(name);
    expect(h.w.solves[0].name).toBe(name);
    expect(JSON.stringify(h.pub())).not.toContain(String(raw));
  });
});

// ---------------------------------------------------------------------------
// §4.6 scoring, stream delay, late credit
// ---------------------------------------------------------------------------

describe("scoring (§4.6)", () => {
  // RODE's hints fall at S+24 s and S+42 s (none for 40 %, two at even steps).
  test("points = letters not showing when typed; a hint inside the stream delay does not cost", async () => {
    const p = mk("p1");
    const h = host();
    await h.start();
    await h.until(S + 30_000);
    expect(h.g().hints.length).toBe(1);
    // Typed now, but the viewer's board is 10 s behind: the hint was not visible yet.
    await h.answer([{ name: "a", text: "rode" }]);
    expect(h.g().solved[id(p, "RODE")].points).toBe(4);
  });

  test("a hint older than the stream delay costs a letter", async () => {
    const p = mk("p1");
    const h = host();
    await h.start();
    await h.until(S + 40_000);
    await h.answer([{ name: "a", text: "rode" }]);
    expect(h.g().solved[id(p, "RODE")].points).toBe(3);
  });

  test("with streamDelayS 0 a hint costs at once", async () => {
    const p = mk("p1");
    const h = host(world({ cfg: { streamDelayS: 0 } }));
    await h.start();
    await h.until(S + 30_000);
    await h.answer([{ name: "a", text: "rode" }]);
    expect(h.g().solved[id(p, "RODE")].points).toBe(3);
  });

  test("letters filled by crossings count as showing", async () => {
    const p = mk("p1");
    const h = host();
    await h.start();
    await h.until(S + 2_000);
    await h.answer([{ name: "a", text: "cat" }]);
    expect(h.g().solved[id(p, "CAT")].points).toBe(3);
    await h.until(S + 20_000);
    // C shows from CAT (well over 10 s before the stream-delayed check).
    await h.answer([{ name: "b", text: "car" }]);
    expect(h.g().solved[id(p, "CAR")].points).toBe(2);
    expect(h.pub().scores).toEqual([
      { name: "a", points: 3, words: 1 },
      { name: "b", points: 2, words: 1 },
    ]);
  });

  test("late credit: an answer typed before the reveal (plus the delay) takes the word, flagged late", async () => {
    const p = mk("p1");
    const rode = id(p, "RODE");
    const h = host();
    await h.start();
    const R = S + 60_000;
    await h.until(R + 11_000); // the hold is over and the next clue is up
    const spot = h.g().spotlight;
    expect(h.g().solved[rode].by).toBe(CROSSWORD_HOST_ID);

    // Typed after reveal + delay: too late.
    expect((await h.answer([{ name: "slow", text: "rode", typedAt: R + 10_500 }])).solved).toEqual([]);
    expect(h.g().solved[rode].by).toBe(CROSSWORD_HOST_ID);

    // Typed 2 s before the reveal, processed now.
    expect((await h.answer([{ name: "kim", text: "rode", typedAt: R - 2_000 }])).solved).toEqual([rode]);
    expect(h.g().solved[rode]).toMatchObject({ by: "youtube:kim", late: true });
    // Both hints were out more than 10 s before it was typed.
    expect(h.g().solved[rode].points).toBe(2);
    const pubEntry = h.pub().entries.find((e) => e.id === rode)!;
    expect(pubEntry.solved).toMatchObject({ name: "kim", late: true });
    expect(h.pub().feed[h.pub().feed.length - 1].text).toContain("kim");
    expect(h.w.solves[h.w.solves.length - 1]).toMatchObject({ playerId: "youtube:kim", entryId: rode, late: true });
    // The spotlight is not disturbed.
    expect(h.g().spotlight).toEqual(spot);

    // A second late answer, typed even earlier, comes too late: the first processed keeps it.
    expect((await h.answer([{ name: "lee", text: "rode", typedAt: R - 30_000 }])).solved).toEqual([]);
    expect(h.g().solved[rode].by).toBe("youtube:kim");
  });
});

// ---------------------------------------------------------------------------
// §4.4 next puzzle, §7.4 family-friendly
// ---------------------------------------------------------------------------

describe("next puzzle (§4.4)", () => {
  test("the oldest ready puzzle this scene has not played; plays elsewhere and rejected puzzles do not count", async () => {
    const h = host(
      world({
        puzzles: [
          mk("rejected", { createdAt: 0, status: "rejected" }),
          mk("mine", { createdAt: 1, plays: [{ sceneId: SCENE, startedAt: 1, endedAt: 2 }] }),
          mk("elsewhere", { createdAt: 2, plays: [{ sceneId: "other", startedAt: 1, endedAt: 2 }] }),
          mk("newer", { createdAt: 3 }),
        ],
      }),
    );
    await h.start();
    expect(h.g()).toMatchObject({ phase: "intro", puzzleId: "elsewhere" });
  });

  test("failing that, the puzzle played longest ago outside the last 30; failing that, idle", async () => {
    const played = (n: number) =>
      Array.from({ length: n }, (_, i) =>
        mk(`q${i}`, { createdAt: i, plays: [{ sceneId: SCENE, startedAt: 1_000 + i * 10, endedAt: 1_005 + i * 10 }] }),
      );
    // 31 played: q0 is the oldest play and outside the last 30.
    const h = host(world({ puzzles: played(31) }));
    await h.start();
    expect(h.g()).toMatchObject({ phase: "intro", puzzleId: "q0" });

    // 30 played: every one is inside the window.
    const h2 = host(world({ puzzles: played(30) }));
    await h2.start();
    expect(h2.g().phase).toBe("idle");
    expect(h2.w.db.crosswordPuzzles.startPlay).not.toHaveBeenCalled();
  });

  test("a puzzle played long ago but again recently counts by its last play", async () => {
    const puzzles = Array.from({ length: 31 }, (_, i) =>
      mk(`q${i}`, { createdAt: i, plays: [{ sceneId: SCENE, startedAt: 1_000 + i * 10, endedAt: 1_005 + i * 10 }] }),
    );
    puzzles[0].plays.push({ sceneId: SCENE, startedAt: 5_000, endedAt: 5_005 });
    const h = host(world({ puzzles }));
    await h.start();
    expect(h.g().puzzleId).toBe("q1");
  });

  test("an idle scene starts when stock arrives", async () => {
    const w = world({ puzzles: [] });
    const h = host(w);
    await h.start();
    expect(h.g().phase).toBe("idle");
    w.puzzles.set("fresh", mk("fresh"));
    await h.for(10_000);
    expect(h.g()).toMatchObject({ phase: "intro", puzzleId: "fresh" });
  });
});

describe("family-friendly channel (§7.4, §7.5)", () => {
  test("never plays an untagged puzzle, even unplayed against a replay", async () => {
    const old = mk("tagged", { createdAt: 1, plays: [{ sceneId: SCENE, startedAt: 1, endedAt: 2 }] });
    const w = world({ puzzles: [mk("untagged", { createdAt: 0, familyFriendly: false }), old], cfg: { noRepeatPuzzles: 0 } });
    // The default config is family friendly only.
    expect(DEFAULT_CROSSWORD_CONFIG.familyFriendlyOnly).toBe(true);
    const h = host(w);
    await h.start();
    expect(h.g().puzzleId).toBe("tagged");
  });

  test("with only untagged stock it idles", async () => {
    const h = host(world({ puzzles: [mk("untagged", { familyFriendly: false })] }));
    await h.start();
    await h.for(20_000);
    expect(h.g().phase).toBe("idle");
    expect(h.w.db.crosswordPuzzles.startPlay).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// On air: live runs, go-live, park
// ---------------------------------------------------------------------------

describe("plays with a live run (§4.4)", () => {
  test("no run and playOffAir off: idle, no stock spent", async () => {
    const h = host(world({ cfg: { playOffAir: false } }));
    await h.start();
    await h.for(60_000);
    expect(h.g().phase).toBe("idle");
    expect(h.w.db.crosswordPuzzles.startPlay).not.toHaveBeenCalled();
  });

  test("a go-live starts a fresh puzzle on its intro card; the run ending parks it; the next go-live starts fresh", async () => {
    const w = world({ puzzles: [mk("a", { createdAt: 1 }), mk("b", { createdAt: 2 })], cfg: { playOffAir: false } });
    const h = host(w);
    await h.start();
    await h.for(5_000);
    w.setRun({ id: "r1", status: "live", startAt: h.now, chat: { enabled: true } });
    await h.for(1_000);
    expect(h.g()).toMatchObject({ phase: "intro", puzzleId: "a", puzzleNo: 1 });
    const goLive = h.now;
    expect(h.g().phaseEndsAt).toBeGreaterThanOrEqual(goLive - 1_000 + 12_000);
    await h.until(goLive + 12_000 + 30_000);
    expect(h.g().phase).toBe("playing");

    w.setRun(null);
    await h.for(1_000);
    const parked = JSON.parse(JSON.stringify(h.g())) as CrosswordGame;
    await h.for(10 * 60_000);
    // Parked: same puzzle, same board, nothing revealed, no answers taken.
    expect(h.g()).toMatchObject({ phase: "playing", puzzleId: "a", hints: parked.hints, solved: parked.solved, spotlight: parked.spotlight });
    expect((await h.answer([{ name: "x", text: "rode" }])).solved).toEqual([]);
    expect(w.db.crosswordPuzzles.startPlay).toHaveBeenCalledTimes(1);

    w.setRun({ id: "r2", status: "live", startAt: h.now });
    await h.for(1_000);
    expect(h.g()).toMatchObject({ phase: "intro", puzzleId: "b", puzzleNo: 2, solved: {} });
    expect(w.puzzles.get("a")!.plays[0].endedAt).toBeDefined();
  });

  test("a run that is not live (e.g. starting) does not play", async () => {
    const w = world({ cfg: { playOffAir: false } });
    w.setRun({ id: "r1", status: "starting", startAt: T0 });
    const h = host(w);
    await h.start();
    await h.for(20_000);
    expect(h.g().phase).toBe("idle");
  });
});

// ---------------------------------------------------------------------------
// Resume
// ---------------------------------------------------------------------------

describe("resume after a restart (§4.4)", () => {
  test("off air: a fresh runner on the same store resumes mid-puzzle with its deadlines", async () => {
    const p = mk("p1");
    const w = world();
    const h = host(w);
    await h.start();
    await h.until(S + 66_000 + 30_000);
    await h.answer([{ name: "ann", text: "tad" }]);
    const before = JSON.parse(JSON.stringify(h.g())) as CrosswordGame;
    expect(before.hints.length).toBeGreaterThan(0);

    const h2 = host(w, newCrosswordRunnerState(), h.now + 1_500);
    await h2.start();
    expect(h2.g()).toMatchObject({
      phase: "playing",
      puzzleId: "p1",
      puzzleNo: 1,
      spotlight: before.spotlight,
      hints: before.hints,
      solved: before.solved,
      scores: before.scores,
    });
    expect(w.db.crosswordPuzzles.startPlay).toHaveBeenCalledTimes(1);
    // The clue that was up is revealed on its original deadline.
    await h2.until(before.spotlight!.endsAt);
    expect(h2.g().solved[before.spotlight!.entryId]?.by).toBe(CROSSWORD_HOST_ID);
    expect(h2.g().solved[id(p, "TAD")].by).toBe("youtube:ann");
  });

  test("on air: the same live run resumes the puzzle rather than starting a fresh one", async () => {
    const w = world({ puzzles: [mk("a", { createdAt: 1 }), mk("b", { createdAt: 2 })], cfg: { playOffAir: false } });
    w.setRun({ id: "r1", status: "live", startAt: T0 - 60_000 });
    const h = host(w);
    await h.start();
    await h.until(S + 20_000);
    const before = JSON.parse(JSON.stringify(h.g())) as CrosswordGame;
    expect(before).toMatchObject({ phase: "playing", puzzleId: "a" });

    const h2 = host(w, newCrosswordRunnerState(), h.now + 2_000);
    await h2.start();
    await h2.for(1_000);
    expect(h2.g()).toMatchObject({ phase: "playing", puzzleId: "a", puzzleNo: before.puzzleNo, spotlight: before.spotlight });
    expect(w.db.crosswordPuzzles.startPlay).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// The wire
// ---------------------------------------------------------------------------

describe("the wire (§4.3)", () => {
  test("every emitted payload is free of any unsolved answer", async () => {
    const p = mk("p1");
    const w = world({ puzzles: [p, mk("p2", { createdAt: 2 })] });
    const h = host(w);
    await h.start();
    await h.until(S + 30_000);
    await h.answer([{ name: "a", text: "cat" }]);
    await h.until(S + 61_000);
    await h.answer([{ name: "b", text: "rode", typedAt: S + 59_000 }]); // late credit
    await h.until(S + 4 * 66_000 + 30_000 + 15_000);

    const types = new Set(w.emitted.map((e) => e.type));
    expect([...types].sort()).toEqual([CROSSWORD_BEAT, CROSSWORD_STATE].sort());
    for (const e of w.emitted.filter((x) => x.type === CROSSWORD_BEAT)) {
      expect(Object.keys(e.data).sort()).toEqual(["sceneId", "seq", "serverNow"]);
    }

    const out = pubStates(w.emitted);
    expect(out.length).toBeGreaterThan(10);
    for (const pub of out) {
      const json = JSON.stringify(pub);
      expect(json).not.toMatch(/"answer"/);
      expect(json).not.toMatch(/"wordId"|"clueId"/);
      if (!pub.rows.length) continue;
      const puz = [p, w.puzzles.get("p2")!].find((x) => x.title === pub.title)!;
      // What the board may show: hinted cells and solved entries, from the public state itself.
      const solvedIds = new Set(pub.entries.filter((e) => e.solved).map((e) => e.id));
      const solvedCells = new Set(
        puz.entries.filter((e) => solvedIds.has(e.id)).flatMap((e) => entryCells(e).map((c) => cellKey(c.row, c.col))),
      );
      for (const e of puz.entries) {
        const pe = pub.entries.find((x) => x.id === e.id)!;
        expect(pe.length).toBe(e.answer.length);
        if (pe.solved) continue;
        const cells = entryCells(e);
        const showing = cells.map((c) => pub.rows[c.row][c.col]);
        // Never the whole unsolved word.
        expect(showing.every((ch) => /[A-Z]/.test(ch))).toBe(false);
        // At most half of it from hints (letters solved by crossings aside).
        const hinted = cells.filter((c, i) => /[A-Z]/.test(showing[i]) && !solvedCells.has(cellKey(c.row, c.col))).length;
        expect(hinted).toBeLessThanOrEqual(Math.floor(e.answer.length / 2));
        // A letter that shows is the right one (no scrambled leak is possible either way).
        cells.forEach((c, i) => {
          if (/[A-Z]/.test(showing[i])) expect(showing[i]).toBe(e.answer[i]);
        });
      }
    }
  });
});

// ---------------------------------------------------------------------------
// The simulator inject (§8.3, §12)
// ---------------------------------------------------------------------------

describe("crossword.inject from the simulator", () => {
  test("takes the word through the same answer path, marked sim, and writes no chat log", async () => {
    const p = mk("p1");
    const h = host();
    await h.start();
    await h.until(S + 5_000);
    h.w.touched.clear();
    const res = await handleInject({ sceneId: SCENE, kind: "sim", name: "Desk Dan", text: "3a rode", at: h.now - 500 }, h.state, h.w.deps, h.now);
    expect(res).toMatchObject({ solved: [id(p, "RODE")] });
    expect(h.g().solved[id(p, "RODE")]).toMatchObject({ name: "Desk Dan", points: 4 });
    expect(h.w.solves[0]).toMatchObject({ sim: true, name: "Desk Dan" });
    for (const fn of Object.values(h.w.db.chatLog)) expect(fn).not.toHaveBeenCalled();
    expect([...h.w.touched].filter((k) => /chat/i.test(k))).toEqual([]);
  });

  test("a simulated wrong guess gets no on-air response", async () => {
    const h = host();
    await h.start();
    await h.until(S + 5_000);
    const n = h.w.emitted.length;
    const seq = h.g().seq;
    await handleInject({ sceneId: SCENE, kind: "sim", name: "Dan", text: "zebra" }, h.state, h.w.deps, h.now);
    expect(h.g().seq).toBe(seq);
    expect(h.w.emitted.slice(n).filter((e) => e.type === CROSSWORD_STATE)).toHaveLength(0);
  });
});
