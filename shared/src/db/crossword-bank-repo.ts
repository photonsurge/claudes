import mongoose, { type Connection } from "mongoose";
import type { Collection, Document, Filter } from "mongodb";
import {
  BANK_CLUE_FIELDS as C,
  BANK_COUNT_CAP,
  BANK_CLUE_INDEXES,
  BANK_CLUES_COLLECTION,
  BANK_QUEUE_SORT,
  BANK_WORD_FIELDS as F,
  BANK_WORD_INDEXES,
  BANK_WORDS_COLLECTION,
  BANK_ZIPF_BANDS,
  QUEUE_LIMIT_MAX,
  bankPaging,
  bankPlayableClueFilter,
  bankPlayableFilter,
  bankQueueFilter,
  bankWordFilter,
  bankWordSort,
  asStrings,
  getPath,
  poolCounts,
  toBankApproval,
  toBankClue,
  toBankSenses,
  toBankWordRow,
  toFamilyFriendly,
  type BankApprovalStatus,
  type BankClue,
  type BankIndexSpec,
  type BankPlayableQuery,
  type BankPoolCounts,
  type BankQueueQuery,
  type BankQueueWord,
  type BankSense,
  type BankSuggestion,
  type BankTotals,
  type BankWordDetail,
  type BankWordQuery,
  type BankWordRow,
} from "../crossword-bank";
import { cleanClue, validateClue } from "../crossword";

/** A word reference: id, answer, length and frequency. */
export interface BankWordRef {
  id: string;
  norm: string;
  length: number;
  zipf?: number;
}

/** A word's or clue's current decisions (`decisionsFor`). */
export interface BankDecision {
  status: BankApprovalStatus;
  familyFriendly: boolean | null;
}

/** One clue with its word's answer (the clue route checks a clue with it before approving). */
export interface BankClueWithAnswer extends BankClue {
  wordId: string;
  /** The word's uppercase A–Z answer. */
  answer: string;
}

/** A clue a playable word may use, with its ids for the puzzle entry. */
export interface BankPlayableClue {
  id: string;
  text: string;
  familyFriendly: boolean | null;
}

/**
 * A playable word as the builder's candidate pick sees it (§7.3 step 1): an
 * approved word with its approved clues (never empty).
 */
export interface BankPlayable extends BankWordRef {
  familyFriendly: boolean | null;
  clues: BankPlayableClue[];
}

const TOTALS_TTL_MS = 60_000;
/** Words per clue lookup in the playable pick. */
const PLAYABLE_CHUNK = 5_000;
/** Longest stored clue text (the on-air cap, CLUE_MAX, is checked by validateClue). */
const CLUE_TEXT_MAX = 200;

