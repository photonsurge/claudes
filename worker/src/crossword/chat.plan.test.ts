/**
 * The crossword's chat hookup (WP8), written from docs/crossword-mode-plan.md
 * §2, §4.5, §4.6, §6.3 and §6.4 rather than from the code:
 *
 *  - a player is `youtube:<authorChannelId>`, not a display name;
 *  - the earliest message time wins a word, across a batch;
 *  - more than 5 guesses in 10 s from one player: the excess is ignored;
 *  - hidden players are ignored;
 *  - names are cleaned before they air (control chars and emoji stripped, 16
 *    characters at most, blocklist → "Player 1234");
 *  - wrong guesses get no on-air response;
 *  - `inputLive` is true only while a live run with chat on is attached;
 *  - the today board counts only today (UTC) and leaves hidden players out.
 *
 * The chat consumer (`crosswordChatBatch`) is driven end to end into a real
 * runner (`submitAnswersTo`) over a Mongo stand-in, on a fake clock.
 */
jest.mock("../socket", () => ({ emitWorkerEvent: jest.fn() }));
jest.mock("@photonsurge/shared/utill/logger", () => ({ log: jest.fn() }));

import {
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
import { crosswordChatBatch, type CrosswordChatInput } from "./chat";
import { newCrosswordRunnerState, step, submitAnswersTo, type CrosswordRunnerDeps, type CrosswordRunnerState } from "./runner";

const SCENE = "xw";
// 09:00 UTC; the intro is 12 s by default.
const T0 = Date.UTC(2026, 9, 5, 9, 0, 0);
const S = T0 + 12_000;

/**
 *  C A T      1A CAT, 1D CAR, 2D TAD, 3A RODE
 *  A . A
 *  R O D E
 */
const SPECS = [
  { answer: "CAT", clue: "Feline pet", row: 0, col: 0, dir: "across" as const },
  { answer: "CAR", clue: "Road vehicle", row: 0, col: 0, dir: "down" as const },
  { answer: "TAD", clue: "A little bit", row: 0, col: 2, dir: "down" as const },
  { answer: "RODE", clue: "Sat on a horse", row: 2, col: 0, dir: "across" as const },
];

const puzzle = (): CrosswordPuzzle => ({
  id: "p1",
  title: "Puzzle p1",
  width: 4,
  height: 3,
  entries: numberEntries(SPECS.map((s, i) => ({ ...s, wordId: `w${i}`, clueId: `c${i}` }))),
  status: "ready",
  familyFriendly: true,
  source: "bank",
  createdAt: 1,
  plays: [],
});

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));

type Run = { id: string; status: string; startAt?: number; chat?: { enabled: boolean } } | null;

