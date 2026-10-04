import {
  BANK_CLUE_FIELDS as C,
  BANK_WORD_FIELDS as F,
  BANK_WORD_INDEXES,
  bankPaging,
  bankPlayableClueFilter,
  bankPlayableFilter,
  bankQueueFilter,
  poolCounts,
  bankWordFilter,
  bankWordSort,
  toBankClue,
  toBankSenses,
  toBankWordRow,
  zipfBand,
} from "./crossword-bank";

describe("bankWordFilter", () => {
  it("is empty with no filters", () => expect(bankWordFilter({})).toEqual({}));

  it("builds each filter", () => {
    expect(bankWordFilter({ startsWith: "c" })).toEqual({ [F.norm]: { $regex: "^C" } });
    expect(bankWordFilter({ search: "rat!" })).toEqual({ [F.norm]: { $regex: "RAT" } });
    expect(bankWordFilter({ clueStatus: "failed" })).toEqual({ [F.clueStatus]: "failed" });
    expect(bankWordFilter({ acceptedOnly: true })).toEqual({ [F.decision]: "accepted" });
    expect(bankWordFilter({ reviewOnly: true })).toEqual({ [F.decision]: "review" });
    expect(bankWordFilter({ band: "known" })).toEqual({ [F.zipf]: { $gte: 3, $lt: 4 } });
    expect(bankWordFilter({ band: "rare" })).toEqual({ [F.zipf]: { $lt: 2 } });
    expect(bankWordFilter({ band: "everyday" })).toEqual({ [F.zipf]: { $gte: 5 } });
    expect(bankWordFilter({ band: "none" })).toEqual({ [F.zipf]: { $exists: false } });
    expect(bankWordFilter({ approval: "approved" })).toEqual({ "approval.status": "approved" });
    expect(bankWordFilter({ approval: "rejected" })).toEqual({ "approval.status": "rejected" });
    // Missing approval counts as pending.
    expect(bankWordFilter({ approval: "pending" })).toEqual({ "approval.status": { $nin: ["approved", "rejected"] } });
    expect(bankWordFilter({ familyFriendly: "yes" })).toEqual({ familyFriendly: true });
    expect(bankWordFilter({ familyFriendly: "no" })).toEqual({ familyFriendly: false });
    expect(bankWordFilter({ familyFriendly: "untagged" })).toEqual({ familyFriendly: { $nin: [true, false] } });
  });

  it("ands several filters", () => {
    const f = bankWordFilter({ startsWith: "a", acceptedOnly: true }) as { $and: unknown[] };
    expect(f.$and).toHaveLength(2);
  });
});

describe("sort and paging", () => {
  it("sorts by the chosen key with sensible default directions", () => {
    expect(bankWordSort({})).toEqual({ [F.updatedAt]: -1, _id: -1 });
    expect(bankWordSort({ sort: "word" })).toEqual({ [F.norm]: 1, _id: 1 });
    expect(bankWordSort({ sort: "length", dir: "desc" })).toEqual({ [F.length]: -1, _id: -1 });
    expect(bankWordSort({ sort: "zipf" })).toEqual({ [F.zipf]: -1, _id: -1 });
  });

  it("clamps paging", () => {
    expect(bankPaging({})).toEqual({ skip: 0, limit: 50, page: 1, pageSize: 50 });
    expect(bankPaging({ page: 3, pageSize: 100 })).toEqual({ skip: 200, limit: 100, page: 3, pageSize: 100 });
    expect(bankPaging({ page: -2, pageSize: 7 })).toMatchObject({ page: 1, pageSize: 50 });
  });
});

