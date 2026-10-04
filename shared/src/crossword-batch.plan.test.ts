/**
 * The cross-package batch (stock, replay, the structured stock reason, the
 * unapproved marker, the queue index, the Words count cap) against
 * docs/crossword-mode-plan.md §4.4, §7.4, §7.5 and §8.3. Written from the
 * plan and the batch's stated intent, not from the code.
 */
import {
  chooseNextPuzzle,
  crosswordStockReason,
  numberEntries,
  unplayedStock,
  type CrosswordPuzzle,
} from "./crossword";
import { BANK_COUNT_CAP, BANK_QUEUE_SORT, BANK_WORD_INDEXES, bankQueueFilter } from "./crossword-bank";

const SCENE = "xw";
const OTHER = "xw2";

function mk(
  id: string,
  o: Partial<Pick<CrosswordPuzzle, "createdAt" | "familyFriendly" | "status" | "plays" | "unapproved" | "entries">> = {},
): CrosswordPuzzle {
  return {
    id,
    title: `Puzzle ${id}`,
    width: 3,
    height: 3,
    entries:
      o.entries ??
      numberEntries([
        { answer: "CAT", clue: "Feline pet", row: 0, col: 0, dir: "across", wordId: "w1", clueId: "c1" },
        { answer: "CAR", clue: "Road vehicle", row: 0, col: 0, dir: "down", wordId: "w2", clueId: "c2" },
      ]),
    status: o.status ?? "ready",
    familyFriendly: o.familyFriendly ?? true,
    source: "bank",
    createdAt: o.createdAt ?? 1,
    plays: o.plays ?? [],
    ...(o.unapproved ? { unapproved: true } : {}),
  };
}
const played = (...at: number[]) => at.map((startedAt) => ({ sceneId: SCENE, startedAt, endedAt: startedAt + 10 }));

describe("next puzzle: replay rather than idle (§4.4, §7.5)", () => {
  it("with every eligible puzzle inside the no-repeat window, replays the one played longest ago", () => {
    const stock = [mk("a", { plays: played(300) }), mk("b", { plays: played(100) }), mk("c", { plays: played(200) })];
    expect(chooseNextPuzzle(stock, SCENE, 30)?.id).toBe("b");
  });

  it("a single puzzle, just played, is played again", () => {
    expect(chooseNextPuzzle([mk("a", { plays: played(500) })], SCENE, 30)?.id).toBe("a");
  });

  it("'played longest ago' goes by a puzzle's latest play on this channel", () => {
    // a aired first but also most recently; b's only play sits between.
    const stock = [mk("a", { plays: played(10, 900) }), mk("b", { plays: played(500) })];
    expect(chooseNextPuzzle(stock, SCENE, 30)?.id).toBe("b");
  });

  it("an unplayed puzzle still comes first, the oldest one", () => {
    const stock = [mk("old", { plays: played(1) }), mk("new2", { createdAt: 20 }), mk("new1", { createdAt: 10 })];
    expect(chooseNextPuzzle(stock, SCENE, 30)?.id).toBe("new1");
  });

  it("outside the window, the one played longest ago", () => {
    const stock = [mk("a", { plays: played(100) }), mk("b", { plays: played(200) }), mk("c", { plays: played(300) })];
    expect(chooseNextPuzzle(stock, SCENE, 1)?.id).toBe("a");
  });

  it("a play on another channel does not count as played here", () => {
    const stock = [mk("a", { plays: played(100) }), mk("b", { plays: [{ sceneId: OTHER, startedAt: 50 }] })];
    expect(chooseNextPuzzle(stock, SCENE, 30)?.id).toBe("b");
  });

  it("the replay never picks a puzzle the channel may not play", () => {
    const stock = [
      mk("rej", { status: "rejected", plays: played(1) }),
      mk("notff", { familyFriendly: false, plays: played(2) }),
      mk("unap", { unapproved: true, plays: played(3) }),
      mk("empty", { entries: [], plays: played(4) }),
      mk("ok", { plays: played(900) }),
    ];
    expect(chooseNextPuzzle(stock, SCENE, 30, { familyFriendlyOnly: true })?.id).toBe("ok");
  });

  it("idles only with no eligible ready puzzle", () => {
    expect(chooseNextPuzzle([], SCENE, 30)).toBeNull();
    expect(chooseNextPuzzle([mk("rej", { status: "rejected" })], SCENE, 30)).toBeNull();
    expect(chooseNextPuzzle([mk("notff", { familyFriendly: false })], SCENE, 30, { familyFriendlyOnly: true })).toBeNull();
    expect(chooseNextPuzzle([mk("unap", { unapproved: true })], SCENE, 30)).toBeNull();
    expect(chooseNextPuzzle([mk("empty", { entries: [] })], SCENE, 30)).toBeNull();
  });
});

