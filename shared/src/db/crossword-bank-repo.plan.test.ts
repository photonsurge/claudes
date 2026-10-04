import mongoose, { type Connection } from "mongoose";
import { makeCrosswordBankRepo } from "./crossword-bank-repo";

/**
 * Written from docs/crossword-mode-plan.md §7.3 step 1, §7.4 and §12 (bank
 * repo, against a small fixture), not from the code. No Mongo server here, so
 * `conn.db.collection()` is a small in-memory fake that understands the query
 * operators a native-collection repo sends, and records every filter and
 * update so the exact documents can be asserted too.
 */

// ---------------------------------------------------------------------------
// In-memory fake of the native collections
// ---------------------------------------------------------------------------

type Doc = Record<string, any>;

const getPath = (doc: unknown, path: string): unknown => {
  let cur: any = doc;
  for (const k of path.split(".")) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = cur[k];
  }
  return cur;
};
const isOid = (v: unknown): v is mongoose.Types.ObjectId => v instanceof mongoose.Types.ObjectId;
const same = (a: unknown, b: unknown): boolean => {
  if (isOid(a) || isOid(b)) return String(a) === String(b);
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  if (a === undefined && b === null) return true;
  return a === b;
};
const anyOf = (v: unknown, f: (x: unknown) => boolean) => (Array.isArray(v) ? v.some(f) || f(v) : f(v));

function matchCond(v: unknown, cond: unknown): boolean {
  if (cond && typeof cond === "object" && !isOid(cond) && !(cond instanceof Date) && !Array.isArray(cond)) {
    const ops = Object.entries(cond as Doc);
    if (ops.length && ops.every(([k]) => k.startsWith("$"))) {
      return ops.every(([op, arg]) => {
        switch (op) {
          case "$in":
            return anyOf(v, (x) => (arg as unknown[]).some((a) => same(x, a)));
          case "$nin":
            return !anyOf(v, (x) => (arg as unknown[]).some((a) => same(x, a)));
          case "$ne":
            return !anyOf(v, (x) => same(x, arg));
          case "$gte":
            return typeof v === typeof arg && (v as number) >= (arg as number);
          case "$gt":
            return typeof v === typeof arg && (v as number) > (arg as number);
          case "$lte":
            return typeof v === typeof arg && (v as number) <= (arg as number);
          case "$lt":
            return typeof v === typeof arg && (v as number) < (arg as number);
          case "$exists":
            return (v !== undefined) === !!arg;
          case "$type":
            return arg === "number" ? typeof v === "number" : arg === "object" ? !!v && typeof v === "object" && !Array.isArray(v) : false;
          case "$regex":
            return typeof v === "string" && new RegExp(arg as string).test(v);
          default:
            throw new Error(`fake: unsupported operator ${op}`);
        }
      });
    }
  }
  return anyOf(v, (x) => same(x, cond));
}

function matches(doc: Doc, filter: Doc): boolean {
  return Object.entries(filter).every(([k, cond]) => {
    if (k === "$and") return (cond as Doc[]).every((f) => matches(doc, f));
    if (k === "$or") return (cond as Doc[]).some((f) => matches(doc, f));
    return matchCond(getPath(doc, k), cond);
  });
}

const cmp = (a: unknown, b: unknown) => {
  if (a === b) return 0;
  if (a === undefined || a === null) return -1;
  if (b === undefined || b === null) return 1;
  if (isOid(a) && isOid(b)) return String(a).localeCompare(String(b));
  return (a as number) < (b as number) ? -1 : 1;
};

function setPath(doc: Doc, path: string, value: unknown) {
  const ks = path.split(".");
  let cur = doc;
  for (const k of ks.slice(0, -1)) cur = cur[k] && typeof cur[k] === "object" ? cur[k] : (cur[k] = {});
  cur[ks[ks.length - 1]] = value;
}
function unsetPath(doc: Doc, path: string) {
  const ks = path.split(".");
  const parent = getPath(doc, ks.slice(0, -1).join(".")) ?? (ks.length === 1 ? doc : undefined);
  if (parent && typeof parent === "object") delete (parent as Doc)[ks[ks.length - 1]];
}

const clone = <T>(v: T): T =>
  Array.isArray(v)
    ? (v.map(clone) as T)
    : v && typeof v === "object" && !isOid(v) && !(v instanceof Date)
      ? (Object.fromEntries(Object.entries(v).map(([k, x]) => [k, clone(x)])) as T)
      : v;

