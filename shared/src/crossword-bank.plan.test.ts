import {
  BANK_QUEUE_SORT,
  POOL_NO_REPEAT_PUZZLES,
  POOL_WORDS_PER_PUZZLE,
  approvalFilter,
  bankPlayableClueFilter,
  bankPlayableFilter,
  bankQueueFilter,
  bankWordFilter,
  familyFilter,
  poolCounts,
  toBankApproval,
  toBankClue,
  toBankWordRow,
  toFamilyFriendly,
} from "./crossword-bank";

/**
 * Written from docs/crossword-mode-plan.md §7.3 step 1 and §7.4, not from the
 * code: the pure Mongo filters behind the playable pick, the approval list
 * filters, the approval queue and the pool counter's arithmetic. The repo
 * test (db/crossword-bank-repo.plan.test.ts) runs the same rules over a
 * fixture.
 */

/** Pull every `{ path: cond }` pair out of a filter, through `$and`. */
function conds(f: Record<string, unknown>): [string, unknown][] {
  const out: [string, unknown][] = [];
  for (const [k, v] of Object.entries(f)) {
    if (k === "$and") for (const x of v as Record<string, unknown>[]) out.push(...conds(x));
    else out.push([k, v]);
  }
  return out;
}
const condOn = (f: Record<string, unknown>, path: string) => conds(f).filter(([k]) => k === path).map(([, v]) => v);

describe("the playable pick's word filter (§7.3 step 1)", () => {
  it("requires an approved word, 3–12 letters, at or above minZipf", () => {
    const f = bankPlayableFilter({ minZipf: 3.5 });
    expect(condOn(f, "approval.status")).toEqual(["approved"]);
    expect(condOn(f, "length")).toEqual([{ $gte: 3, $lte: 12 }]);
    expect(condOn(f, "validation.sources.wordfreq.zipf")).toEqual([{ $gte: 3.5 }]);
  });

  it("on a family-friendly channel the word must be tagged true (untagged counts as not)", () => {
    const f = bankPlayableFilter({ minZipf: 3.5, familyFriendlyOnly: true });
    expect(condOn(f, "familyFriendly")).toEqual([true]);
  });

  it("off a family-friendly channel the tag plays no part", () => {
    const f = bankPlayableFilter({ minZipf: 3.5, familyFriendlyOnly: false });
    expect(condOn(f, "familyFriendly")).toEqual([]);
  });

  it("leaves out the words of the channel's last puzzles", () => {
    const f = bankPlayableFilter({ minZipf: 3, excludeNorms: ["COMET", "ORBIT"] });
    expect(condOn(f, "norm")).toEqual([{ $nin: ["COMET", "ORBIT"] }]);
  });

  it("never widens the 3–12 letter range", () => {
    const f = bankPlayableFilter({ minZipf: 3, minLength: 1, maxLength: 20 });
    expect(condOn(f, "length")).toEqual([{ $gte: 3, $lte: 12 }]);
  });
});

describe("the playable pick's clue filter (§7.3 step 1, §7.4)", () => {
  it("only approved clues of the picked words", () => {
    const f = bankPlayableClueFilter(["a", "b"], { familyFriendlyOnly: false });
    expect(condOn(f, "answerId")).toEqual([{ $in: ["a", "b"] }]);
    expect(condOn(f, "approval.status")).toEqual(["approved"]);
    expect(condOn(f, "familyFriendly")).toEqual([]);
  });

  it("on a family-friendly channel the clue must be tagged true as well", () => {
    const f = bankPlayableClueFilter(["a"], { familyFriendlyOnly: true });
    expect(condOn(f, "approval.status")).toEqual(["approved"]);
    expect(condOn(f, "familyFriendly")).toEqual([true]);
  });
});

describe("approval and family-friendly filters (§7.4, §8.3 list)", () => {
  it("pending matches a word with no approval yet (everything imported starts pending)", () => {
    const f = approvalFilter("approval.status", "pending");
    const v = condOn(f, "approval.status")[0] as { $nin?: unknown[] };
    // Whatever the shape, it must not match approved or rejected, and must match missing.
    expect(v).toEqual({ $nin: expect.arrayContaining(["approved", "rejected"]) });
  });

  it("approved and rejected match exactly", () => {
    expect(approvalFilter("approval.status", "approved")).toEqual({ "approval.status": "approved" });
    expect(approvalFilter("approval.status", "rejected")).toEqual({ "approval.status": "rejected" });
  });

  it("family friendly yes / no / untagged", () => {
    expect(familyFilter("familyFriendly", "yes")).toEqual({ familyFriendly: true });
    expect(familyFilter("familyFriendly", "no")).toEqual({ familyFriendly: false });
    // Untagged: neither true nor false (null or missing).
    expect(familyFilter("familyFriendly", "untagged")).toEqual({ familyFriendly: { $nin: [true, false] } });
  });

  it("the Words list combines them with its other filters", () => {
    const f = bankWordFilter({ approval: "approved", familyFriendly: "untagged", startsWith: "c" });
    expect(condOn(f, "approval.status")).toEqual(["approved"]);
    expect(condOn(f, "familyFriendly")).toEqual([{ $nin: [true, false] }]);
    expect(condOn(f, "norm")).toEqual([{ $regex: "^C" }]);
  });
});

