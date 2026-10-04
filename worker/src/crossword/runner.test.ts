jest.mock("../socket", () => ({ emitWorkerEvent: jest.fn() }));
jest.mock("@photonsurge/shared/utill/logger", () => ({ log: jest.fn() }));

import {
  cellKey,
  entryCells,
  mergeCrosswordConfig,
  numberEntries,
  shownCells,
  CROSSWORD_BEAT,
  CROSSWORD_HOST_ID,
  CROSSWORD_STATE,
  DEFAULT_CROSSWORD_CONFIG,
  type CrosswordConfig,
  type CrosswordGame,
  type CrosswordPublicState,
  type CrosswordPuzzle,
} from "@photonsurge/shared/crossword";
import type { CrosswordSolve, CrosswordPlayer } from "@photonsurge/shared/crossword-records";
import {
  commandTo,
  newCrosswordRunnerState,
  step,
  submitAnswersTo,
  type CrosswordChatAnswer,
  type CrosswordRunnerDeps,
  type CrosswordRunnerState,
} from "./runner";
import { handleInject } from "./inject";

const SCENE = "xw";
const T0 = Date.UTC(2026, 9, 4, 12, 0, 0);

/**
 *  C A T .      1A CAT, 3A RODE
 *  A . A .      1D CAR, 2D TAD
 *  R O D E
 */
function puzzle(id = "p1", createdAt = 1): CrosswordPuzzle {
  return {
    id,
    title: `Puzzle ${id}`,
    theme: "test",
    width: 4,
    height: 3,
    entries: numberEntries([
      { answer: "CAT", clue: "Feline pet", row: 0, col: 0, dir: "across" },
      { answer: "CAR", clue: "Road vehicle", row: 0, col: 0, dir: "down" },
      { answer: "TAD", clue: "A little bit", row: 0, col: 2, dir: "down" },
      { answer: "RODE", clue: "Sat on a horse", row: 2, col: 0, dir: "across" },
    ]),
    status: "ready",
    source: "seed",
    createdAt,
    plays: [],
  };
}

/** A stateful fake of the db slice the runner uses. */
function fakeDb(opts: { puzzles?: CrosswordPuzzle[]; cfg?: Partial<CrosswordConfig> } = {}) {
  const puzzles = new Map((opts.puzzles ?? [puzzle()]).map((p) => [p.id, p]));
  let cfg = mergeCrosswordConfig(DEFAULT_CROSSWORD_CONFIG, { enabled: true, playOffAir: true, ...opts.cfg });
  let run: { id: string; status: string; startAt?: number; chat?: { enabled: boolean } } | null = null;
  let game: CrosswordGame | null = null;
  const saved: CrosswordGame[] = [];
  const solves: CrosswordSolve[] = [];
  const players = new Map<string, CrosswordPlayer>();
  const copy = <T>(x: T): T => JSON.parse(JSON.stringify(x));
  const db = {
    crosswordScenes: jest.fn(async () => [SCENE]),
    getOrInitCrosswordConfig: jest.fn(async () => cfg),
    activeRunForScene: jest.fn(async () => run),
    crosswordGames: {
      get: jest.fn(async () => (game ? copy(game) : null)),
      save: jest.fn(async (g: CrosswordGame) => {
        game = copy(g);
        saved.push(copy(g));
      }),
    },
    crosswordPuzzles: {
      list: jest.fn(async ({ status }: { status?: string } = {}) =>
        copy([...puzzles.values()].filter((p) => !status || p.status === status)),
      ),
      get: jest.fn(async (id: string) => (puzzles.has(id) ? copy(puzzles.get(id)!) : null)),
      startPlay: jest.fn(async (id: string, sceneId: string, startedAt: number) => {
        puzzles.get(id)?.plays.push({ sceneId, startedAt });
        return true;
      }),
      endPlay: jest.fn(async (id: string, sceneId: string, startedAt: number, endedAt: number) => {
        const p = puzzles.get(id)?.plays.find((x) => x.sceneId === sceneId && x.startedAt === startedAt);
        if (p) p.endedAt = endedAt;
        return !!p;
      }),
    },
    crosswordSolves: {
      append: jest.fn(async (s: CrosswordSolve) => void solves.push(copy(s))),
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
      touch: jest.fn(async (id: string, name: string, at: number) => {
        const p = players.get(id) ?? { id, name, hidden: false, firstSeen: at, lastSeen: at };
        p.name = name;
        p.lastSeen = at;
        players.set(id, p);
        return { ...p };
      }),
      hiddenIds: jest.fn(async () => [...players.values()].filter((p) => p.hidden).map((p) => p.id)),
    },
    chatLog: { append: jest.fn(), add: jest.fn(), insert: jest.fn() },
  };
  const emitted: { type: string; data: any }[] = [];
  const deps: CrosswordRunnerDeps = {
    db: db as unknown as CrosswordRunnerDeps["db"],
    emit: (type, data) => emitted.push({ type, data: copy(data) }),
  };
  return {
    db,
    deps,
    emitted,
    saved,
    solves,
    puzzles,
    players,
    get game() {
      return game;
    },
    setCfg: (patch: Partial<CrosswordConfig>) => (cfg = mergeCrosswordConfig(cfg, patch)),
    setRun: (r: typeof run) => (run = r),
  };
}

