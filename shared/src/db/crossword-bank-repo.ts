import mongoose, { type Connection } from "mongoose";
import type { Collection, Document, Filter } from "mongodb";
import {
  BANK_CLUE_FIELDS as C,
  BANK_CLUE_INDEXES,
  BANK_CLUES_COLLECTION,
  BANK_WORD_FIELDS as F,
  BANK_WORD_INDEXES,
  BANK_WORDS_COLLECTION,
  BANK_ZIPF_BANDS,
  bankPaging,
  bankPlayableFilter,
  bankWordFilter,
  bankWordSort,
  getPath,
  toBankClue,
  toBankSenses,
  toBankWordRow,
  type BankClue,
  type BankClueDecision,
  type BankDecision,
  type BankPlayableQuery,
  type BankSense,
  type BankTotals,
  type BankWordDetail,
  type BankWordQuery,
  type BankWordRow,
} from "../crossword-bank";

/** A playable word as the builder's candidate pick sees it. */
export interface BankPlayable {
  id: string;
  norm: string;
  length: number;
  zipf?: number;
}

/** What the puzzle builder needs to clue a word. */
export interface BankBuildWord {
  id: string;
  norm: string;
  senses: BankSense[];
  /** Usable clues (never the operator-rejected ones). */
  clues: BankClue[];
}

const TOTALS_TTL_MS = 60_000;

const toOid = (id: string) => {
  try {
    return new mongoose.Types.ObjectId(id);
  } catch {
    return null;
  }
};

/**
 * The imported word bank (`db.crosswordBank`): a thin repo over the two native
 * collections, because the documents keep the prototype's shape (ObjectId
 * keys, no `id`) and so do not fit the typed model pattern
 * (docs/crossword-mode-plan.md §7.2 step 4). Field paths come from
 * crossword-bank.ts; the collections may be absent on a box with no import, in
 * which case every read returns empty.
 */