/** A Mongo stand-in. `board` filters the solve log by the options it is given, as the repo does. */
function world(opts: { cfg?: Partial<CrosswordConfig>; hidden?: string[]; solves?: CrosswordSolve[]; run?: Run } = {}) {
  const p = puzzle();
  const cfg = mergeCrosswordConfig(DEFAULT_CROSSWORD_CONFIG, { enabled: true, playOffAir: true, ...opts.cfg });
  let game: CrosswordGame | null = null;
  const solves: CrosswordSolve[] = clone(opts.solves ?? []);
  const hidden = new Set(opts.hidden ?? []);
  let run: Run = opts.run ?? null;
  const touched: { id: string; name: string }[] = [];
  const db = {
    crosswordScenes: jest.fn(async () => [SCENE]),
    getOrInitCrosswordConfig: jest.fn(async () => cfg),
    activeRunForScene: jest.fn(async () => run),
    crosswordGames: {
      get: jest.fn(async () => (game ? clone(game) : null)),
      save: jest.fn(async (g: CrosswordGame) => {
        if (game && !(game.seq < g.seq)) return false;
        game = clone(g);
        return true;
      }),
    },
    crosswordPuzzles: {
      list: jest.fn(async ({ status }: { status?: string } = {}) => clone([p].filter((x) => !status || x.status === status))),
      get: jest.fn(async (id: string) => (id === p.id ? clone(p) : null)),
      startPlay: jest.fn(async (_id: string, sceneId: string, startedAt: number) => {
        p.plays.push({ sceneId, startedAt });
        return true;
      }),
      endPlay: jest.fn(async () => true),
    },
    crosswordSolves: {
      append: jest.fn(async (s: CrosswordSolve) => void solves.push(clone(s))),
      board: jest.fn(async (o: { sceneId?: string; since?: number; hiddenIds?: string[]; limit?: number } = {}) => {
        const rows = new Map<string, { playerId: string; name: string; points: number; words: number }>();
        for (const s of solves) {
          if (o.sceneId && s.sceneId !== o.sceneId) continue;
          if (typeof o.since === "number" && s.at < o.since) continue;
          if (o.hiddenIds?.includes(s.playerId)) continue;
          const r = rows.get(s.playerId) ?? { playerId: s.playerId, name: s.name, points: 0, words: 0 };
          r.points += s.points;
          r.words += 1;
          r.name = s.name;
          rows.set(s.playerId, r);
        }
        return [...rows.values()].sort((a, b) => b.points - a.points).slice(0, o.limit ?? 100);
      }),
    },
    crosswordPlayers: {
      touch: jest.fn(async (id: string, name: string, at: number) => {
        touched.push({ id, name });
        return { id, name, hidden: hidden.has(id), firstSeen: at, lastSeen: at };
      }),
      hiddenIds: jest.fn(async () => [...hidden]),
    },
  };
  return {
    db,
    solves,
    touched,
    setRun: (r: Run) => (run = r),
    entryId: (answer: string) => p.entries.find((e) => e.answer === answer)!.id,
  };
}

function host(w = world()) {
  const emitted: { type: string; data: any }[] = [];
  const deps: CrosswordRunnerDeps = {
    db: w.db as unknown as CrosswordRunnerDeps["db"],
    emit: (type, data) => emitted.push({ type, data: clone(data) }),
  };
  const state: CrosswordRunnerState = newCrosswordRunnerState();
  let now = T0;
  return {
    w,
    state,
    emitted,
    get now() {
      return now;
    },
    game: () => state.scenes.get(SCENE)?.game,
    pub: () => state.scenes.get(SCENE)?.game.pub as CrosswordPublicState | undefined,
    async until(t: number) {
      if (now === T0 && !state.scenes.size) await step(state, now, deps);
      while (now < t) {
        now = Math.min(t, now + 500);
        await step(state, now, deps);
      }
    },
    /** One chat batch through the real consumer into this runner. */
    chat(msgs: CrosswordChatInput[]) {
      return crosswordChatBatch(SCENE, msgs, now, (sceneId, answers) => submitAnswersTo(state, sceneId, answers, now, deps));
    },
  };
}

const yt = (channelId: string, author: string, text: string, ts: number): CrosswordChatInput => ({
  platform: "youtube",
  authorChannelId: channelId,
  author,
  text,
  ts,
});

const statesOf = (emitted: { type: string; data: any }[]) => emitted.filter((e) => e.type === CROSSWORD_STATE).map((e) => e.data as CrosswordPublicState);

// ---------------------------------------------------------------------------

describe("players", () => {
  test("a player is youtube:<authorChannelId>; the display name is not the key", async () => {
    const h = host();
    await h.until(S);
    await h.chat([yt("UC_ann", "Ann", "cat", h.now - 1_000)]);
    expect(h.w.solves).toHaveLength(1);
    expect(h.w.solves[0].playerId).toBe("youtube:UC_ann");
    expect(h.w.touched[0].id).toBe("youtube:UC_ann");
    expect(h.game()!.solved[h.w.entryId("CAT")].by).toBe("youtube:UC_ann");
  });

  test("two viewers sharing a display name are two players; one viewer renamed is one", async () => {
    const h = host();
    await h.until(S);
    await h.chat([yt("UC_1", "Sam", "cat", h.now - 3_000), yt("UC_2", "Sam", "car", h.now - 2_000), yt("UC_1", "Samuel", "tad", h.now - 1_000)]);
    const scores = h.game()!.scores;
    expect(Object.keys(scores).sort()).toEqual(["youtube:UC_1", "youtube:UC_2"]);
    expect(scores["youtube:UC_1"].words).toBe(2);
    expect(scores["youtube:UC_2"].words).toBe(1);
  });
});

