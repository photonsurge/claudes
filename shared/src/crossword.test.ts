import {
  applyAnswer,
  answerStem,
  chooseNextPuzzle,
  cleanClue,
  cleanPlayerName,
  CROSSWORD_HOST_ID,
  DEFAULT_CROSSWORD_CONFIG,
  emptyGame,
  entryCells,
  fallbackPlayerName,
  hintTimes,
  hostSolvedCount,
  isPuzzleComplete,
  mergeCrosswordConfig,
  nextHint,
  numberEntries,
  parseGuess,
  pickSpotlight,
  pointsFor,
  revealEntry,
  sortedScores,
  toPublicState,
  unplayedStock,
  validateClue,
  withinRate,
  type CrosswordGame,
  type CrosswordPuzzle,
} from "./crossword";
import { CROSSWORD_SEED_WORDS } from "./crossword-seeds";
import { watchPath, sceneSurface } from "./control";

/**
 * A small hand-made grid:
 *
 *   C R A T E R     1A CRATER across from (0,0)
 *   O # # I # #     1D COMET  down   from (0,0), crosses at C
 *   M # # T # #     2D TITAN  down   from (0,3), crosses at T
 *   E # # A # #
 *   T # # N # #
 */
function makePuzzle(over: Partial<CrosswordPuzzle> = {}): CrosswordPuzzle {
  const entries = numberEntries([
    { answer: "CRATER", clue: "Bowl left by an impact", row: 0, col: 0, dir: "across" },
    { answer: "COMET", clue: "Icy visitor with a glowing tail", row: 0, col: 0, dir: "down" },
    { answer: "TITAN", clue: "Saturn's largest moon", row: 0, col: 3, dir: "down" },
  ]);
  return {
    id: "p1",
    title: "Space",
    theme: "space",
    width: 6,
    height: 5,
    entries,
    status: "ready",
    source: "seed",
    createdAt: 1,
    plays: [],
    ...over,
  };
}

function makeGame(over: Partial<CrosswordGame> = {}): CrosswordGame {
  return {
    ...emptyGame("xw", 0),
    puzzleId: "p1",
    puzzleNo: 1,
    phase: "playing",
    phaseEndsAt: 0,
    ...over,
  };
}

const T0 = 1_000_000;

describe("numberEntries", () => {
  it("numbers start cells in row order and shares a number for across+down", () => {
    const p = makePuzzle();
    expect(p.entries.map((e) => e.id)).toEqual(["1A", "1D", "2D"]);
    expect(p.entries.find((e) => e.id === "2D")).toMatchObject({ row: 0, col: 3, num: 2 });
  });

  it("uppercases answers and drops non-letters", () => {
    const [e] = numberEntries([{ answer: "milky way", clue: "x", row: 2, col: 1, dir: "across" }]);
    expect(e.answer).toBe("MILKYWAY");
    expect(e.id).toBe("1A");
  });

  it("entryCells walks across and down", () => {
    expect(entryCells({ row: 1, col: 2, dir: "down", length: 3 })).toEqual([
      { row: 1, col: 2 },
      { row: 2, col: 2 },
      { row: 3, col: 2 },
    ]);
  });
});

describe("parseGuess", () => {
  it.each([
    ["crater", "CRATER"],
    ["  Crater! ", "CRATER"],
    ["7a crater", "CRATER"],
    ["7 across: crater", "CRATER"],
    ["12-down titan", "TITAN"],
    ["12D TITAN", "TITAN"],
    ["milky way", "MILKYWAY"],
    ["7across crater", "CRATER"],
  ])("%s → %s", (txt, want) => expect(parseGuess(txt)).toBe(want));

  it("ignores long messages and ones with no letters", () => {
    expect(parseGuess("x".repeat(41))).toBeNull();
    expect(parseGuess("123 !!")).toBeNull();
    expect(parseGuess("")).toBeNull();
  });

  it("does not treat a word starting with digits+a as a ref unless it is one", () => {
    expect(parseGuess("2 apples")).toBe("APPLES");
    expect(parseGuess("adam")).toBe("ADAM");
  });
});