const isStatus = (v: unknown): v is BankApprovalStatus => v === "pending" || v === "approved" || v === "rejected";
/** Who decided, as stored. */
const who = (by: string) => String(by ?? "").trim().slice(0, 200) || "operator";

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

  /** Clue counts per word id for a page of words (the count is not stored on the word). */
  const clueCounts = async (ids: unknown[]): Promise<Map<string, number>> => {
    if (!ids.length) return new Map();
    const rows = await clues()
      .aggregate([{ $match: { [C.answerId]: { $in: ids } } }, { $group: { _id: `$${C.answerId}`, n: { $sum: 1 } } }])
      .toArray();
    return new Map(rows.map((r) => [String(r._id), r.n as number]));
  };

  return {
    words,
    clues,

    /**
     * The prototype's `listWords`: one page of the Words list plus the match
     * count. With no filter the count is the collection's estimate (instant);
     * with one it stops at BANK_COUNT_CAP and says so (`totalCapped`).
     */
    async listWords(
      q: BankWordQuery,
    ): Promise<{ rows: BankWordRow[]; total: number; totalCapped: boolean; page: number; pageSize: number }> {
      const filter = bankWordFilter(q) as Filter<Document>;
      const { skip, limit, page, pageSize } = bankPaging(q);
      const unfiltered = Object.keys(filter).length === 0;
      const [docs, counted] = await Promise.all([
        words().find(filter).sort(bankWordSort(q)).skip(skip).limit(limit).toArray(),
        unfiltered ? words().estimatedDocumentCount() : words().countDocuments(filter, { limit: BANK_COUNT_CAP + 1 }),
      ]);
      const totalCapped = !unfiltered && counted > BANK_COUNT_CAP;
      const total = totalCapped ? BANK_COUNT_CAP : counted;
      const counts = await clueCounts(docs.map((d) => d._id));
      return { rows: docs.map((d) => toBankWordRow(d, counts.get(String(d._id)) ?? 0)), total, totalCapped, page, pageSize };
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
      const clueDocs = await clues().find({ [C.answerId]: oid }).sort({ [C.createdAt]: -1 }).toArray();
      return {
        ...toBankWordRow(doc, clueDocs.length),
        senses: toBankSenses(getPath(doc, F.senses)),
        definitions: asStrings(getPath(doc, F.rawDefinitions)),
        clues: clueDocs.map((c) => toBankClue(c)),
        validationSources: getPath(doc, F.validationSources),
        raw: { attempts: getPath(doc, F.clueAttempts), validation: getPath(doc, F.validation) },
      };
    },

    /** One clue by id with its word's answer, or null. */
    async getClue(id: string): Promise<BankClueWithAnswer | null> {
      const oid = toOid(id);
      if (!oid) return null;
      const doc = await clues().findOne({ _id: oid });
      if (!doc) return null;
      const wordId = getPath(doc, C.answerId);
      const word = wordId ? await words().findOne({ _id: wordId }, { projection: { [F.norm]: 1, [F.word]: 1 } }) : null;
      const raw = String(getPath(word, F.norm) ?? getPath(word, F.word) ?? getPath(doc, C.answerNorm) ?? "");
      return { ...toBankClue(doc), wordId: wordId == null ? "" : String(wordId), answer: raw.toUpperCase().replace(/[^A-Z]/g, "") };
    },

    /**
     * The playable pick (§7.3 step 1): every word the builder may sample, each
     * with the clues it may use. Approved words with at least one approved
     * clue, 3–12 letters, at or above `minZipf`, not excluded; on a
     * family-friendly channel the word and the clue both tagged true
     * (untagged counts as not). With `allowUnapproved` (dev only): pending
     * pipeline-accepted words with their stored clues. Every clue comes back
     * through `cleanClue`, as the queue showed it.
     */
    async playable(q: BankPlayableQuery): Promise<BankPlayable[]> {
      const docs = await words()
        .find(bankPlayableFilter(q) as Filter<Document>, {
          projection: { _id: 1, [F.norm]: 1, [F.length]: 1, [F.zipf]: 1, [F.familyFriendly]: 1 },
        })
        .toArray();
      const byWord = new Map<string, BankPlayableClue[]>();
      for (let i = 0; i < docs.length; i += PLAYABLE_CHUNK) {
        const ids = docs.slice(i, i + PLAYABLE_CHUNK).map((d) => d._id);
        const clueDocs = await clues()
          .find(bankPlayableClueFilter(ids, q) as Filter<Document>, {
            projection: { _id: 1, [C.answerId]: 1, [C.text]: 1, [C.familyFriendly]: 1 },
          })
          .toArray();
        for (const c of clueDocs) {
          const raw = String(getPath(c, C.text) ?? "");
          // Cleaned on every path: the queue showed the operator the cleaned text.
          const text = cleanClue(raw);
          if (!text) continue;
          const k = String(getPath(c, C.answerId));
          const list = byWord.get(k) ?? [];
          list.push({ id: String(c._id), text, familyFriendly: toFamilyFriendly(getPath(c, C.familyFriendly)) });
          byWord.set(k, list);
        }
      }
      const out: BankPlayable[] = [];
      for (const d of docs) {
        const list = byWord.get(String(d._id));
        if (!list?.length) continue;
        const norm = String(getPath(d, F.norm) ?? "");
        const z = getPath(d, F.zipf);
        out.push({
          id: String(d._id),
          norm,
          length: (getPath(d, F.length) as number) ?? norm.length,
          ...(typeof z === "number" ? { zipf: z } : {}),
          familyFriendly: toFamilyFriendly(getPath(d, F.familyFriendly)),
          clues: list.sort((a, b) => a.id.localeCompare(b.id)),
        });
      }
      return out;
    },

    /** Bank words matching these answers (themed puzzles, later: a word must be in the bank). */
    async findByNorms(norms: string[]): Promise<BankWordRef[]> {
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

    /**
     * The approval queue (§7.4): pending words, the lengths the builder needs
     * first, most common first — the order is documented on
     * `bankQueueFilter`. Each with its definitions, flags as warnings, every
     * clue not rejected (as stored, after `cleanClue`, and `validateClue`'s
     * verdict) and any stored suggestion.
     */
    async approvalQueue(q: BankQueueQuery): Promise<BankQueueWord[]> {
      const limit = Math.max(1, Math.min(QUEUE_LIMIT_MAX, Math.floor(q.limit) || 1));
      const skip = (q.excludeIds ?? []).map(toOid).filter((x): x is mongoose.Types.ObjectId => !!x);
      const tier = async (t: "preferred" | "rest", n: number) => {
        const f = bankQueueFilter(q, t) as { $and: Record<string, unknown>[] };
        if (skip.length) f.$and.push({ _id: { $nin: skip } });
        return words().find(f as Filter<Document>).sort(BANK_QUEUE_SORT).limit(n).toArray();
      };
      const docs = await tier("preferred", limit);
      if (docs.length < limit) docs.push(...(await tier("rest", limit - docs.length)));
      if (!docs.length) return [];
      const clueDocs = await clues()
        .find({ [C.answerId]: { $in: docs.map((d) => d._id) }, [C.approvalStatus]: { $ne: "rejected" } })
        .sort({ [C.createdAt]: 1, _id: 1 })
        .toArray();
      const byWord = new Map<string, BankClue[]>();
      for (const c of clueDocs) {
        const k = String(getPath(c, C.answerId));
        byWord.set(k, [...(byWord.get(k) ?? []), toBankClue(c)]);
      }
      return docs.map((d) => {
        const list = byWord.get(String(d._id)) ?? [];
        const row = toBankWordRow(d, list.length);
        const norm = String(getPath(d, F.norm) ?? row.word).toUpperCase().replace(/[^A-Z]/g, "");
        return {
          ...row,
          norm,
          senses: toBankSenses(getPath(d, F.senses)),
          definitions: asStrings(getPath(d, F.rawDefinitions)),
          clues: list.map((c) => {
            const cleaned = cleanClue(c.text);
            return { ...c, cleaned, problem: validateClue(cleaned, norm) };
          }),
        };
      });
    },

    /**
     * The approved-pool counter (§7.4): approved words of 3–12 letters with at
     * least one approved clue, the family-friendly ones (word and an approved
     * clue both tagged), and the puzzles that supports (`poolCounts`). Starts
     * from the approved clues, which the clue approval index finds.
     */
    async poolCounts(): Promise<BankPoolCounts> {
      const rows = await clues()
        .aggregate(
          [
            { $match: { [C.approvalStatus]: "approved" } },
            {
              $group: {
                _id: `$${C.answerId}`,
                ff: { $max: { $cond: [{ $eq: [`$${C.familyFriendly}`, true] }, 1, 0] } },
              },
            },
            { $lookup: { from: BANK_WORDS_COLLECTION, localField: "_id", foreignField: "_id", as: "w" } },
            { $unwind: "$w" },
            { $match: { [`w.${F.approvalStatus}`]: "approved", [`w.${F.length}`]: { $gte: 3, $lte: 12 } } },
            {
              $group: {
                _id: null,
                words: { $sum: 1 },
                ffWords: {
                  $sum: { $cond: [{ $and: [{ $eq: ["$ff", 1] }, { $eq: [`$w.${F.familyFriendly}`, true] }] }, 1, 0] },
                },
              },
            },
          ],
          { allowDiskUse: true },
        )
        .toArray();
      return poolCounts(rows[0]?.words ?? 0, rows[0]?.ffWords ?? 0);
    },

    /**
     * The current approval and family-friendly tag of these words and clues,
     * by id (word and clue ids are both ObjectIds, so one record holds both).
     * An id that is in neither collection is left out. The builder re-reads
     * its puzzle's words and clues with it after storing (§7.4), so a
     * decision taken during the build still reaches the puzzle.
     */
    async decisionsFor(ids: string[]): Promise<Record<string, BankDecision>> {
      // Bank ids are ObjectIds; a key that is not one is matched as stored.
      const oids = [...new Set(ids.filter(Boolean))].map((id) => (/^[0-9a-f]{24}$/i.test(id) ? toOid(id)! : id));
      if (!oids.length) return {};
      const [w, c] = await Promise.all([
        words().find({ _id: { $in: oids as unknown[] } } as Filter<Document>, { projection: { _id: 1, [F.approval]: 1, [F.familyFriendly]: 1 } }).toArray(),
        clues().find({ _id: { $in: oids as unknown[] } } as Filter<Document>, { projection: { _id: 1, [C.approval]: 1, [C.familyFriendly]: 1 } }).toArray(),
      ]);
      const out: Record<string, BankDecision> = {};
      for (const d of w) {
        out[String(d._id)] = {
          status: toBankApproval(getPath(d, F.approval)).status,
          familyFriendly: toFamilyFriendly(getPath(d, F.familyFriendly)),
        };
      }
      for (const d of c) {
        out[String(d._id)] = {
          status: toBankApproval(getPath(d, C.approval)).status,
          familyFriendly: toFamilyFriendly(getPath(d, C.familyFriendly)),
        };
      }
      return out;
    },

    /** Approve, reject or return a word to pending; records who and when. */
    async setWordApproval(id: string, status: BankApprovalStatus, by: string): Promise<boolean> {
      const oid = toOid(id);
      if (!oid || !isStatus(status)) return false;
      const at = now();
      const res = await words().updateOne(
        { _id: oid },
        { $set: { [F.approval]: { status, by: who(by), at }, [F.updatedAt]: new Date(at) } },
      );
      return res.matchedCount > 0;
    },

    /** Tag a word family friendly (true), not (false), or untag it (null); records who and when. */
    async setWordFamilyFriendly(id: string, value: boolean | null, by: string): Promise<boolean> {
      const oid = toOid(id);
      if (!oid || (value !== null && typeof value !== "boolean")) return false;
      const at = now();
      const res = await words().updateOne(
        { _id: oid },
        {
          $set: {
            [F.familyFriendly]: value,
            [F.familyFriendlyBy]: who(by),
            [F.familyFriendlyAt]: at,
            [F.updatedAt]: new Date(at),
          },
        },
      );
      return res.matchedCount > 0;
    },

    /**
     * Approve, reject or return a clue to pending; records who and when. An
     * approval stores the text the queue showed (after `cleanClue`) when it
     * differs from the stored text, keeping the first `original`, so what was
     * approved is what airs.
     */
    async setClueApproval(clueId: string, status: BankApprovalStatus, by: string): Promise<boolean> {
      const oid = toOid(clueId);
      if (!oid || !isStatus(status)) return false;
      const at = now();
      const set: Record<string, unknown> = { [C.approval]: { status, by: who(by), at }, [C.updatedAt]: new Date(at) };
      if (status === "approved") {
        const doc = await clues().findOne({ _id: oid });
        if (!doc) return false;
        const raw = getPath(doc, C.text);
        const cleaned = cleanClue(String(raw ?? ""));
        if (cleaned && cleaned !== raw) {
          set[C.text] = cleaned;
          if (getPath(doc, C.original) === undefined) set[C.original] = raw;
        }
      }
      const res = await clues().updateOne({ _id: oid }, { $set: set });
      return res.matchedCount > 0;
    },

    /** Tag a clue family friendly (true), not (false), or untag it (null); records who and when. */
    async setClueFamilyFriendly(clueId: string, value: boolean | null, by: string): Promise<boolean> {
      const oid = toOid(clueId);
      if (!oid || (value !== null && typeof value !== "boolean")) return false;
      const at = now();
      const res = await clues().updateOne(
        { _id: oid },
        {
          $set: {
            [C.familyFriendly]: value,
            [C.familyFriendlyBy]: who(by),
            [C.familyFriendlyAt]: at,
            [C.updatedAt]: new Date(at),
          },
        },
      );
      return res.matchedCount > 0;
    },

    /**
     * Edit a clue's text, keeping the first original and recording who and
     * when. An approved clue goes back to `pending` (§7.4); a pending or
     * rejected one keeps its status. The family-friendly tag is cleared to
     * untagged (who and when recorded): the edited text is new and is tagged
     * again when approved. Empty text is refused.
     */
    async editClue(clueId: string, text: string, by: string): Promise<boolean> {
      const oid = toOid(clueId);
      const t = typeof text === "string" ? text.replace(/\s+/g, " ").trim().slice(0, CLUE_TEXT_MAX) : "";
      if (!oid || !t) return false;
      const doc = await clues().findOne({ _id: oid });
      if (!doc) return false;
      const at = now();
      const set: Record<string, unknown> = {
        [C.text]: t,
        [C.editedBy]: who(by),
        [C.editedAt]: at,
        [C.familyFriendly]: null,
        [C.familyFriendlyBy]: who(by),
        [C.familyFriendlyAt]: at,
        [C.updatedAt]: new Date(at),
      };
      if (getPath(doc, C.original) === undefined) set[C.original] = getPath(doc, C.text);
      if (toBankApproval(getPath(doc, C.approval)).status === "approved") {
        set[C.approval] = { status: "pending", by: who(by), at };
      }
      await clues().updateOne({ _id: oid }, { $set: set });
      return true;
    },

    /**
     * Store (or, with null, clear) a word's suggestion (`crossword.suggest`,
     * WP11). Never touches the approval or the tag.
     */
    async setWordSuggestion(id: string, suggestion: BankSuggestion | null): Promise<boolean> {
      const oid = toOid(id);
      if (!oid) return false;
      const update = suggestion
        ? {
            $set: {
              [F.suggestion]: {
                clue: String(suggestion.clue ?? "").trim().slice(0, CLUE_TEXT_MAX),
                familyFriendly: suggestion.familyFriendly === true,
                reason: String(suggestion.reason ?? "").trim().slice(0, 300),
                model: String(suggestion.model ?? "").slice(0, 200),
                at: Number.isFinite(suggestion.at) ? suggestion.at : now(),
              },
            },
          }
        : { $unset: { [F.suggestion]: "" } };
      const res = await words().updateOne({ _id: oid }, update);
      return res.matchedCount > 0;
    },

    /**
     * Save clues for a word as new pending, untagged clues (a polished clue
     * saved back, or the operator's own). Skips texts the word already has.
     * Returns the number added.
     */
    async addClues(wordId: string, texts: string[], meta: { source: string; model?: string }): Promise<number> {
      const oid = toOid(wordId);
      if (!oid || !texts.length) return 0;
      const word = await words().findOne({ _id: oid }, { projection: { [F.norm]: 1, [F.length]: 1 } });
      if (!word) return 0;
      const existing = new Set(
        (await clues().find({ [C.answerId]: oid }, { projection: { [C.text]: 1 } }).toArray()).map((c) =>
          String(getPath(c, C.text) ?? "").toLowerCase(),
        ),
      );
      const fresh = [...new Set(texts.map((t) => t.trim()).filter(Boolean))].filter((t) => !existing.has(t.toLowerCase()));
      if (!fresh.length) return 0;
      const at = new Date(now());
      // The prototype's clue shape (enritch_words_vllm.py), plus this app's approval and tag.
      await clues().insertMany(
        fresh.map((t) => ({
          [C.answerId]: oid,
          [C.answerNorm]: getPath(word, F.norm),
          [C.answerLength]: getPath(word, F.length),
          [C.text]: t,
          style: "straight",
          isCryptic: false,
          source: { name: meta.source, ref: meta.model ?? null, createdBy: "photonsurge" },
          [C.approval]: { status: "pending" },
          [C.familyFriendly]: null,
          [C.createdAt]: at,
          [C.updatedAt]: at,
        })),
      );
      await words().updateOne({ _id: oid }, { $set: { [F.updatedAt]: at } });
      return fresh.length;
    },

    /** Build the bank's indexes (idempotent: createIndex is a no-op for an existing spec). */
    async ensureIndexes(): Promise<string[]> {
      const made: string[] = [];
      const opts = (ix: BankIndexSpec) => ({
        name: ix.name,
        ...(ix.partialFilterExpression ? { partialFilterExpression: ix.partialFilterExpression } : {}),
      });
      for (const ix of BANK_WORD_INDEXES) made.push(await words().createIndex(ix.key, opts(ix)));
      for (const ix of BANK_CLUE_INDEXES) made.push(await clues().createIndex(ix.key, opts(ix)));
      return made;
    },
  };
}

export type CrosswordBankRepo = ReturnType<typeof makeCrosswordBankRepo>;
