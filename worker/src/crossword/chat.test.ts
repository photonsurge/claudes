/**
 * The crossword's chat consumer (crossword plan §4.5, §6.4): which messages
 * become answers and under which player id, and — through the real runner —
 * that live chat players are `youtube:<authorChannelId>`, rate limited,
 * ignored when hidden, aired under a cleaned name, and land on the today
 * board without the hidden ones.
 */
jest.mock("../socket", () => ({ emitWorkerEvent: jest.fn() }));
jest.mock("@photonsurge/shared/utill/logger", () => ({ log: jest.fn() }));

import {
  mergeCrosswordConfig,
  numberEntries,
  DEFAULT_CROSSWORD_CONFIG,
  type CrosswordGame,
  type CrosswordPuzzle,
} from "@photonsurge/shared/crossword";
import type { CrosswordPlayer, CrosswordSolve } from "@photonsurge/shared/crossword-records";
import { newCrosswordRunnerState, step, submitAnswersTo, type CrosswordRunnerDeps } from "./runner";
import { crosswordChatBatch, toCrosswordAnswers, type CrosswordChatInput } from "./chat";

const SCENE = "xw";
const T0 = Date.UTC(2026, 9, 5, 12, 0, 0);

const yt = (author: string, channel: string | undefined, text: string, ts: number): CrosswordChatInput => ({
  author,
  text,
  platform: "youtube",
  ts,
  ...(channel ? { authorChannelId: channel } : {}),
});

describe("toCrosswordAnswers", () => {
  it("a YouTube author is youtube:<authorChannelId>, typed at the message's publish time", () => {
    expect(toCrosswordAnswers([yt("Ann", "UCann", "cat", T0 - 5_000)], T0)).toEqual([
      { playerId: "youtube:UCann", name: "Ann", text: "cat", typedAt: T0 - 5_000 },
    ]);
  });

  it("drops messages with no channel id, commands, chatter over 40 characters and text with no letters", () => {
    const out = toCrosswordAnswers(
      [
        yt("a", undefined, "cat", T0),
        yt("b", "UCb", ":help", T0),
        yt("c", "UCc", "!mode", T0),
        yt("d", "UCd", "x".repeat(41), T0),
        yt("e", "UCe", "123 !!", T0),
        yt("f", "UCf", "7 across: rode", T0),
      ],
      T0,
    );
    expect(out.map((a) => a.playerId)).toEqual(["youtube:UCf"]);
  });

  it("a future or missing time is clamped to now", () => {
    const [a, b] = toCrosswordAnswers([yt("a", "UCa", "cat", T0 + 60_000), { author: "b", text: "cat", platform: "youtube", authorChannelId: "UCb" }], T0);
    expect(a.typedAt).toBe(T0);
    expect(b.typedAt).toBe(T0);
  });

  it("a simulated message is sim:<name>, marked sim", () => {
    expect(toCrosswordAnswers([{ author: " Ann ", text: "cat", platform: "sim", ts: T0 }], T0)).toEqual([
      { playerId: "sim:ann", name: "Ann", text: "cat", typedAt: T0, sim: true },
    ]);
  });
});

describe("crosswordChatBatch", () => {
  it("submits nothing when nothing is guess-shaped", async () => {
    const submit = jest.fn();
    expect(await crosswordChatBatch(SCENE, [yt("a", "UCa", "hello there, how is everyone doing today?", T0)], T0, submit)).toEqual({
      running: true,
      solved: [],
    });
    expect(submit).not.toHaveBeenCalled();
  });

  it("never throws", async () => {
    const submit = jest.fn(async () => {
      throw new Error("boom");
    });
    expect(await crosswordChatBatch(SCENE, [yt("a", "UCa", "cat", T0)], T0, submit)).toEqual({ running: false, solved: [] });
  });
});

/**
 *  C A T .      1A CAT, 3A RODE
 *  A . A .      1D CAR, 2D TAD
 *  R O D E
 */
const puzzle = (): CrosswordPuzzle => ({
  id: "p1",
  title: "Puzzle p1",
  width: 4,
  height: 3,
  entries: numberEntries([
    { answer: "CAT", clue: "Feline pet", row: 0, col: 0, dir: "across" },
    { answer: "CAR", clue: "Road vehicle", row: 0, col: 0, dir: "down" },
    { answer: "TAD", clue: "A little bit", row: 0, col: 2, dir: "down" },
    { answer: "RODE", clue: "Sat on a horse", row: 2, col: 0, dir: "across" },
  ]),
  status: "ready",
  familyFriendly: true,
  source: "seed",
  createdAt: 1,
  plays: [],
});