describe("pickSpotlight", () => {
  it("first pick is the longest word", () => {
    expect(pickSpotlight(makePuzzle(), makeGame())!.id).toBe("1A");
  });

  it("prefers the unsolved entry with most letters showing", () => {
    const p = makePuzzle();
    // Solve CRATER: COMET now shows C, TITAN shows T — equal (1 each), equal length 5 → lowest number (1D).
    const g = makeGame({ solved: { "1A": { by: "x", name: "x", at: T0, points: 1 } } });
    expect(pickSpotlight(p, g)!.id).toBe("1D");
    // A hint on TITAN gives it 2 showing.
    const g2 = { ...g, hints: [{ row: 1, col: 3, at: T0 }] };
    expect(pickSpotlight(p, g2)!.id).toBe("2D");
  });

  it("is null when all solved", () => {
    const p = makePuzzle();
    const solved = Object.fromEntries(p.entries.map((e) => [e.id, { by: "h", name: "h", at: 0, points: 0 }]));
    expect(pickSpotlight(p, makeGame({ solved }))).toBeNull();
    expect(isPuzzleComplete(p, { solved })).toBe(true);
  });
});

describe("hints", () => {
  const cfg = { hintStartFrac: 0.4, hintMaxFrac: 0.5 };
  const spot = { entryId: "1A", startedAt: T0, endsAt: T0 + 60_000 };

  it("none for the first 40%, then even steps up to half the word", () => {
    const times = hintTimes(spot, 6, cfg);
    expect(times).toHaveLength(3);
    expect(times[0]).toBe(T0 + 24_000);
    expect(times[1]).toBe(T0 + 36_000);
    expect(times[2]).toBe(T0 + 48_000);
  });

  it("first hint is the first letter, the next is far from it", () => {
    const p = makePuzzle();
    let g = makeGame({ spotlight: spot });
    expect(nextHint(p, g, T0 + 23_999, cfg)).toBeNull();
    const h1 = nextHint(p, g, T0 + 24_000, cfg)!;
    expect(h1).toEqual({ row: 0, col: 0 });
    g = { ...g, hints: [{ ...h1, at: T0 + 24_000 }] };
    expect(nextHint(p, g, T0 + 30_000, cfg)).toBeNull();
    expect(nextHint(p, g, T0 + 36_000, cfg)).toEqual({ row: 0, col: 5 });
  });

  it("letters from crossings count toward the cap", () => {
    const p = makePuzzle();
    // COMET and TITAN solved → C and T of CRATER showing; one more hint reaches 3 = cap.
    const solved = {
      "1D": { by: "x", name: "x", at: T0, points: 1 },
      "2D": { by: "x", name: "x", at: T0, points: 1 },
    };
    let g = makeGame({ spotlight: spot, solved });
    const h = nextHint(p, g, T0 + 24_000, cfg)!;
    expect(h).toEqual({ row: 0, col: 5 }); // furthest from C(0) and T(3)
    g = { ...g, hints: [{ ...h, at: T0 + 24_000 }] };
    expect(nextHint(p, g, T0 + 59_000, cfg)).toBeNull();
  });
});