class FakeCursor {
  constructor(private rows: Doc[]) {}
  sort(s: Record<string, 1 | -1>) {
    const keys = Object.entries(s);
    this.rows = [...this.rows].sort((a, b) => {
      for (const [k, d] of keys) {
        const c = cmp(getPath(a, k), getPath(b, k));
        if (c) return c * d;
      }
      return 0;
    });
    return this;
  }
  skip(n: number) {
    this.rows = this.rows.slice(n);
    return this;
  }
  limit(n: number) {
    if (n > 0) this.rows = this.rows.slice(0, n);
    return this;
  }
  async toArray() {
    return this.rows.map(clone);
  }
}

class FakeCollection {
  docs: Doc[] = [];
  finds: Doc[] = [];
  updates: { filter: Doc; update: Doc }[] = [];
  aggregates: Doc[][] = [];
  inserts: Doc[] = [];
  aggregateStub: ((pipeline: Doc[]) => Doc[]) | null = null;

  find(filter: Doc = {}) {
    this.finds.push(filter);
    return new FakeCursor(this.docs.filter((d) => matches(d, filter)));
  }
  async findOne(filter: Doc = {}) {
    this.finds.push(filter);
    const d = this.docs.find((x) => matches(x, filter));
    return d ? clone(d) : null;
  }
  async countDocuments(filter: Doc = {}) {
    return this.docs.filter((d) => matches(d, filter)).length;
  }
  async estimatedDocumentCount() {
    return this.docs.length;
  }
  async updateOne(filter: Doc, update: Doc) {
    this.updates.push({ filter, update: clone(update) });
    const d = this.docs.find((x) => matches(x, filter));
    if (!d) return { matchedCount: 0, modifiedCount: 0 };
    for (const [k, v] of Object.entries(update.$set ?? {})) setPath(d, k, clone(v));
    for (const k of Object.keys(update.$unset ?? {})) unsetPath(d, k);
    return { matchedCount: 1, modifiedCount: 1 };
  }
  async insertMany(docs: Doc[]) {
    for (const d of docs) {
      const doc = { _id: new mongoose.Types.ObjectId(), ...clone(d) };
      this.inserts.push(doc);
      this.docs.push(doc);
    }
    return { insertedCount: docs.length };
  }
  async createIndex(_key: Doc, opts: { name: string }) {
    return opts.name;
  }
  aggregate(pipeline: Doc[]) {
    this.aggregates.push(pipeline);
    if (this.aggregateStub) return new FakeCursor(this.aggregateStub(pipeline));
    // $match then $group { _id: "$path", n: { $sum: 1 } } — enough for clue counts.
    let rows = this.docs;
    for (const st of pipeline) {
      if (st.$match) rows = rows.filter((d) => matches(d, st.$match));
      else if (st.$group) {
        const key = String(st.$group._id).replace(/^\$/, "");
        const m = new Map<string, { _id: unknown; n: number }>();
        for (const d of rows) {
          const k = getPath(d, key);
          const e = m.get(String(k)) ?? { _id: k, n: 0 };
          e.n++;
          m.set(String(k), e);
        }
        rows = [...m.values()];
      } else throw new Error(`fake: unsupported stage ${Object.keys(st)[0]}`);
    }
    return new FakeCursor(rows);
  }
}

function fakeBank(now = 1_700_000_000_000) {
  const cols: Record<string, FakeCollection> = {
    crosswordbankwords: new FakeCollection(),
    crosswordbankclues: new FakeCollection(),
  };
  const conn = {
    db: {
      collection: (name: string) => {
        if (!cols[name]) throw new Error(`fake: unexpected collection ${name}`);
        return cols[name];
      },
    },
  } as unknown as Connection;
  const repo = makeCrosswordBankRepo(conn, { now: () => now });
  return { repo, words: cols.crosswordbankwords, clues: cols.crosswordbankclues, now };
}

const oid = () => new mongoose.Types.ObjectId();