/** A runner on a fake clock. */
function harness(f = fakeDb(), state: CrosswordRunnerState = newCrosswordRunnerState(), start = T0) {
  let now = start;
  const h = {
    f,
    state,
    get now() {
      return now;
    },
    game: () => state.scenes.get(SCENE)!.game,
    /** Step the runner every 500 ms through `ms`. */
    async run(ms: number) {
      const end = now + ms;
      while (now < end) {
        now = Math.min(end, now + 500);
        await step(state, now, f.deps);
      }
    },
    async first() {
      await step(state, now, f.deps);
    },
    answer: (msgs: Partial<CrosswordChatAnswer>[]) =>
      submitAnswersTo(
        state,
        SCENE,
        msgs.map((m) => ({ playerId: `youtube:${m.name}`, name: "", text: "", typedAt: now, ...m })),
        now,
        f.deps,
      ),
    command: (c: Parameters<typeof commandTo>[2]) => commandTo(state, SCENE, c, now, f.deps),
  };
  return h;
}

const states = (emitted: { type: string; data: any }[]) =>
  emitted.filter((e) => e.type === CROSSWORD_STATE).map((e) => e.data as CrosswordPublicState);

describe("crossword runner", () => {
  test("phase transitions on a fake clock: intro → playing → reveals → finale → idle", async () => {
    const h = harness();
    await h.first();
    expect(h.game()).toMatchObject({ phase: "intro", puzzleId: "p1", puzzleNo: 1 });
    expect(h.game().phaseEndsAt).toBe(T0 + 12_000);
    expect(h.f.db.crosswordPuzzles.startPlay).toHaveBeenCalledWith("p1", SCENE, T0);

    await h.run(12_000);
    expect(h.game().phase).toBe("playing");
    // The first spotlight is the longest word.
    expect(h.game().spotlight).toEqual({ entryId: "3A", startedAt: T0 + 12_000, endsAt: T0 + 72_000 });

    // 4 words × (60 s clue + 6 s hold), then the 30 s finale.
    await h.run(4 * 66_000);
    expect(h.game().phase).toBe("finale");
    expect(Object.values(h.game().solved).every((s) => s.by === CROSSWORD_HOST_ID)).toBe(true);

    await h.run(30_000);
    // The only puzzle was just played (inside the no-repeat window): idle.
    expect(h.game().phase).toBe("idle");
    expect(h.f.puzzles.get("p1")!.plays[0].endedAt).toBe(T0 + 12_000 + 4 * 66_000 + 30_000);
    expect(h.f.db.crosswordGames.save).toHaveBeenCalled();
    // seq bumps on every change and goes out with each state.
    const seqs = states(h.f.emitted).map((s) => s.seq);
    expect(seqs).toEqual(seqs.map((_, i) => seqs[0] + i));
  });

  test("auto-reveal: hints leak up to half the word, then the host fills it and holds", async () => {
    const h = harness();
    await h.first();
    await h.run(12_000 + 59_500);
    const g = h.game();
    expect(g.solved["3A"]).toBeUndefined();
    // RODE: cap floor(4 × 0.5) = 2 hints, none in the first 40 %.
    expect(g.hints).toHaveLength(2);
    expect(g.hints[0].at).toBeGreaterThanOrEqual(T0 + 12_000 + 24_000);
    await h.run(500);
    expect(h.game().solved["3A"]).toMatchObject({ by: CROSSWORD_HOST_ID, points: 0 });
    expect(h.game().spotlight).toMatchObject({ entryId: "3A", endsAt: h.now + 6_000 });
    await h.run(6_000);
    expect(h.game().spotlight?.entryId).not.toBe("3A");
  });

  test("first answer wins, by the time it was typed; a spotlight solve gets a beat", async () => {
    const h = harness();
    await h.first();
    await h.run(12_000 + 5_000);
    const res = await h.answer([
      { name: "late", text: "rode", typedAt: h.now - 1_000 },
      { name: "early", text: "3a RODE", typedAt: h.now - 3_000 },
    ]);
    expect(res.solved).toEqual(["3A"]);
    expect(h.game().solved["3A"]).toMatchObject({ by: "youtube:early", points: 4 });
    expect(h.f.solves).toHaveLength(1);
    expect(h.f.solves[0]).toMatchObject({ playerId: "youtube:early", entryId: "3A", points: 4 });
    expect(h.f.solves[0].sim).toBeUndefined();
    expect(h.game().spotlight).toMatchObject({ entryId: "3A", endsAt: h.now + 4_000 });
    // Today's board is rebuilt from the solve log.
    expect(h.game().pub.today).toEqual([{ name: "early", points: 4 }]);

    // A second answer for the taken word does nothing.
    expect((await h.answer([{ name: "late", text: "rode" }])).solved).toEqual([]);

    await h.run(4_000);
    const next = h.game().spotlight!.entryId;
    expect(next).not.toBe("3A");

    // Solving another word fills it and leaves the spotlight alone.
    const other = ["1A", "1D", "2D"].find((id) => id !== next)!;
    const word = { "1A": "CAT", "1D": "CAR", "2D": "TAD" }[other as "1A"];
    const before = h.game().spotlight;
    await h.answer([{ name: "early", text: word }]);
    expect(h.game().solved[other]).toBeDefined();
    expect(h.game().spotlight).toEqual(before);
  });

  test("rate limit, hidden players and names cleaned for air", async () => {
    const h = harness(fakeDb({ cfg: { rateMax: 2, rateWindowS: 10 } }));
    await h.first();
    await h.run(13_000);
    const spam = ["nope", "nada", "rode"].map((text, i) => ({ name: "spam", text, typedAt: h.now - 3_000 + i }));
    expect((await h.answer(spam)).solved).toEqual([]);

    h.f.players.set("youtube:ghost", { id: "youtube:ghost", name: "ghost", hidden: true, firstSeen: 0, lastSeen: 0 });
    expect((await h.answer([{ name: "ghost", text: "rode" }])).solved).toEqual([]);

    await h.answer([{ playerId: "youtube:ok", name: "🎉Rich🎉", text: "rode" }]);
    expect(h.game().solved["3A"].name).toBe("Rich");
  });

  test("the ceiling: the host finishes the puzzle", async () => {
    const h = harness(fakeDb({ cfg: { ceilingMin: 2 } }));
    await h.first();
    await h.run(12_000);
    expect(h.game().phaseEndsAt).toBe(T0 + 12_000 + 120_000);
    await h.run(120_000);
    expect(h.game().phase).toBe("finale");
    expect(Object.keys(h.game().solved).sort()).toEqual(["1A", "1D", "2D", "3A"]);
  });

  test("resume from a stored game: a new runner picks up mid-puzzle", async () => {
    const f = fakeDb();
    const h = harness(f);
    await h.first();
    await h.run(12_000 + 66_000 + 10_000);
    const before = h.game();
    expect(before.phase).toBe("playing");

    // Worker restart: fresh in-memory state, same Mongo.
    const h2 = harness(f, newCrosswordRunnerState(), h.now + 500);
    await h2.first();
    const g = h2.game();
    expect(g.puzzleId).toBe(before.puzzleId);
    expect(g.puzzleNo).toBe(1);
    expect(g.spotlight).toEqual(before.spotlight);
    expect(g.solved).toEqual(before.solved);
    expect(g.seq).toBeGreaterThanOrEqual(before.seq);
    expect(f.db.crosswordPuzzles.startPlay).toHaveBeenCalledTimes(1);
    // …and keeps going.
    await h2.run(60_000);
    expect(Object.keys(h2.game().solved).length).toBeGreaterThan(Object.keys(before.solved).length);
  });

  test("next puzzle: oldest unplayed first, then the one played longest ago outside the no-repeat window", async () => {
    const f = fakeDb({ puzzles: [puzzle("p2", 2), puzzle("p1", 1)], cfg: { noRepeatPuzzles: 1, introS: 3, finaleS: 5 } });
    const h = harness(f);
    await h.first();
    expect(h.game().puzzleId).toBe("p1");
    await h.command("nextPuzzle");
    expect(h.game().phase).toBe("finale");
    await h.run(5_000);
    expect(h.game()).toMatchObject({ puzzleId: "p2", puzzleNo: 2, phase: "intro" });
    await h.command("nextPuzzle");
    await h.run(5_000);
    // p2 is the last play (inside the window of 1); p1 was played longest ago.
    expect(h.game()).toMatchObject({ puzzleId: "p1", puzzleNo: 3 });

    f.setCfg({ noRepeatPuzzles: 2 });
    await h.command("nextPuzzle");
    await h.run(5_000);
    expect(h.game().phase).toBe("idle");
    expect(h.game().puzzleNo).toBe(3);
  });

  test("pause freezes the clock; resume moves the deadlines on", async () => {
    const h = harness();
    await h.first();
    await h.run(12_000 + 30_000);
    const spot = h.game().spotlight!;
    const hints = h.game().hints.length;
    await h.command("pause");
    expect(h.game().pub.paused).toBe(true);
    await h.run(100_000);
    expect(h.game().spotlight).toEqual(spot);
    expect(h.game().hints).toHaveLength(hints);
    // Answers are not taken while paused.
    expect((await h.answer([{ name: "a", text: "rode" }])).solved).toEqual([]);
    await h.command("resume");
    expect(h.game().spotlight).toEqual({ ...spot, startedAt: spot.startedAt + 100_000, endsAt: spot.endsAt + 100_000 });
    await h.run(29_500);
    expect(h.game().solved[spot.entryId]).toBeUndefined();
    await h.run(500);
    expect(h.game().solved[spot.entryId]?.by).toBe(CROSSWORD_HOST_ID);
  });

  test("Desk commands: skipClue leaves the word open, reveal fills the spotlight word", async () => {
    const h = harness();
    await h.first();
    await h.run(13_000);
    expect(h.game().spotlight!.entryId).toBe("3A");
    await h.command("skipClue");
    const skippedTo = h.game().spotlight!.entryId;
    expect(skippedTo).not.toBe("3A");
    expect(h.game().solved["3A"]).toBeUndefined();
    await h.command("reveal");
    expect(h.game().solved[skippedTo]?.by).toBe(CROSSWORD_HOST_ID);
    expect(h.game().spotlight).toMatchObject({ entryId: skippedTo, endsAt: h.now + 6_000 });
  });

  test("plays only on air: a go-live starts a fresh puzzle, the run ending parks the game", async () => {
    const f = fakeDb({ puzzles: [puzzle("p1", 1), puzzle("p2", 2)], cfg: { playOffAir: false } });
    const h = harness(f);
    await h.first();
    await h.run(30_000);
    expect(h.game().phase).toBe("idle");
    expect(f.db.crosswordPuzzles.startPlay).not.toHaveBeenCalled();

    f.setRun({ id: "r1", status: "live", startAt: h.now, chat: { enabled: true } });
    await h.run(1_000);
    expect(h.game()).toMatchObject({ phase: "intro", puzzleId: "p1", puzzleNo: 1 });
    expect(h.game().pub.inputLive).toBe(true);
    await h.run(20_000);
    const parked = h.game();

    f.setRun(null);
    await h.run(1_000);
    const atPark = h.game();
    await h.run(300_000);
    expect(h.game().spotlight).toEqual(atPark.spotlight);
    expect(h.game().pub.inputLive).toBe(false);
    expect(parked.puzzleId).toBe("p1");

    // A new go-live: the parked puzzle's play closes and a fresh one starts.
    f.setRun({ id: "r2", status: "live", startAt: h.now });
    await h.run(1_000);
    expect(h.game()).toMatchObject({ phase: "intro", puzzleId: "p2", puzzleNo: 2 });
    expect(f.puzzles.get("p1")!.plays[0].endedAt).toBeDefined();
  });

  test("beats every 5 s", async () => {
    const h = harness();
    await h.first();
    await h.run(10_000);
    const beats = h.f.emitted.filter((e) => e.type === CROSSWORD_BEAT);
    expect(beats.length).toBe(3);
    expect(beats[0].data).toEqual({ sceneId: SCENE, seq: expect.any(Number), serverNow: T0 });
  });

  test("emitted payloads never carry an unsolved answer", async () => {
    const f = fakeDb();
    const h = harness(f);
    const p = puzzle();
    await h.first();
    await h.run(12_000 + 30_000);
    await h.answer([{ name: "a", text: "cat" }]);
    await h.run(4 * 66_000 + 30_000);
    const bySeq = new Map(f.saved.map((g) => [g.seq, g]));
    const out = states(f.emitted);
    expect(out.length).toBeGreaterThan(5);
    for (const pub of out) {
      if (!pub.rows.length) continue; // idle: no board
      const json = JSON.stringify(pub);
      expect(json).not.toMatch(/"answer"/);
      const g = bySeq.get(pub.seq)!;
      const shown = shownCells(p, g);
      for (const e of p.entries) {
        if (g.solved[e.id]) continue;
        for (const c of entryCells(e)) {
          const ch = pub.rows[c.row][c.col];
          expect(shown.has(cellKey(c.row, c.col)) ? ch : ".").toBe(ch);
        }
        // Never the whole word unless every letter is showing.
        if (entryCells(e).some((c) => !shown.has(cellKey(c.row, c.col)))) {
          expect(pub.rows.join("|")).not.toContain(e.answer.length >= 4 ? e.answer : "\u0000");
        }
      }
    }
  });
});