describe("scoring and answering", () => {
  const cfg = { streamDelayS: 10 };

  it("points = letters not showing when typed, minimum 1", () => {
    const p = makePuzzle();
    const g = makeGame();
    const crater = p.entries[0];
    expect(pointsFor(p, g, crater, T0, 10)).toBe(6);
    const g2 = makeGame({ solved: { "1D": { by: "x", name: "x", at: T0, points: 1 } } });
    expect(pointsFor(p, g2, crater, T0 + 20_000, 10)).toBe(5);
  });

  it("a hint the viewer could not have seen yet does not cost them", () => {
    const p = makePuzzle();
    const g = makeGame({ hints: [{ row: 0, col: 0, at: T0 }] });
    const crater = p.entries[0];
    expect(pointsFor(p, g, crater, T0 + 5_000, 10)).toBe(6);
    expect(pointsFor(p, g, crater, T0 + 10_000, 10)).toBe(5);
  });

  it("first correct answer takes the word; a second gets nothing", () => {
    const p = makePuzzle();
    const g = makeGame();
    const r = applyAnswer(p, g, { playerId: "youtube:a", name: "Ann", text: "crater", typedAt: T0 }, cfg, T0 + 1);
    expect(r.kind).toBe("solved");
    if (r.kind === "none") throw new Error();
    expect(r.game.solved["1A"]).toMatchObject({ by: "youtube:a", name: "Ann", points: 6 });
    expect(r.game.scores["youtube:a"]).toEqual({ name: "Ann", points: 6, words: 1 });
    expect(r.game.feed[r.game.feed.length - 1].text).toBe("Ann took 1 ACROSS +6");
    const r2 = applyAnswer(p, r.game, { playerId: "youtube:b", name: "Bo", text: "CRATER", typedAt: T0 }, cfg, T0 + 2);
    expect(r2.kind).toBe("none");
  });

  it("wrong guesses and answers outside play are none", () => {
    const p = makePuzzle();
    expect(applyAnswer(p, makeGame(), { playerId: "a", name: "A", text: "moon", typedAt: T0 }, cfg, T0).kind).toBe("none");
    expect(applyAnswer(p, makeGame({ phase: "intro" }), { playerId: "a", name: "A", text: "crater", typedAt: T0 }, cfg, T0).kind).toBe("none");
  });

  it("late credit: typed before the reveal plus delay passes the word to the player", () => {
    const p = makePuzzle();
    const crater = p.entries[0];
    const revealed = revealEntry(makeGame(), crater, T0 + 60_000);
    expect(revealed.solved["1A"].by).toBe(CROSSWORD_HOST_ID);
    expect(hostSolvedCount(revealed)).toBe(1);
    const r = applyAnswer(p, revealed, { playerId: "p", name: "Pat", text: "crater", typedAt: T0 + 65_000 }, cfg, T0 + 140_000);
    expect(r.kind).toBe("late");
    if (r.kind === "none") throw new Error();
    expect(r.game.solved["1A"]).toMatchObject({ by: "p", late: true, at: T0 + 60_000 });
    expect(hostSolvedCount(r.game)).toBe(0);
    expect(r.game.feed[r.game.feed.length - 1].text).toMatch(/before the reveal/);
    // A second late answer finds the word already taken.
    const r2 = applyAnswer(p, r.game, { playerId: "q", name: "Q", text: "crater", typedAt: T0 + 61_000 }, cfg, T0 + 141_000);
    expect(r2.kind).toBe("none");
  });

  it("no late credit when typed after reveal plus delay", () => {
    const p = makePuzzle();
    const revealed = revealEntry(makeGame(), p.entries[0], T0);
    const r = applyAnswer(p, revealed, { playerId: "p", name: "P", text: "crater", typedAt: T0 + 10_001 }, cfg, T0 + 20_000);
    expect(r.kind).toBe("none");
  });

  it("scores sort by points then words then name", () => {
    expect(
      sortedScores({
        a: { name: "Zed", points: 4, words: 1 },
        b: { name: "Amy", points: 4, words: 1 },
        c: { name: "Bob", points: 9, words: 2 },
      }).map((s) => s.name),
    ).toEqual(["Bob", "Amy", "Zed"]);
  });

  it("rate limit allows max per window", () => {
    expect(withinRate([1000, 2000, 3000, 4000], 5000, 5, 10)).toBe(true);
    expect(withinRate([1000, 2000, 3000, 4000, 4500], 5000, 5, 10)).toBe(false);
    expect(withinRate([1000, 2000, 3000, 4000, 4500], 14_100, 5, 10)).toBe(true);
  });
});

describe("toPublicState", () => {
  it("leaks no unsolved letter and no answer", () => {
    const p = makePuzzle();
    const g = makeGame({
      hints: [{ row: 4, col: 3, at: T0 }],
      solved: { "1D": { by: "youtube:a", name: "Ann", at: T0, points: 5 } },
    });
    const pub = toPublicState(p, g, { now: T0 });
    expect(pub.rows).toEqual(["C.....", "O##.##", "M##.##", "E##.##", "T##N##"]);
    const json = JSON.stringify(pub);
    expect(json).not.toMatch(/CRATER|TITAN/);
    expect(json).not.toMatch(/"answer"/);
    expect(pub.entries.find((e) => e.id === "1D")!.solved).toEqual({ name: "Ann", points: 5 });
    expect(pub.entries.find((e) => e.id === "1A")).toMatchObject({ length: 6, clue: "Bowl left by an impact" });
    expect(pub.serverNow).toBe(T0);
  });

  it("an empty game projects an empty board", () => {
    const pub = emptyGame("xw", 5).pub;
    expect(pub).toMatchObject({ sceneId: "xw", phase: "idle", rows: [], entries: [], serverNow: 5 });
  });
});