/** A prototype word document, plus this app's approval and tag. */
function word(norm: string, o: { approval?: Doc | null; ff?: boolean | null; zipf?: number; length?: number; decision?: string; clueStatus?: string } = {}) {
  const d: Doc = {
    _id: oid(),
    word: norm.toLowerCase(),
    norm,
    length: o.length ?? norm.length,
    validation: { decision: o.decision ?? "accepted", sources: { wordfreq: { zipf: o.zipf ?? 4.5 } } },
    enrichment: { status: o.clueStatus ?? "done" },
    raw: { definitions: [`a definition of ${norm.toLowerCase()}`] },
  };
  if (o.approval !== null) d.approval = o.approval ?? { status: "approved", by: "rich", at: 1 };
  if (o.ff !== undefined && o.ff !== null) d.familyFriendly = o.ff;
  else if (o.ff === null) d.familyFriendly = null;
  return d;
}
function clue(w: Doc, text: string, o: { approval?: Doc | null; ff?: boolean | null } = {}) {
  const d: Doc = {
    _id: oid(),
    answerId: w._id,
    answerNorm: w.norm,
    answerLength: w.length,
    clue: text,
    source: { name: "llm", ref: "m", createdBy: "x" },
    createdAt: new Date(1),
  };
  if (o.approval !== null) d.approval = o.approval ?? { status: "approved", by: "rich", at: 1 };
  if (o.ff !== undefined) d.familyFriendly = o.ff;
  return d;
}

// ---------------------------------------------------------------------------
// The playable pick (§7.3 step 1, §7.4)
// ---------------------------------------------------------------------------