describe("puzzles built from unapproved words (§7.4 dev switch)", () => {
  it("never play unless allowUnapproved", () => {
    const stock = [mk("unap", { unapproved: true, createdAt: 1 }), mk("ok", { createdAt: 2 })];
    expect(chooseNextPuzzle(stock, SCENE, 30)?.id).toBe("ok");
    expect(chooseNextPuzzle(stock, SCENE, 30, { allowUnapproved: true })?.id).toBe("unap");
  });

  it("do not count as stock unless allowed", () => {
    const stock = [mk("unap", { unapproved: true }), mk("ok")];
    expect(unplayedStock(stock, SCENE)).toBe(1);
    expect(unplayedStock(stock, SCENE, { allowUnapproved: true })).toBe(2);
  });

  it("an approved puzzle with no marker plays either way", () => {
    expect(chooseNextPuzzle([mk("ok")], SCENE, 30, { allowUnapproved: false })?.id).toBe("ok");
  });
});

describe("crosswordStockReason (§7.5: the Desk says why)", () => {
  const cfg = (o: { familyFriendlyOnly?: boolean; allowUnapproved?: boolean; noRepeatPuzzles?: number } = {}) => ({
    familyFriendlyOnly: false,
    noRepeatPuzzles: 30,
    ...o,
  });

  it("fresh, with the count of unplayed puzzles, when nothing is on air and unplayed stock waits", () => {
    const stock = [mk("a"), mk("b"), mk("c", { plays: played(5) })];
    expect(crosswordStockReason(stock, SCENE, "", cfg())).toEqual({ kind: "fresh", unplayed: 2 });
  });

  it("replay (not idle) when everything was played, even inside the window", () => {
    const stock = [mk("a", { plays: played(5) }), mk("b", { plays: played(6) })];
    expect(crosswordStockReason(stock, SCENE, "", cfg())).toEqual({ kind: "replay", unplayed: 0 });
  });

  it("noReady with no ready puzzle at all", () => {
    expect(crosswordStockReason([], SCENE, "", cfg())).toEqual({ kind: "noReady", unplayed: 0 });
    expect(crosswordStockReason([mk("r", { status: "rejected" })], SCENE, "", cfg()).kind).toBe("noReady");
  });

  it("noFamilyFriendly when ready puzzles exist but none is family friendly on a family-friendly channel", () => {
    const stock = [mk("a", { familyFriendly: false })];
    expect(crosswordStockReason(stock, SCENE, "", cfg({ familyFriendlyOnly: true }))).toEqual({ kind: "noFamilyFriendly", unplayed: 0 });
    // The same stock on a channel without the switch is fresh.
    expect(crosswordStockReason(stock, SCENE, "", cfg()).kind).toBe("fresh");
  });

  it("a family-friendly channel with no ready puzzle at all is noReady, not noFamilyFriendly", () => {
    expect(crosswordStockReason([], SCENE, "", cfg({ familyFriendlyOnly: true })).kind).toBe("noReady");
  });

  it("the puzzle on air for the first time is fresh; the count leaves it out", () => {
    const stock = [mk("on", { plays: [{ sceneId: SCENE, startedAt: 100 }] }), mk("next")];
    expect(crosswordStockReason(stock, SCENE, "on", cfg())).toEqual({ kind: "fresh", unplayed: 1 });
  });

  it("the puzzle on air that aired here before is a replay", () => {
    const stock = [mk("on", { plays: [{ sceneId: SCENE, startedAt: 10, endedAt: 20 }, { sceneId: SCENE, startedAt: 100 }] })];
    expect(crosswordStockReason(stock, SCENE, "on", cfg())).toEqual({ kind: "replay", unplayed: 0 });
  });

  it("plays on another channel do not make the puzzle on air a replay", () => {
    const stock = [mk("on", { plays: [{ sceneId: OTHER, startedAt: 10, endedAt: 20 }, { sceneId: SCENE, startedAt: 100 }] })];
    expect(crosswordStockReason(stock, SCENE, "on", cfg()).kind).toBe("fresh");
  });

  it("the unplayed count follows the channel's filters", () => {
    const stock = [mk("a"), mk("b", { familyFriendly: false }), mk("c", { unapproved: true }), mk("d", { status: "rejected" })];
    expect(crosswordStockReason(stock, SCENE, "", cfg()).unplayed).toBe(2);
    expect(crosswordStockReason(stock, SCENE, "", cfg({ familyFriendlyOnly: true })).unplayed).toBe(1);
    expect(crosswordStockReason(stock, SCENE, "", cfg({ allowUnapproved: true })).unplayed).toBe(3);
  });

  it("only unapproved stock: idle unless allowed", () => {
    const stock = [mk("u", { unapproved: true })];
    expect(crosswordStockReason(stock, SCENE, "", cfg()).kind).toBe("noReady");
    expect(crosswordStockReason(stock, SCENE, "", cfg({ allowUnapproved: true })).kind).toBe("fresh");
  });

  it("agrees with chooseNextPuzzle: idle reasons exactly when there is nothing to pick", () => {
    const cases: CrosswordPuzzle[][] = [
      [],
      [mk("a")],
      [mk("a", { plays: played(1) })],
      [mk("a", { familyFriendly: false })],
      [mk("a", { unapproved: true })],
      [mk("a", { status: "rejected" })],
    ];
    for (const stock of cases) {
      for (const familyFriendlyOnly of [false, true]) {
        const next = chooseNextPuzzle(stock, SCENE, 30, { familyFriendlyOnly });
        const kind = crosswordStockReason(stock, SCENE, "", cfg({ familyFriendlyOnly })).kind;
        expect([kind, !!next]).toEqual([kind, kind === "fresh" || kind === "replay"]);
      }
    }
  });
});