describe("the earliest message time wins a word", () => {
  test("across one batch, whatever order the batch lists them", async () => {
    const h = host();
    await h.until(S);
    // Bob's message comes first in the batch but Ann typed hers earlier.
    await h.chat([yt("UC_bob", "Bob", "CAT", h.now - 2_000), yt("UC_ann", "Ann", "cat", h.now - 5_000)]);
    const s = h.game()!.solved[h.w.entryId("CAT")];
    expect(s.by).toBe("youtube:UC_ann");
    expect(h.w.solves.map((x) => x.playerId)).toEqual(["youtube:UC_ann"]);
  });

  test("the message time, not the poll time, is what counts: a word the host revealed passes to an answer typed before it (late)", async () => {
    const h = host();
    // RODE (the longest) is the first spotlight; its 60 s run out and the host fills it.
    await h.until(S + 62_000);
    const rode = h.w.entryId("RODE");
    expect(h.game()!.solved[rode]?.by).not.toMatch(/^youtube:/);
    // The poll reads it now, but it was typed 30 s into the clue.
    await h.chat([yt("UC_ann", "Ann", "rode", S + 30_000)]);
    expect(h.game()!.solved[rode]).toMatchObject({ by: "youtube:UC_ann", late: true });
  });
});

describe("rate limit: more than 5 guesses in 10 s from one player", () => {
  test("the sixth guess inside the window is ignored, even when it is right", async () => {
    const h = host();
    await h.until(S + 20_000);
    const t = h.now - 9_000;
    const wrong = ["dog", "cow", "pig", "hen", "elk"].map((w, i) => yt("UC_spam", "Spam", w, t + i * 1_000));
    await h.chat([...wrong, yt("UC_spam", "Spam", "cat", t + 5_000)]);
    expect(h.game()!.solved[h.w.entryId("CAT")]).toBeUndefined();
    expect(h.w.solves).toHaveLength(0);
  });

  test("five in the window are all heard", async () => {
    const h = host();
    await h.until(S + 20_000);
    const t = h.now - 9_000;
    const wrong = ["dog", "cow", "pig", "hen"].map((w, i) => yt("UC_p", "P", w, t + i * 1_000));
    await h.chat([...wrong, yt("UC_p", "P", "cat", t + 4_000)]);
    expect(h.game()!.solved[h.w.entryId("CAT")]?.by).toBe("youtube:UC_p");
  });

  test("the limit is per player: another player's answer still lands", async () => {
    const h = host();
    await h.until(S + 20_000);
    const t = h.now - 9_000;
    const spam = ["dog", "cow", "pig", "hen", "elk", "cat"].map((w, i) => yt("UC_spam", "Spam", w, t + i * 500));
    await h.chat([...spam, yt("UC_ok", "Ok", "cat", t + 4_000)]);
    expect(h.game()!.solved[h.w.entryId("CAT")]?.by).toBe("youtube:UC_ok");
  });

  test("the window is 10 s: guesses spread wider than that are all heard", async () => {
    const h = host();
    await h.until(S + 40_000);
    const t = h.now - 30_000;
    const spread = ["dog", "cow", "pig", "hen", "elk"].map((w, i) => yt("UC_p", "P", w, t + i * 2_500));
    // The sixth comes 12.5 s after the first, so only four are inside its window.
    await h.chat([...spread, yt("UC_p", "P", "cat", t + 12_500)]);
    expect(h.game()!.solved[h.w.entryId("CAT")]?.by).toBe("youtube:UC_p");
  });

  test("the limit holds across poll batches", async () => {
    const h = host();
    await h.until(S + 20_000);
    const t = h.now - 9_000;
    await h.chat(["dog", "cow", "pig"].map((w, i) => yt("UC_p", "P", w, t + i * 1_000)));
    await h.chat(["hen", "elk"].map((w, i) => yt("UC_p", "P", w, t + 3_000 + i * 1_000)));
    await h.chat([yt("UC_p", "P", "cat", t + 5_000)]);
    expect(h.game()!.solved[h.w.entryId("CAT")]).toBeUndefined();
  });
});