describe("crossword.inject", () => {
  test("a simulated answer takes the word, marked sim, and writes no chat log", async () => {
    const h = harness();
    await h.first();
    await h.run(13_000);
    const res = await handleInject({ sceneId: SCENE, kind: "sim", name: "Rich", text: "rode", at: h.now - 1_000 }, h.state, h.f.deps, h.now);
    expect(res).toEqual({ kind: "sim", solved: ["3A"] });
    expect(h.f.solves[0]).toMatchObject({ playerId: "sim:rich", name: "Rich", sim: true });
    expect(h.f.db.crosswordPlayers.touch).toHaveBeenCalledWith("sim:rich", "Rich", h.now);
    for (const fn of Object.values(h.f.db.chatLog)) expect(fn).not.toHaveBeenCalled();
  });

  test("commands reach the runner; a scene with no runner or a bad payload fails", async () => {
    const h = harness();
    await h.first();
    await h.run(13_000);
    await handleInject({ sceneId: SCENE, kind: "command", command: "reveal" }, h.state, h.f.deps, h.now);
    expect(h.game().solved["3A"]?.by).toBe(CROSSWORD_HOST_ID);
    await expect(
      handleInject({ sceneId: "nope", kind: "command", command: "pause" }, h.state, h.f.deps, h.now),
    ).rejects.toThrow(/not running/);
    await expect(
      handleInject({ sceneId: SCENE, kind: "command", command: "explode" as any }, h.state, h.f.deps, h.now),
    ).rejects.toThrow(/unknown command/);
  });
});