describe("bankPlayableFilter", () => {
  it("requires approved, 3–12 letters, common enough, not excluded", () => {
    const f = bankPlayableFilter({ minZipf: 3.5, excludeNorms: ["CRATER"] });
    expect(f).toEqual({
      "approval.status": "approved",
      [F.length]: { $gte: 3, $lte: 12 },
      [F.zipf]: { $gte: 3.5 },
      [F.norm]: { $nin: ["CRATER"] },
    });
  });

  it("asks for the family-friendly tag on a family-friendly channel", () => {
    expect(bankPlayableFilter({ minZipf: 3, familyFriendlyOnly: true })[F.familyFriendly]).toBe(true);
    const c = bankPlayableClueFilter(["a"], { familyFriendlyOnly: true });
    expect(c).toEqual({ [C.answerId]: { $in: ["a"] }, "approval.status": "approved", familyFriendly: true });
    expect(bankPlayableClueFilter(["a"], {})).toEqual({ [C.answerId]: { $in: ["a"] }, "approval.status": "approved" });
  });

  it("with allowUnapproved uses the pipeline filter, pending words included", () => {
    const f = bankPlayableFilter({ minZipf: 3.5, allowUnapproved: true, familyFriendlyOnly: true });
    expect(f[F.decision]).toBe("accepted");
    expect(f[F.clueStatus]).toBe("done");
    expect(f["approval.status"]).toEqual({ $ne: "rejected" });
    expect(f[F.flagAdult]).toEqual({ $ne: true });
    expect((f[F.pos] as { $nin: string[] }).$nin).toContain("proper-noun");
    expect(f[F.familyFriendly]).toBeUndefined();
    expect(bankPlayableClueFilter(["a"], { allowUnapproved: true })).toEqual({
      [C.answerId]: { $in: ["a"] },
      "approval.status": { $ne: "rejected" },
    });
  });

  it("keeps the length range inside 3–12", () => {
    expect(bankPlayableFilter({ minZipf: 0, minLength: 1, maxLength: 20 })[F.length]).toEqual({ $gte: 3, $lte: 12 });
  });

  it("indexes the pick by approval, family friendly, length and frequency", () => {
    const pick = BANK_WORD_INDEXES.find((i) => i.name === "xwbank_approved_pick_ix")!;
    expect(Object.entries(pick.key)).toEqual([
      ["approval.status", 1],
      ["familyFriendly", 1],
      [F.length, 1],
      [F.zipf, -1],
    ]);
  });
});

describe("approval queue order", () => {
  const lengths = (f: Record<string, unknown>) =>
    ((f as { $and: Record<string, unknown>[] }).$and.find((c) => F.length in c) as Record<string, unknown>)[F.length];

  it("serves pending, accepted, clued words, 4–9 letters first, then the rest", () => {
    const pref = bankQueueFilter({}, "preferred") as { $and: Record<string, unknown>[] };
    expect(pref.$and).toEqual(
      expect.arrayContaining([
        { "approval.status": { $nin: ["approved", "rejected"] } },
        { [F.decision]: "accepted" },
        { [F.clueStatus]: "done" },
        { [F.zipf]: { $type: "number" } },
      ]),
    );
    expect(lengths(pref)).toEqual({ $gte: 4, $lte: 9 });
    expect(lengths(bankQueueFilter({}, "rest"))).toEqual({ $in: [3, 10, 11, 12] });
  });

  it("applies the filters", () => {
    expect(lengths(bankQueueFilter({ minLength: 6, maxLength: 11 }, "preferred"))).toEqual({ $gte: 6, $lte: 9 });
    expect(lengths(bankQueueFilter({ minLength: 6, maxLength: 11 }, "rest"))).toEqual({ $in: [10, 11] });
    const f = bankQueueFilter({ band: "common", startsWith: "b", withSuggestions: true }, "preferred") as { $and: unknown[] };
    expect(f.$and).toEqual(
      expect.arrayContaining([
        { [F.zipf]: { $type: "number", $gte: 4, $lt: 5 } },
        { [F.norm]: { $regex: "^B" } },
        { suggestion: { $type: "object" } },
      ]),
    );
  });
});

describe("poolCounts", () => {
  it("about 14 words a puzzle, 280 words fill the 20-puzzle window", () => {
    expect(poolCounts(300, 100)).toEqual({
      words: 300,
      ffWords: 100,
      puzzlesWithoutRepeat: 21,
      ffPuzzlesWithoutRepeat: 7,
      targetWords: 280,
    });
    expect(poolCounts(13, 0).puzzlesWithoutRepeat).toBe(0);
  });
});