function harness() {
  const copy = <T>(x: T): T => JSON.parse(JSON.stringify(x));
  const p = puzzle();
  const cfg = mergeCrosswordConfig(DEFAULT_CROSSWORD_CONFIG, { enabled: true, rateMax: 2, rateWindowS: 10 });
  let game: CrosswordGame | null = null;
  const solves: CrosswordSolve[] = [];
  const players = new Map<string, CrosswordPlayer>();
  const run = { id: "run1", status: "live", startAt: T0, chat: { enabled: true } };
  const db = {
    crosswordScenes: async () => [SCENE],
    getOrInitCrosswordConfig: async () => cfg,
    activeRunForScene: async () => run,
    crosswordGames: {
      get: async () => (game ? copy(game) : null),
      save: async (g: CrosswordGame) => {
        game = copy(g);
      },
    },
    crosswordPuzzles: {
      list: async () => [copy(p)],
      get: async () => copy(p),
      startPlay: async () => true,
      endPlay: async () => true,
    },
    crosswordSolves: {
      append: async (s: CrosswordSolve) => void solves.push(copy(s)),
      board: async (o: { since?: number; hiddenIds?: string[] }) => {
        const m = new Map<string, { playerId: string; name: string; points: number; words: number }>();
        for (const s of solves) {
          if ((o.since != null && s.at < o.since) || o.hiddenIds?.includes(s.playerId)) continue;
          const r = m.get(s.playerId) ?? { playerId: s.playerId, name: s.name, points: 0, words: 0 };
          r.points += s.points;
          r.words += 1;
          m.set(s.playerId, r);
        }
        return [...m.values()].sort((a, b) => b.points - a.points);
      },
    },
    crosswordPlayers: {
      touch: async (id: string, name: string, at: number) => {
        const pl = players.get(id) ?? { id, name, hidden: false, firstSeen: at, lastSeen: at };
        pl.name = name;
        pl.lastSeen = at;
        players.set(id, pl);
        return { ...pl };
      },
      hiddenIds: async () => [...players.values()].filter((x) => x.hidden).map((x) => x.id),
    },
  };
  const emitted: Array<{ type: string; data: any }> = [];
  const deps = { db, emit: (type: string, data: unknown) => emitted.push({ type, data }) } as unknown as CrosswordRunnerDeps;
  const state = newCrosswordRunnerState();
  const h = {
    now: T0,
    state,
    deps,
    solves,
    players,
    pub: () => game!.pub,
    async to(ms: number) {
      h.now = ms;
      await step(state, ms, deps);
    },
    send: (msgs: CrosswordChatInput[]) =>
      crosswordChatBatch(SCENE, msgs, h.now, (sceneId, answers) => submitAnswersTo(state, sceneId, answers, h.now, deps)),
  };
  return h;
}

describe("live chat through the runner", () => {
  async function playing() {
    const h = harness();
    await h.to(T0);
    await h.to(T0 + DEFAULT_CROSSWORD_CONFIG.introS * 1000 + 1);
    expect(h.pub().phase).toBe("playing");
    return h;
  }

  it("the go-live with chat on sets inputLive in the projection", async () => {
    const h = await playing();
    expect(h.pub().inputLive).toBe(true);
  });

  it("a correct answer solves the word under youtube:<authorChannelId> and a cleaned name, and goes on the today board", async () => {
    const h = await playing();
    const res = await h.send([yt("Ann 🎉\u0007", "UCann", "cat", h.now - 1_000)]);
    expect(res).toEqual({ running: true, solved: ["1A"] });
    expect(h.solves).toEqual([expect.objectContaining({ playerId: "youtube:UCann", name: "Ann", entryId: "1A" })]);
    expect(h.players.get("youtube:UCann")?.name).toBe("Ann");
    expect(h.pub().today).toEqual([expect.objectContaining({ name: "Ann" })]);
    // The projection never carries a player id.
    expect(JSON.stringify(h.pub())).not.toContain("UCann");
  });

  it("over the rate limit the excess is ignored, per player", async () => {
    const h = await playing();
    const t = h.now - 2_000;
    const res = await h.send([
      yt("Spam", "UCs", "dog", t),
      yt("Spam", "UCs", "pig", t + 1),
      yt("Spam", "UCs", "cat", t + 2),
      yt("Bob", "UCb", "rode", t + 3),
    ]);
    expect(res.solved).toEqual(["3A"]);
    expect(h.solves.map((s) => s.playerId)).toEqual(["youtube:UCb"]);
  });

  it("a hidden player is ignored", async () => {
    const h = await playing();
    h.players.set("youtube:UCghost", { id: "youtube:UCghost", name: "ghost", hidden: true, firstSeen: 0, lastSeen: 0 });
    const res = await h.send([yt("ghost", "UCghost", "cat", h.now - 1_000)]);
    expect(res.solved).toEqual([]);
    expect(h.solves).toEqual([]);
  });

  it("the earliest typed wins a word, whatever order the batch is in", async () => {
    const h = await playing();
    await h.send([yt("Late", "UClate", "cat", h.now - 1_000), yt("Early", "UCearly", "cat", h.now - 3_000)]);
    expect(h.solves).toEqual([expect.objectContaining({ playerId: "youtube:UCearly" })]);
  });
});