describe("the approval queue's index (§7.4)", () => {
  const queueIx = () => BANK_WORD_INDEXES.find((ix) => ix.partialFilterExpression && JSON.stringify(ix.key) === JSON.stringify(BANK_QUEUE_SORT));

  it("there is a partial index keyed exactly in the queue's sort order", () => {
    const ix = queueIx();
    expect(ix).toBeDefined();
    expect(Object.entries(ix!.key)).toEqual(Object.entries(BANK_QUEUE_SORT));
  });

  /** Every condition of the partial filter must be implied by the queue's query, or Mongo cannot use the index. */
  it("every queue query (both tiers, any filter) falls inside the partial filter", () => {
    const partial = queueIx()!.partialFilterExpression!;
    const queries = [
      {},
      { band: "common" },
      { minLength: 5, maxLength: 7 },
      { startsWith: "q", withSuggestions: true },
    ] as const;
    for (const q of queries) {
      for (const tier of ["preferred", "rest"] as const) {
        const and = (bankQueueFilter(q as never, tier) as { $and: Record<string, unknown>[] }).$and;
        for (const [k, want] of Object.entries(partial)) {
          const have = and.filter((c) => k in c).map((c) => c[k]);
          const implied = have.some((v) => {
            if (JSON.stringify(v) === JSON.stringify(want)) return true;
            if (want && typeof want === "object" && "$type" in want) {
              return !!v && typeof v === "object" && (v as { $type?: unknown }).$type === (want as { $type: unknown }).$type;
            }
            return false;
          });
          expect([JSON.stringify(q), tier, k, implied]).toEqual([JSON.stringify(q), tier, k, true]);
        }
      }
    }
  });
});

describe("the Words list count cap (§8.3)", () => {
  it("caps at 10,000", () => {
    expect(BANK_COUNT_CAP).toBe(10_000);
  });
});