describe("hidden players", () => {
  test("a hidden player's right answer takes nothing; the word stays open for others", async () => {
    const h = host(world({ hidden: ["youtube:UC_troll"] }));
    await h.until(S);
    await h.chat([yt("UC_troll", "Troll", "cat", h.now - 3_000)]);
    expect(h.game()!.solved[h.w.entryId("CAT")]).toBeUndefined();
    expect(h.w.solves).toHaveLength(0);
    expect(h.game()!.scores["youtube:UC_troll"]).toBeUndefined();
    await h.chat([yt("UC_ann", "Ann", "cat", h.now - 1_000)]);
    expect(h.game()!.solved[h.w.entryId("CAT")]?.by).toBe("youtube:UC_ann");
  });
});

describe("names are cleaned before they air", () => {
  const solvedName = (h: ReturnType<typeof host>, answer: string) =>
    h.pub()!.entries.find((e) => e.id === h.w.entryId(answer))!.solved?.name;

  test("emoji and control characters stripped", async () => {
    const h = host();
    await h.until(S);
    await h.chat([yt("UC_1", "🌋 Lava\u0007 Fan 🌋", "cat", h.now - 1_000)]);
    expect(solvedName(h, "CAT")).toBe("Lava Fan");
    expect(h.w.solves[0].name).toBe("Lava Fan");
    expect(h.pub()!.scores[0].name).toBe("Lava Fan");
  });

  test("16 characters at most", async () => {
    const h = host();
    await h.until(S);
    await h.chat([yt("UC_1", "A very long display name indeed", "cat", h.now - 1_000)]);
    const name = solvedName(h, "CAT")!;
    expect(name.length).toBeLessThanOrEqual(16);
    expect("A very long display name indeed".startsWith(name)).toBe(true);
  });

  test("a name on the blocklist, or with nothing left, airs as Player NNNN", async () => {
    const h = host(world({ cfg: { blocklist: ["badname"] } }));
    await h.until(S);
    await h.chat([yt("UC_1", "BadName", "cat", h.now - 2_000), yt("UC_2", "🔥🔥🔥", "car", h.now - 1_000)]);
    expect(solvedName(h, "CAT")).toMatch(/^Player \d{4}$/);
    expect(solvedName(h, "CAR")).toMatch(/^Player \d{4}$/);
    // Nothing raw reaches anything that is emitted.
    const json = JSON.stringify(h.emitted);
    expect(json).not.toContain("BadName");
    expect(json).not.toContain("🔥");
  });
});

describe("wrong guesses get no on-air response", () => {
  test("a wrong guess changes nothing that is emitted or saved", async () => {
    const h = host();
    await h.until(S + 1_000);
    const seq = h.game()!.seq;
    const before = statesOf(h.emitted).length;
    const res = await h.chat([yt("UC_ann", "Ann", "dog", h.now - 500), yt("UC_ann", "Ann", "7a zebra", h.now - 400)]);
    expect(res.solved).toEqual([]);
    expect(h.game()!.seq).toBe(seq);
    expect(statesOf(h.emitted).length).toBe(before);
    expect(h.w.solves).toHaveLength(0);
  });

  test("commands and chatter are not guesses and are not passed to the runner", async () => {
    const submit = jest.fn(async () => ({ running: true, solved: [] as string[] }));
    await crosswordChatBatch(
      SCENE,
      [yt("UC_a", "A", ":modes", T0), yt("UC_a", "A", "!help", T0), yt("UC_a", "A", "x".repeat(60), T0)],
      T0,
      submit,
    );
    expect(submit).not.toHaveBeenCalled();
  });
});

