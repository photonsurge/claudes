import {
  BANK_WORD_FIELDS as F,
  bankPaging,
  bankPlayableFilter,
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
  it("requires accepted, clued, unflagged, common, non-proper words", () => {
    const f = bankPlayableFilter({ minZipf: 3.5, excludeNorms: ["CRATER"] });
    expect(f[F.decision]).toBe("accepted");
    expect(f[F.clueStatus]).toBe("done");
    expect(f[F.length]).toEqual({ $gte: 3, $lte: 12 });
    expect(f[F.zipf]).toEqual({ $gte: 3.5 });
    expect(f[F.flagAdult]).toEqual({ $ne: true });
    expect((f[F.pos] as { $nin: string[] }).$nin).toContain("proper-noun");
    expect(f[F.norm]).toEqual({ $nin: ["CRATER"] });
  });

  it("keeps the length range inside 3–12", () => {
    expect(bankPlayableFilter({ minZipf: 0, minLength: 1, maxLength: 20 })[F.length]).toEqual({ $gte: 3, $lte: 12 });
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
      model: "some-7b",
      decision: "accepted",
      decisionBy: "operator",
      zipf: 3.9,
      clueCount: 5,
      reason: "ok",
      updatedAt: "2026-02-01T00:00:00.000Z",
    });
  });

  it("maps senses and clues", () => {
    expect(toBankSenses(doc.senses)).toEqual([
      { pos: "noun", definitions: ["A bowl-shaped depression"] },
      { pos: undefined, definitions: ["A pit"] },
    ]);
    expect(
      toBankClue({ _id: "c1", clue: "Bowl (6)", difficulty: 3, source: { name: "llm", ref: "some-7b", createdBy: "enrich_words_vllm.py" } }),
    ).toMatchObject({ id: "c1", text: "Bowl (6)", status: "candidate", source: "llm", model: "some-7b" });
    expect(toBankClue({ _id: "c1", clue: "x", status: "approved" }).status).toBe("approved");
  });

  it("bands zipf scores", () => {
    expect(zipfBand(undefined)).toBe("none");
    expect(zipfBand(1.2)).toBe("rare");
    expect(zipfBand(3)).toBe("known");
    expect(zipfBand(6.1)).toBe("everyday");
  });
});