describe("chooseNextPuzzle", () => {
  const P = (id: string, createdAt: number, plays: CrosswordPuzzle["plays"] = [], status: CrosswordPuzzle["status"] = "ready") =>
    makePuzzle({ id, createdAt, plays, status });

  it("oldest unplayed ready puzzle first", () => {
    const list = [P("b", 2), P("a", 1), P("c", 0, [], "draft"), P("d", 0, [{ sceneId: "xw", startedAt: 5 }])];
    expect(chooseNextPuzzle(list, "xw", 30)!.id).toBe("a");
    expect(unplayedStock(list, "xw")).toBe(2);
  });

  it("then the one played longest ago, outside the no-repeat window", () => {
    const list = [
      P("a", 1, [{ sceneId: "xw", startedAt: 300 }]),
      P("b", 2, [{ sceneId: "xw", startedAt: 100 }]),
      P("c", 3, [{ sceneId: "xw", startedAt: 200 }]),
    ];
    expect(chooseNextPuzzle(list, "xw", 1)!.id).toBe("b");
    expect(chooseNextPuzzle(list, "xw", 3)).toBeNull();
  });

  it("plays on another scene do not count", () => {
    const list = [P("a", 1, [{ sceneId: "other", startedAt: 1 }])];
    expect(chooseNextPuzzle(list, "xw", 30)!.id).toBe("a");
  });
});

describe("names", () => {
  it("strips emoji and control chars, caps at 16", () => {
    expect(cleanPlayerName("🌋 Lava Fan 🌋", "youtube:1")).toBe("Lava Fan");
    expect(cleanPlayerName("@rich\u0007", "youtube:1")).toBe("rich");
    expect(cleanPlayerName("A very long display name indeed", "youtube:1")).toBe("A very long disp");
  });

  it("falls back to Player NNNN on empty or blocked names", () => {
    const fb = fallbackPlayerName("youtube:1");
    expect(fb).toMatch(/^Player \d{4}$/);
    expect(cleanPlayerName("🔥🔥", "youtube:1")).toBe(fb);
    expect(cleanPlayerName("xXfuckXx", "youtube:1")).toBe(fb);
    expect(cleanPlayerName("Bobby", "youtube:1", ["bob"])).toBe("Bobby");
    expect(cleanPlayerName("Bob", "youtube:1", ["bob"])).toBe(fb);
  });
});

describe("clues", () => {
  it("cleanClue strips a trailing letter count", () => {
    expect(cleanClue("Work remuneration (5)")).toBe("Work remuneration");
    expect(cleanClue("  Big   cat (3,4) ")).toBe("Big cat");
  });

  it("validateClue rejects short, long, leaking and blocked clues", () => {
    expect(validateClue("Too sh", "WAGE")).toBe("short");
    expect(validateClue("x".repeat(49), "WAGE")).toBe("long");
    expect(validateClue("Judicial probation", "PROBATE")).toBe("leak");
    expect(validateClue("A crater on the Moon", "CRATER")).toBe("leak");
    expect(validateClue("Fuck this word", "WAGE")).toBe("blocked");
    expect(validateClue("Pay for a week of work", "WAGE")).toBeNull();
    expect(validateClue("Small insect in plants", "ANT")).toBeNull();
  });

  it("answerStem removes one common ending", () => {
    expect(answerStem("PROBATE")).toBe("PROBAT");
    expect(answerStem("RUNNING")).toBe("RUNN");
    expect(answerStem("CAT")).toBe("CAT");
  });

  it("every seed clue validates and answers are A-Z", () => {
    expect(CROSSWORD_SEED_WORDS.length).toBeGreaterThanOrEqual(40);
    for (const w of CROSSWORD_SEED_WORDS) {
      expect(w.answer).toMatch(/^[A-Z]{3,12}$/);
      expect([w.answer, validateClue(w.clue, w.answer)]).toEqual([w.answer, null]);
    }
  });
});

describe("config", () => {
  it("merges, clamps and drops unknown keys", () => {
    const c = mergeCrosswordConfig(DEFAULT_CROSSWORD_CONFIG, {
      enabled: true,
      clueS: 5,
      minWords: 12,
      maxWords: 8,
      themes: ["weather", " weather ", "", 3],
      bogus: 1,
    } as any);
    expect(c.enabled).toBe(true);
    expect(c.clueS).toBe(15);
    expect(c.maxWords).toBe(12);
    expect(c.themes).toEqual(["weather"]);
    expect((c as any).bogus).toBeUndefined();
    expect(DEFAULT_CROSSWORD_CONFIG.themes).toEqual([]);
  });
});

describe("surface and watchPath", () => {
  it("maps each surface to its watch route", () => {
    expect(watchPath({ id: "studio-b" })).toBe("/watch/studio-b");
    expect(watchPath({ id: "words", surface: "crossword" })).toBe("/watch/crossword/words");
    expect(watchPath({ id: "x", surface: "nonsense" })).toBe("/watch/x");
    expect(sceneSurface(undefined)).toBe("globe");
  });
});