describe("inputLive", () => {
  const inputLive = async (run: Run, cfg: Partial<CrosswordConfig> = {}) => {
    const h = host(world({ run, cfg }));
    await h.until(T0 + 2_000);
    return h.pub()?.inputLive;
  };

  test("true with a live run that has chat on", async () => {
    expect(await inputLive({ id: "r1", status: "live", startAt: T0 - 1_000, chat: { enabled: true } })).toBe(true);
  });

  test("false with a live run whose chat is off", async () => {
    expect(await inputLive({ id: "r1", status: "live", startAt: T0 - 1_000, chat: { enabled: false } })).toBe(false);
  });

  test("false with no run (the host playing off air)", async () => {
    expect(await inputLive(null)).toBe(false);
  });

  test("false with a run that is not live", async () => {
    expect(await inputLive({ id: "r1", status: "starting", startAt: T0 - 1_000, chat: { enabled: true } })).toBe(false);
    expect(await inputLive({ id: "r1", status: "ended", startAt: T0 - 1_000, chat: { enabled: true } })).toBe(false);
  });

  test("follows the run: goes false when the run ends", async () => {
    const w = world({ run: { id: "r1", status: "live", startAt: T0 - 1_000, chat: { enabled: true } } });
    const h = host(w);
    await h.until(T0 + 2_000);
    expect(h.pub()!.inputLive).toBe(true);
    w.setRun(null);
    await h.until(T0 + 5_000);
    expect(h.pub()!.inputLive).toBe(false);
    expect(statesOf(h.emitted).at(-1)!.inputLive).toBe(false);
  });
});

describe("today board", () => {
  const solve = (o: Partial<CrosswordSolve>): CrosswordSolve => ({
    id: `${o.playerId}:${o.at}`,
    sceneId: SCENE,
    puzzleId: "old",
    entryId: "e",
    playerId: "youtube:x",
    name: "X",
    points: 1,
    at: T0,
    ...o,
  });

  test("counts only solves since the start of today (UTC) and leaves hidden players out", async () => {
    const midnight = Date.UTC(2026, 9, 5);
    const w = world({
      hidden: ["youtube:UC_hid"],
      solves: [
        solve({ playerId: "youtube:UC_yday", name: "Yesterday", points: 50, at: midnight - 1 }),
        solve({ playerId: "youtube:UC_today", name: "Today", points: 3, at: midnight }),
        solve({ playerId: "youtube:UC_hid", name: "Hidden", points: 99, at: midnight + 1_000 }),
        solve({ playerId: "youtube:UC_other", name: "Elsewhere", points: 40, at: midnight + 1_000, sceneId: "other" }),
      ],
    });
    const h = host(w);
    await h.until(S);
    expect(h.pub()!.today).toEqual([{ name: "Today", points: 3 }]);
    const call = w.db.crosswordSolves.board.mock.calls.at(-1)![0]!;
    expect(call.since).toBe(midnight);
    expect(call.sceneId).toBe(SCENE);
    expect(call.hiddenIds).toEqual(["youtube:UC_hid"]);
  });

  test("a chat solve shows on today's board", async () => {
    const h = host();
    await h.until(S);
    await h.chat([yt("UC_ann", "Ann", "cat", h.now - 1_000)]);
    expect(h.pub()!.today.map((r) => r.name)).toEqual(["Ann"]);
    expect(h.pub()!.today[0].points).toBeGreaterThanOrEqual(1);
  });

  test("the board turns over at UTC midnight", async () => {
    const lateT0 = Date.UTC(2026, 9, 5, 23, 59, 50);
    const w = world({ solves: [solve({ playerId: "youtube:UC_a", name: "Ann", points: 5, at: lateT0 - 60_000 })] });
    const emitted: { type: string; data: any }[] = [];
    const deps: CrosswordRunnerDeps = { db: w.db as unknown as CrosswordRunnerDeps["db"], emit: (type, data) => emitted.push({ type, data }) };
    const state = newCrosswordRunnerState();
    let now = lateT0;
    await step(state, now, deps);
    while (now < lateT0 + 5_000) await step(state, (now += 500), deps);
    expect(state.scenes.get(SCENE)!.game.pub!.today).toEqual([{ name: "Ann", points: 5 }]);
    while (now < lateT0 + 15_000) await step(state, (now += 500), deps);
    expect(state.scenes.get(SCENE)!.game.pub!.today).toEqual([]);
  });
});