export function makeCrosswordBankRepo(conn: Connection, opts: { now?: () => number } = {}) {
  const now = opts.now ?? Date.now;
  const words = (): Collection<Document> => {
    if (!conn.db) throw new Error("Mongo connection not ready");
    return conn.db.collection(BANK_WORDS_COLLECTION);
  };
  const clues = (): Collection<Document> => {
    if (!conn.db) throw new Error("Mongo connection not ready");
    return conn.db.collection(BANK_CLUES_COLLECTION);
  };
  let totalsCache: { at: number; value: BankTotals } | null = null;

  const countBy = async (path: string): Promise<Record<string, number>> => {
    const rows = await words()
      .aggregate([{ $group: { _id: `$${path}`, n: { $sum: 1 } } }], { allowDiskUse: true })
      .toArray();
    const out: Record<string, number> = {};
    for (const r of rows) out[r._id == null ? "none" : String(r._id)] = r.n;
    return out;
  };

  return {
    words,
    clues,

    /** The prototype's `listWords`: one page of the Words list plus the match count. */
    async listWords(q: BankWordQuery): Promise<{ rows: BankWordRow[]; total: number; page: number; pageSize: number }> {
      const filter = bankWordFilter(q) as Filter<Document>;
      const { skip, limit, page, pageSize } = bankPaging(q);
      const [docs, total] = await Promise.all([
        words().find(filter).sort(bankWordSort(q)).skip(skip).limit(limit).toArray(),
        words().countDocuments(filter),
      ]);
      return { rows: docs.map((d) => toBankWordRow(d)), total, page, pageSize };
    },

    /** Totals above the list: by clue status, decision and frequency band. Cached for a minute. */
    async totals(force = false): Promise<BankTotals> {
      if (!force && totalsCache && now() - totalsCache.at < TOTALS_TTL_MS) return totalsCache.value;
      const [byClueStatus, byDecision, bandRows, total] = await Promise.all([
        countBy(F.clueStatus),
        countBy(F.decision),
        words()
          .aggregate(
            [
              {
                $bucket: {
                  groupBy: `$${F.zipf}`,
                  boundaries: [-1000, 2, 3, 4, 5, 1000],
                  default: "none",
                  output: { n: { $sum: 1 } },
                },
              },
            ],
            { allowDiskUse: true },
          )
          .toArray(),
        words().estimatedDocumentCount(),
      ]);
      const byBand: Record<string, number> = {};
      const ids = BANK_ZIPF_BANDS.map((b) => b.id);
      for (const r of bandRows) {
        const i = [-1000, 2, 3, 4, 5].indexOf(r._id as number);
        byBand[i >= 0 ? ids[i] : "none"] = r.n;
      }
      const value = { byClueStatus, byDecision, byBand, total };
      totalsCache = { at: now(), value };
      return value;
    },

    /** The prototype's `getWordById`: the detail page, with every clue. */
    async getWordById(id: string): Promise<BankWordDetail | null> {
      const oid = toOid(id);
      if (!oid) return null;
      const doc = await words().findOne({ _id: oid });
      if (!doc) return null;
      const clueDocs = await clues().find({ [C.answerId]: oid }).toArray();
      return {
        ...toBankWordRow(doc),
        senses: toBankSenses(getPath(doc, F.senses)),
        clues: clueDocs.map((c) => toBankClue(c)),
        validationSources: getPath(doc, F.validationSources),
        raw: { attempts: getPath(doc, F.clueAttempts), validation: getPath(doc, F.validation) },
      };
    },

    /** Every playable word (norm, length, zipf only) — the builder samples from these. */
    async playable(q: BankPlayableQuery): Promise<BankPlayable[]> {
      const docs = await words()
        .find(bankPlayableFilter(q) as Filter<Document>, {
          projection: { _id: 1, [F.norm]: 1, [F.length]: 1, [F.zipf]: 1 },
        })
        .toArray();
      return docs.map((d) => {
        const norm = String(getPath(d, F.norm) ?? "");
        const z = getPath(d, F.zipf);
        return {
          id: String(d._id),
          norm,
          length: (getPath(d, F.length) as number) ?? norm.length,
          ...(typeof z === "number" ? { zipf: z } : {}),
        };
      });
    },

    /** Words by id with senses and usable clues, for clueing a built grid. */
    async forBuild(ids: string[]): Promise<BankBuildWord[]> {
      const oids = ids.map(toOid).filter((x): x is mongoose.Types.ObjectId => !!x);
      if (!oids.length) return [];
      const [docs, clueDocs] = await Promise.all([
        words().find({ _id: { $in: oids } }).toArray(),
        clues().find({ [C.answerId]: { $in: oids }, [C.status]: { $ne: "rejected" } }).toArray(),
      ]);
      const byWord = new Map<string, BankClue[]>();
      for (const c of clueDocs) {
        const k = String(getPath(c, C.answerId));
        byWord.set(k, [...(byWord.get(k) ?? []), toBankClue(c)]);
      }
      return docs.map((d) => ({
        id: String(d._id),
        norm: String(getPath(d, F.norm) ?? ""),
        senses: toBankSenses(getPath(d, F.senses)),
        clues: byWord.get(String(d._id)) ?? [],
      }));
    },

    /** Bank words matching these answers (themed puzzles: a word must be in the bank). */
    async findByNorms(norms: string[]): Promise<BankPlayable[]> {
      if (!norms.length) return [];
      const docs = await words()
        .find({ [F.norm]: { $in: norms } }, { projection: { _id: 1, [F.norm]: 1, [F.length]: 1, [F.zipf]: 1 } })
        .toArray();
      return docs.map((d) => ({
        id: String(d._id),
        norm: String(getPath(d, F.norm) ?? ""),
        length: (getPath(d, F.length) as number) ?? 0,
        zipf: getPath(d, F.zipf) as number | undefined,
      }));
    },

    /** Operator's word decision: writes the validation decision, marked as the operator's. */
    async setWordDecision(id: string, decision: BankDecision): Promise<boolean> {
      const oid = toOid(id);
      if (!oid) return false;
      const res = await words().updateOne(
        { _id: oid },
        { $set: { [F.decision]: decision, [F.decisionBy]: "operator", [F.decisionAt]: new Date(now()), [F.updatedAt]: new Date(now()) } },
      );
      totalsCache = null;
      return res.matchedCount > 0;
    },

    /** Operator's adult / vulgar / offensive flags (only the keys given). */
    async setWordFlags(id: string, flags: { adult?: boolean; vulgar?: boolean; offensive?: boolean }): Promise<boolean> {
      const oid = toOid(id);
      if (!oid) return false;
      const set: Record<string, unknown> = { [F.updatedAt]: new Date(now()) };
      if (typeof flags.adult === "boolean") set[F.flagAdult] = flags.adult;
      if (typeof flags.vulgar === "boolean") set[F.flagVulgar] = flags.vulgar;
      if (typeof flags.offensive === "boolean") set[F.flagOffensive] = flags.offensive;
      const res = await words().updateOne({ _id: oid }, { $set: set });
      return res.matchedCount > 0;
    },

    /** Approve or reject a clue (or put it back to candidate). */
    async setClueStatus(clueId: string, status: BankClueDecision): Promise<boolean> {
      const oid = toOid(clueId);
      if (!oid) return false;
      const res = await clues().updateOne({ _id: oid }, { $set: { [C.status]: status, [C.updatedAt]: new Date(now()) } });
      return res.matchedCount > 0;
    },

    /** Edit a clue's text, keeping the first original. */
    async editClue(clueId: string, text: string): Promise<boolean> {
      const oid = toOid(clueId);
      if (!oid) return false;
      const doc = await clues().findOne({ _id: oid });
      if (!doc) return false;
      const set: Record<string, unknown> = { [C.text]: text, [C.updatedAt]: new Date(now()) };
      if (getPath(doc, C.original) === undefined) set[C.original] = getPath(doc, C.text);
      await clues().updateOne({ _id: oid }, { $set: set });
      return true;
    },

    /**
     * Save clues for a word as new candidates (a polished clue saved back, or
     * the operator's Write clues). Skips texts the word already has. Returns
     * the number added.
     */
    async addClues(wordId: string, texts: string[], meta: { source: string; model?: string }): Promise<number> {
      const oid = toOid(wordId);
      if (!oid || !texts.length) return 0;
      const word = await words().findOne({ _id: oid }, { projection: { [F.norm]: 1 } });
      if (!word) return 0;
      const existing = new Set(
        (await clues().find({ [C.answerId]: oid }, { projection: { [C.text]: 1 } }).toArray()).map((c) =>
          String(getPath(c, C.text) ?? "").toLowerCase(),
        ),
      );
      const fresh = [...new Set(texts.map((t) => t.trim()).filter(Boolean))].filter((t) => !existing.has(t.toLowerCase()));
      if (!fresh.length) return 0;
      const at = new Date(now());
      await clues().insertMany(
        fresh.map((t) => ({
          [C.answerId]: oid,
          answer: getPath(word, F.norm),
          [C.text]: t,
          [C.source]: meta.source,
          ...(meta.model ? { [C.model]: meta.model } : {}),
          [C.status]: "candidate",
          [C.updatedAt]: at,
        })),
      );
      await words().updateOne({ _id: oid }, { $inc: { [F.clueCount]: fresh.length }, $set: { [F.updatedAt]: at } });
      return fresh.length;
    },

    /** Build the bank's indexes (idempotent: createIndex is a no-op for an existing spec). */
    async ensureIndexes(): Promise<string[]> {
      const made: string[] = [];
      for (const ix of BANK_WORD_INDEXES) made.push(await words().createIndex(ix.key, { name: ix.name }));
      for (const ix of BANK_CLUE_INDEXES) made.push(await clues().createIndex(ix.key, { name: ix.name }));
      return made;
    },
  };
}

export type CrosswordBankRepo = ReturnType<typeof makeCrosswordBankRepo>;