describe("stored values → wire (§7.4 starting values)", () => {
  it("a missing approval reads as pending, with no who or when", () => {
    expect(toBankApproval(undefined)).toEqual({ status: "pending" });
    expect(toBankApproval({ status: "bogus" })).toEqual({ status: "pending" });
  });

  it("an approval keeps who and when", () => {
    expect(toBankApproval({ status: "approved", by: "rich", at: 1234 })).toEqual({ status: "approved", by: "rich", at: 1234 });
  });

  it("a missing tag is untagged (null), not false and not true", () => {
    expect(toFamilyFriendly(undefined)).toBeNull();
    expect(toFamilyFriendly(null)).toBeNull();
    expect(toFamilyFriendly(true)).toBe(true);
    expect(toFamilyFriendly(false)).toBe(false);
  });

  it("an imported word reads as pending and untagged, its model flags as warnings only", () => {
    const row = toBankWordRow({ _id: "w1", word: "excited", norm: "EXCITED", length: 7, flags: { adult: true } });
    expect(row.approval).toEqual({ status: "pending" });
    expect(row.familyFriendly).toBeNull();
    expect(row.warnings).toEqual(["adult"]);
  });

  it("a stored suggestion is not an approval", () => {
    const row = toBankWordRow({
      _id: "w1",
      norm: "COMET",
      suggestion: { clue: "Icy visitor with a tail", familyFriendly: true, reason: "plain", model: "m", at: 1 },
    });
    expect(row.suggestion?.familyFriendly).toBe(true);
    expect(row.approval.status).toBe("pending");
    expect(row.familyFriendly).toBeNull();
  });

  it("a clue reads its approval, tag and edit trail", () => {
    const c = toBankClue({
      _id: "c1",
      clue: "Icy visitor",
      approval: { status: "pending", by: "rich", at: 9 },
      familyFriendly: true,
      original: "Icy visitor (5)",
      editedBy: "rich",
      editedAt: 9,
    });
    expect(c).toMatchObject({
      text: "Icy visitor",
      approval: { status: "pending", by: "rich", at: 9 },
      familyFriendly: true,
      original: "Icy visitor (5)",
      editedBy: "rich",
      editedAt: 9,
    });
    expect(toBankClue({ _id: "c2", clue: "x" })).toMatchObject({ approval: { status: "pending" }, familyFriendly: null });
  });
});

describe("the approval queue's filter and order (§7.4)", () => {
  it("serves pending words only", () => {
    for (const tier of ["preferred", "rest"] as const) {
      const f = bankQueueFilter({}, tier);
      expect(condOn(f, "approval.status")).toEqual([{ $nin: expect.arrayContaining(["approved", "rejected"]) }]);
    }
  });

  it("most common first", () => {
    const keys = Object.keys(BANK_QUEUE_SORT);
    expect(keys[0]).toBe("validation.sources.wordfreq.zipf");
    expect(BANK_QUEUE_SORT["validation.sources.wordfreq.zipf"]).toBe(-1);
  });

  it("the preferred tier and the rest split the 3–12 range with no overlap and no gap", () => {
    const lens = (f: Record<string, unknown>) => {
      const v = condOn(f, "length")[0] as { $gte?: number; $lte?: number; $in?: number[] };
      const out: number[] = [];
      for (let n = 1; n <= 20; n++) {
        const ok = v.$in ? v.$in.includes(n) : n >= (v.$gte ?? -Infinity) && n <= (v.$lte ?? Infinity);
        if (ok) out.push(n);
      }
      return out;
    };
    const pref = lens(bankQueueFilter({}, "preferred"));
    const rest = lens(bankQueueFilter({}, "rest"));
    expect(pref.length).toBeGreaterThan(0);
    expect(pref.filter((n) => rest.includes(n))).toEqual([]);
    expect([...pref, ...rest].sort((a, b) => a - b)).toEqual([3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });

  it("honours the length, starts-with and suggestions filters", () => {
    const f = bankQueueFilter({ minLength: 5, maxLength: 5, startsWith: "q", withSuggestions: true }, "preferred");
    expect(condOn(f, "length")).toEqual([{ $gte: 5, $lte: 5 }]);
    expect(condOn(f, "norm")).toEqual([{ $regex: "^Q" }]);
    expect(condOn(f, "suggestion")).toHaveLength(1);
  });

  it("honours the frequency band", () => {
    const f = bankQueueFilter({ band: "common" }, "preferred");
    expect(condOn(f, "validation.sources.wordfreq.zipf")).toEqual([expect.objectContaining({ $gte: 4, $lt: 5 })]);
  });
});

describe("the pool counter's arithmetic (§7.4)", () => {
  it("about 14 words a puzzle and 20 puzzles before a word may return", () => {
    expect(POOL_WORDS_PER_PUZZLE).toBe(14);
    expect(POOL_NO_REPEAT_PUZZLES).toBe(20);
  });

  it("puzzles without a repeat = whole puzzles the pool fills", () => {
    expect(poolCounts(0, 0)).toMatchObject({ words: 0, ffWords: 0, puzzlesWithoutRepeat: 0, ffPuzzlesWithoutRepeat: 0 });
    expect(poolCounts(13, 0).puzzlesWithoutRepeat).toBe(0);
    expect(poolCounts(14, 14)).toMatchObject({ puzzlesWithoutRepeat: 1, ffPuzzlesWithoutRepeat: 1 });
    expect(poolCounts(300, 150)).toMatchObject({ words: 300, ffWords: 150, puzzlesWithoutRepeat: 21, ffPuzzlesWithoutRepeat: 10 });
  });

  it("the first target is about 300 words (14 × 20)", () => {
    const t = poolCounts(0, 0).targetWords;
    expect(t).toBe(POOL_WORDS_PER_PUZZLE * POOL_NO_REPEAT_PUZZLES);
    expect(t).toBeGreaterThanOrEqual(250);
    expect(t).toBeLessThanOrEqual(320);
  });

  it("never goes negative or fractional", () => {
    expect(poolCounts(-5, 3.7)).toMatchObject({ words: 0, ffWords: 3, puzzlesWithoutRepeat: 0 });
  });
});