describe("playable pick", () => {
  /**
   * A fixture where each word fails exactly one rule, plus two that pass.
   */
  function fixture() {
    const f = fakeBank();
    const W: Record<string, Doc> = {
      GOOD: word("COMET", { ff: true }),
      CLEANWORD_UNTAGGEDCLUE: word("ORBIT", { ff: true }),
      UNTAGGEDWORD: word("PLANET", { ff: null }),
      NOTFF: word("EXCITED", { ff: false }),
      PENDINGWORD: word("NEBULA", { approval: null, ff: true }),
      REJECTEDWORD: word("GALAXY", { approval: { status: "rejected", by: "rich", at: 2 }, ff: true }),
      CLUEPENDING: word("METEOR", { ff: true }),
      CLUEREJECTED: word("QUASAR", { ff: true }),
      NOCLUE: word("PULSAR", { ff: true }),
      SHORT: word("OX", { ff: true }),
      LONG: word("SUPERCALIFRAG", { ff: true }),
      RARE: word("ZENITH", { ff: true, zipf: 2.1 }),
    };
    const C: Doc[] = [
      clue(W.GOOD, "Icy visitor with a glowing tail", { ff: true }),
      clue(W.GOOD, "Icy body with a tail, unvetted", { approval: null, ff: true }),
      clue(W.CLEANWORD_UNTAGGEDCLUE, "Path around a star"),
      clue(W.UNTAGGEDWORD, "World circling a star", { ff: true }),
      clue(W.NOTFF, "Aroused", { ff: false }),
      clue(W.PENDINGWORD, "Cloud of gas and dust", { ff: true }),
      clue(W.REJECTEDWORD, "Huge system of stars", { ff: true }),
      clue(W.CLUEPENDING, "Shooting star", { approval: { status: "pending" }, ff: true }),
      clue(W.CLUEREJECTED, "Bright galactic core", { approval: { status: "rejected", by: "rich", at: 3 }, ff: true }),
      clue(W.SHORT, "Yoked beast", { ff: true }),
      clue(W.LONG, "Too long a word for the grid", { ff: true }),
      clue(W.RARE, "Point directly overhead", { ff: true }),
    ];
    f.words.docs.push(...Object.values(W));
    f.clues.docs.push(...C);
    return { ...f, W, C };
  }

  it("a family-friendly channel gets only approved words with an approved clue, both tagged", async () => {
    const { repo } = fixture();
    const got = await repo.playable({ minZipf: 3.5, familyFriendlyOnly: true });
    expect(got.map((w) => w.norm).sort()).toEqual(["COMET"]);
    // Only the approved, tagged clue comes with it, never the pending one.
    expect(got[0].clues.map((c) => c.text)).toEqual(["Icy visitor with a glowing tail"]);
  });

  it("untagged counts as not family friendly, for the word and for the clue", async () => {
    const { repo } = fixture();
    const norms = (await repo.playable({ minZipf: 3.5, familyFriendlyOnly: true })).map((w) => w.norm);
    expect(norms).not.toContain("PLANET"); // untagged word, tagged clue
    expect(norms).not.toContain("ORBIT"); // tagged word, untagged clue
    expect(norms).not.toContain("EXCITED"); // tagged not family friendly
  });

  it("off a family-friendly channel the tag plays no part, approval still does", async () => {
    const { repo } = fixture();
    const got = await repo.playable({ minZipf: 3.5, familyFriendlyOnly: false });
    expect(got.map((w) => w.norm).sort()).toEqual(["COMET", "EXCITED", "ORBIT", "PLANET"]);
    for (const w of got) expect(w.clues.length).toBeGreaterThan(0);
  });

  it("a pending or rejected word, or one with no approved clue, is never playable", async () => {
    const { repo } = fixture();
    const norms = (await repo.playable({ minZipf: 0, familyFriendlyOnly: false })).map((w) => w.norm);
    for (const n of ["NEBULA", "GALAXY", "METEOR", "QUASAR", "PULSAR"]) expect(norms).not.toContain(n);
  });

  it("3–12 letters and at or above minZipf", async () => {
    const { repo } = fixture();
    const norms = (await repo.playable({ minZipf: 3.5, familyFriendlyOnly: false })).map((w) => w.norm);
    expect(norms).not.toContain("OX");
    expect(norms).not.toContain("SUPERCALIFRAG");
    expect(norms).not.toContain("ZENITH");
    const low = (await repo.playable({ minZipf: 2, familyFriendlyOnly: false })).map((w) => w.norm);
    expect(low).toContain("ZENITH");
  });

  it("leaves out the words of the channel's recent puzzles", async () => {
    const { repo } = fixture();
    const norms = (await repo.playable({ minZipf: 3.5, familyFriendlyOnly: false, excludeNorms: ["COMET"] })).map((w) => w.norm);
    expect(norms).not.toContain("COMET");
    expect(norms).toContain("ORBIT");
  });

  it("returns the ids a puzzle entry stores (wordId, clueId)", async () => {
    const { repo, W, C } = fixture();
    const [w] = await repo.playable({ minZipf: 3.5, familyFriendlyOnly: true });
    expect(w.id).toBe(String(W.GOOD._id));
    expect(w.clues[0].id).toBe(String(C[0]._id));
  });

  it("sends Mongo the approval and tag on both the word and the clue query", async () => {
    const { repo, words, clues } = fixture();
    await repo.playable({ minZipf: 3.5, familyFriendlyOnly: true });
    const wf = words.finds[0];
    expect(wf).toMatchObject({ "approval.status": "approved", familyFriendly: true });
    const cf = clues.finds[0];
    expect(cf).toMatchObject({ "approval.status": "approved", familyFriendly: true });
    expect(cf.answerId.$in.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Approval and family-friendly writes (§7.4: who and when)
// ---------------------------------------------------------------------------

describe("approval and family-friendly writes", () => {
  it("approving a word records the status, who and when", async () => {
    const f = fakeBank();
    const w = word("COMET", { approval: null });
    f.words.docs.push(w);
    expect(await f.repo.setWordApproval(String(w._id), "approved", "rich")).toBe(true);
    const { filter, update } = f.words.updates[0];
    expect(String(filter._id)).toBe(String(w._id));
    expect(update.$set.approval).toEqual({ status: "approved", by: "rich", at: f.now });
    expect(f.words.docs[0].approval).toEqual({ status: "approved", by: "rich", at: f.now });
  });

  it("rejecting a word records who and when; the tag is left alone", async () => {
    const f = fakeBank();
    const w = word("COMET", { ff: true });
    f.words.docs.push(w);
    await f.repo.setWordApproval(String(w._id), "rejected", "ana");
    expect(f.words.docs[0].approval).toEqual({ status: "rejected", by: "ana", at: f.now });
    expect(f.words.docs[0].familyFriendly).toBe(true);
    expect(Object.keys(f.words.updates[0].update.$set)).not.toContain("familyFriendly");
  });

  it("an unknown status or id is refused, with nothing written", async () => {
    const f = fakeBank();
    const w = word("COMET");
    f.words.docs.push(w);
    expect(await f.repo.setWordApproval(String(w._id), "maybe" as never, "rich")).toBe(false);
    expect(await f.repo.setWordApproval("not-an-id", "approved", "rich")).toBe(false);
    expect(f.words.updates).toEqual([]);
  });

  it("tagging a word family friendly records the value, who and when, without approving it", async () => {
    const f = fakeBank();
    const w = word("COMET", { approval: null });
    f.words.docs.push(w);
    expect(await f.repo.setWordFamilyFriendly(String(w._id), true, "rich")).toBe(true);
    const set = f.words.updates[0].update.$set;
    expect(set.familyFriendly).toBe(true);
    expect(set.familyFriendlyBy).toBe("rich");
    expect(set.familyFriendlyAt).toBe(f.now);
    expect(Object.keys(set)).not.toContain("approval");
    const row = await f.repo.getWordById(String(w._id));
    expect(row).toMatchObject({ familyFriendly: true, familyFriendlyBy: "rich", familyFriendlyAt: f.now, approval: { status: "pending" } });
  });

  it("a word's tag can go back to untagged", async () => {
    const f = fakeBank();
    const w = word("COMET", { ff: true });
    f.words.docs.push(w);
    await f.repo.setWordFamilyFriendly(String(w._id), null, "rich");
    expect((await f.repo.getWordById(String(w._id)))!.familyFriendly).toBeNull();
  });

  it("approving and tagging a clue records who and when on the clue", async () => {
    const f = fakeBank();
    const w = word("COMET");
    const c = clue(w, "Icy visitor", { approval: null });
    f.words.docs.push(w);
    f.clues.docs.push(c);
    expect(await f.repo.setClueApproval(String(c._id), "approved", "rich")).toBe(true);
    expect(await f.repo.setClueFamilyFriendly(String(c._id), false, "ana")).toBe(true);
    expect(f.clues.updates[0].update.$set.approval).toEqual({ status: "approved", by: "rich", at: f.now });
    expect(f.clues.updates[1].update.$set).toMatchObject({ familyFriendly: false, familyFriendlyBy: "ana", familyFriendlyAt: f.now });
    const detail = await f.repo.getWordById(String(w._id));
    expect(detail!.clues[0]).toMatchObject({
      approval: { status: "approved", by: "rich", at: f.now },
      familyFriendly: false,
      familyFriendlyBy: "ana",
      familyFriendlyAt: f.now,
    });
  });
});

describe("editing a clue (§7.4)", () => {
  it("an edited approved clue returns to pending, with who and when", async () => {
    const f = fakeBank();
    const w = word("COMET");
    const c = clue(w, "Icy visitor (5)", { approval: { status: "approved", by: "rich", at: 1 }, ff: true });
    f.words.docs.push(w);
    f.clues.docs.push(c);
    expect(await f.repo.editClue(String(c._id), "Icy visitor with a tail", "ana")).toBe(true);
    const upd = f.clues.updates[f.clues.updates.length - 1];
    expect(String(upd.filter._id)).toBe(String(c._id));
    expect(upd.update.$set).toMatchObject({
      clue: "Icy visitor with a tail",
      approval: { status: "pending", by: "ana", at: f.now },
      editedBy: "ana",
      editedAt: f.now,
    });
    const back = (await f.repo.getWordById(String(w._id)))!.clues[0];
    expect(back).toMatchObject({ text: "Icy visitor with a tail", approval: { status: "pending" }, original: "Icy visitor (5)" });
  });

  it("an edited clue is no longer playable until approved again", async () => {
    const f = fakeBank();
    const w = word("COMET", { ff: true });
    const c = clue(w, "Icy visitor (5)", { ff: true });
    f.words.docs.push(w);
    f.clues.docs.push(c);
    expect((await f.repo.playable({ minZipf: 0, familyFriendlyOnly: true })).map((x) => x.norm)).toEqual(["COMET"]);
    await f.repo.editClue(String(c._id), "Icy visitor with a tail", "ana");
    expect(await f.repo.playable({ minZipf: 0, familyFriendlyOnly: true })).toEqual([]);
  });

  it("editing a pending or rejected clue keeps its status", async () => {
    const f = fakeBank();
    const w = word("COMET");
    const p = clue(w, "Pending one", { approval: { status: "pending" } });
    const r = clue(w, "Rejected one", { approval: { status: "rejected", by: "rich", at: 1 } });
    f.words.docs.push(w);
    f.clues.docs.push(p, r);
    await f.repo.editClue(String(p._id), "Pending, edited", "ana");
    await f.repo.editClue(String(r._id), "Rejected, edited", "ana");
    expect(f.clues.docs.find((d) => d._id === p._id)!.approval.status).toBe("pending");
    expect(f.clues.docs.find((d) => d._id === r._id)!.approval).toEqual({ status: "rejected", by: "rich", at: 1 });
  });
});

describe("suggestions never change an approval (§7.4)", () => {
  it("storing or clearing a suggestion touches neither approval nor tag", async () => {
    const f = fakeBank();
    const w = word("EXCITED", { approval: { status: "pending" }, ff: null });
    f.words.docs.push(w);
    const s = { clue: "Thrilled", familyFriendly: true, reason: "an everyday sense", model: "m", at: 5 };
    expect(await f.repo.setWordSuggestion(String(w._id), s)).toBe(true);
    await f.repo.setWordSuggestion(String(w._id), null);
    for (const { update } of f.words.updates) {
      const touched = [...Object.keys(update.$set ?? {}), ...Object.keys(update.$unset ?? {})];
      for (const k of touched) expect(k).not.toMatch(/^(approval|familyFriendly)/);
    }
    expect(f.words.docs[0].approval).toEqual({ status: "pending" });
    expect(f.words.docs[0].familyFriendly).toBeNull();
  });

  it("a saved suggested clue arrives pending and untagged", async () => {
    const f = fakeBank();
    const w = word("COMET");
    f.words.docs.push(w);
    expect(await f.repo.addClues(String(w._id), ["Icy visitor with a tail"], { source: "suggest", model: "m" })).toBe(1);
    const c = f.clues.inserts[0];
    expect(c.approval?.status ?? "pending").toBe("pending");
    expect(c.familyFriendly ?? null).toBeNull();
    expect(String(c.answerId)).toBe(String(w._id));
  });
});

// ---------------------------------------------------------------------------
// The approval queue (§7.4)
// ---------------------------------------------------------------------------

describe("approval queue", () => {
  it("pending words only, most common first in the lengths the builder needs, then the rest", async () => {
    const f = fakeBank();
    const docs = [
      word("CAT", { approval: null, zipf: 6.5 }), // 3 letters: needed least
      word("HOUSE", { approval: null, zipf: 5.5 }),
      word("GARDEN", { approval: { status: "pending" }, zipf: 4.8 }),
      word("WINDOW", { approval: null, zipf: 5.9 }),
      word("TELEVISIONS", { approval: null, zipf: 4.0 }), // 11 letters
      word("APPROVED", { zipf: 6.9 }), // already approved
      word("REJECTED", { approval: { status: "rejected", by: "r", at: 1 }, zipf: 6.8 }),
      word("RAREWORD", { approval: null, zipf: 1.2 }),
    ];
    f.words.docs.push(...docs);
    for (const d of docs) f.clues.docs.push(clue(d, `A clue for ${d.norm.toLowerCase()} here`, { approval: null }));
    const q = await f.repo.approvalQueue({ limit: 50 });
    const order = q.map((w) => w.norm);
    expect(order).not.toContain("APPROVED");
    expect(order).not.toContain("REJECTED");
    // Lengths the builder needs most come first, each tier most common first.
    expect(order.slice(0, 4)).toEqual(["WINDOW", "HOUSE", "GARDEN", "RAREWORD"]);
    expect(order.slice(4)).toEqual(["CAT", "TELEVISIONS"]);
  });

  it("the limit takes from the front of that order", async () => {
    const f = fakeBank();
    f.words.docs.push(word("HOUSE", { approval: null, zipf: 5.5 }), word("WINDOW", { approval: null, zipf: 5.9 }), word("CAT", { approval: null, zipf: 6.5 }));
    expect((await f.repo.approvalQueue({ limit: 1 })).map((w) => w.norm)).toEqual(["WINDOW"]);
  });

  it("each queued word comes with its clues (rejected ones left out), cleaned, and its definitions", async () => {
    const f = fakeBank();
    const w = word("COMET", { approval: null });
    f.words.docs.push(w);
    f.clues.docs.push(
      clue(w, "Icy visitor with a glowing tail (5)", { approval: null }),
      clue(w, "Bad clue", { approval: { status: "rejected", by: "r", at: 1 } }),
    );
    const [q] = await f.repo.approvalQueue({ limit: 5 });
    expect(q.definitions).toEqual(["a definition of comet"]);
    expect(q.clues).toHaveLength(1);
    expect(q.clues[0].cleaned).not.toMatch(/\(5\)/);
  });

  it("filters: length, starts-with, only words with suggestions", async () => {
    const f = fakeBank();
    const a = word("HOUSE", { approval: null, zipf: 5.5 });
    const b = word("WINDOW", { approval: null, zipf: 5.9 });
    b.suggestion = { clue: "Pane in a wall", familyFriendly: true, reason: "plain", model: "m", at: 1 };
    f.words.docs.push(a, b);
    expect((await f.repo.approvalQueue({ limit: 10, startsWith: "h" })).map((w) => w.norm)).toEqual(["HOUSE"]);
    expect((await f.repo.approvalQueue({ limit: 10, minLength: 6, maxLength: 6 })).map((w) => w.norm)).toEqual(["WINDOW"]);
    expect((await f.repo.approvalQueue({ limit: 10, withSuggestions: true })).map((w) => w.norm)).toEqual(["WINDOW"]);
  });
});

// ---------------------------------------------------------------------------
// The pool counter (§7.4)
// ---------------------------------------------------------------------------

describe("pool counter", () => {
  it("turns the aggregated counts into puzzles without a repeat", async () => {
    const f = fakeBank();
    f.clues.aggregateStub = () => [{ _id: null, words: 300, ffWords: 140 }];
    const p = await f.repo.poolCounts();
    expect(p).toMatchObject({ words: 300, ffWords: 140, puzzlesWithoutRepeat: 21, ffPuzzlesWithoutRepeat: 10 });
  });

  it("starts from approved clues and keeps approved words only", async () => {
    const f = fakeBank();
    f.clues.aggregateStub = () => [];
    const p = await f.repo.poolCounts();
    expect(p).toMatchObject({ words: 0, ffWords: 0, puzzlesWithoutRepeat: 0 });
    const pipeline = f.clues.aggregates[0];
    const json = JSON.stringify(pipeline);
    expect(pipeline[0]).toEqual({ $match: { "approval.status": "approved" } });
    expect(json).toContain('"w.approval.status":"approved"');
  });
});

// ---------------------------------------------------------------------------
// The list and the detail (§8.3) — approval and tag on both
// ---------------------------------------------------------------------------

describe("list and detail", () => {
  it("lists by approval and by family-friendly tag (untagged = neither)", async () => {
    const f = fakeBank();
    f.words.docs.push(
      word("COMET", { ff: true }),
      word("ORBIT", { ff: false }),
      word("PLANET", { approval: null }),
      word("NEBULA", { approval: null, ff: null }),
    );
    const names = async (q: Parameters<typeof f.repo.listWords>[0]) => (await f.repo.listWords(q)).rows.map((r) => r.word).sort();
    expect(await names({ approval: "approved" })).toEqual(["comet", "orbit"]);
    expect(await names({ approval: "pending" })).toEqual(["nebula", "planet"]);
    expect(await names({ familyFriendly: "yes" })).toEqual(["comet"]);
    expect(await names({ familyFriendly: "no" })).toEqual(["orbit"]);
    expect(await names({ familyFriendly: "untagged" })).toEqual(["nebula", "planet"]);
  });

  it("the detail lookup returns approval and tag on the word and on every clue", async () => {
    const f = fakeBank();
    const w = word("COMET", { ff: true, approval: { status: "approved", by: "rich", at: 7 } });
    f.words.docs.push(w);
    f.clues.docs.push(clue(w, "Icy visitor", { ff: true }), clue(w, "Untagged one", { approval: null }));
    const d = await f.repo.getWordById(String(w._id));
    expect(d).toMatchObject({ word: "comet", approval: { status: "approved", by: "rich", at: 7 }, familyFriendly: true, clueCount: 2 });
    const byText = Object.fromEntries(d!.clues.map((c) => [c.text, c]));
    expect(byText["Icy visitor"]).toMatchObject({ approval: { status: "approved" }, familyFriendly: true });
    expect(byText["Untagged one"]).toMatchObject({ approval: { status: "pending" }, familyFriendly: null });
  });

  it("an unknown id is null", async () => {
    const f = fakeBank();
    expect(await f.repo.getWordById(String(oid()))).toBeNull();
    expect(await f.repo.getWordById("nope")).toBeNull();
  });
});