describe("document mapping", () => {
  // The shape the prototype's pipeline writes (injest.py, validate_words.py,
  // enritch_words_vllm.py), with an operator decision on top.
  const doc = {
    _id: { toString: () => "65f0aa" },
    word: "CRATER",
    norm: "CRATER",
    length: 6,
    pos: ["noun"],
    categorySlugs: ["geology"],
    flags: { adult: false, vulgar: true, offensive: false },
    raw: { importWord: "crater", definitions: ["A bowl-shaped depression"] },
    enrichment: { status: "done", model: "some-7b", reason: "ok" },
    validation: { decision: "accepted", by: "operator", sources: { wordfreq: { checked: true, zipf: 3.9, rankBand: "mid" } } },
    approval: { status: "approved", by: "rich", at: 1700 },
    familyFriendly: true,
    familyFriendlyBy: "rich",
    familyFriendlyAt: 1701,
    suggestion: { clue: "Bowl-shaped hollow", familyFriendly: true, reason: "plain", model: "m", at: 9 },
    updatedAt: new Date("2026-02-01T00:00:00Z"),
    senses: [{ pos: "noun", definition: "A bowl-shaped depression", register: null, domains: [] }, { glosses: ["A pit"] }],
  };

  it("maps a word row", () => {
    expect(toBankWordRow(doc, 5)).toEqual({
      id: "65f0aa",
      word: "CRATER",
      length: 6,
      clueStatus: "done",
      pos: ["noun"],
      categories: ["geology"],
      flags: { adult: undefined, vulgar: true, offensive: undefined },
      warnings: ["vulgar"],
      model: "some-7b",
      decision: "accepted",
      decisionBy: "operator",
      zipf: 3.9,
      clueCount: 5,
      reason: "ok",
      updatedAt: "2026-02-01T00:00:00.000Z",
      approval: { status: "approved", by: "rich", at: 1700 },
      familyFriendly: true,
      familyFriendlyBy: "rich",
      familyFriendlyAt: 1701,
      suggestion: { clue: "Bowl-shaped hollow", familyFriendly: true, reason: "plain", model: "m", at: 9 },
    });
  });

  it("reads a missing approval as pending and a missing tag as untagged", () => {
    const row = toBankWordRow({ _id: "w", norm: "ORBIT" });
    expect(row.approval).toEqual({ status: "pending" });
    expect(row.familyFriendly).toBeNull();
    expect(row.warnings).toEqual([]);
    expect(row.suggestion).toBeUndefined();
  });

  it("maps senses and clues", () => {
    expect(toBankSenses(doc.senses)).toEqual([
      { pos: "noun", definitions: ["A bowl-shaped depression"] },
      { pos: undefined, definitions: ["A pit"] },
    ]);
    expect(
      toBankClue({ _id: "c1", clue: "Bowl (6)", difficulty: 3, source: { name: "llm", ref: "some-7b", createdBy: "enrich_words_vllm.py" } }),
    ).toMatchObject({
      id: "c1",
      text: "Bowl (6)",
      approval: { status: "pending" },
      familyFriendly: null,
      source: "llm",
      model: "some-7b",
    });
    expect(
      toBankClue({ _id: "c1", clue: "x", approval: { status: "approved", by: "rich", at: 5 }, familyFriendly: false, original: "y", editedBy: "rich", editedAt: 4 }),
    ).toMatchObject({ approval: { status: "approved", by: "rich", at: 5 }, familyFriendly: false, original: "y", editedBy: "rich", editedAt: 4 });
  });

  it("bands zipf scores", () => {
    expect(zipfBand(undefined)).toBe("none");
    expect(zipfBand(1.2)).toBe("rare");
    expect(zipfBand(3)).toBe("known");
    expect(zipfBand(6.1)).toBe("everyday");
  });
});
