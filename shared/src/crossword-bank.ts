/**
 * The February word bank (docs/crossword-mode-plan.md §7.2, §8.3): wire types,
 * the document field map and the pure query builders behind `db.crosswordBank`.
 *
 * The bank keeps the prototype's document shape (ObjectId keys, no `id`
 * field), imported whole by the operator as `crosswordbankwords` and
 * `crosswordbankclues`. The field paths below follow the prototype's word
 * pipeline (crosswords/python/words-tools: injest.py, validate_words.py,
 * enritch_words_vllm.py) and its words admin (crosswords/my-app). Every reader
 * goes through this one map.
 *
 * On top of the prototype's shape this app adds, on words and clues alike
 * (§7.4): `approval: { status, by?, at? }` and `familyFriendly: boolean |
 * null`, with who and when on each decision. A missing approval is `pending`,
 * a missing tag is `null` (untagged). A word may also carry a stored
 * `suggestion` (WP11), which is never an approval.
 */

import type { ClueProblem } from "./crossword";

export const BANK_WORDS_COLLECTION = "crosswordbankwords";
export const BANK_CLUES_COLLECTION = "crosswordbankclues";

/** Dotted paths into a prototype word document. */
export const BANK_WORD_FIELDS = {
  word: "word",
  /** Uppercase A–Z form, the answer. */
  norm: "norm",
  length: "length",
  pos: "pos",
  categories: "categorySlugs",
  /** `{ pos, definition, register, domains }[]`, written by the enrichment run. */
  senses: "senses",
  /** The Wiktionary definitions the word was ingested with — the facts a clue is written from. */
  rawDefinitions: "raw.definitions",
  flagAdult: "flags.adult",
  flagVulgar: "flags.vulgar",
  flagOffensive: "flags.offensive",
  /** Clue-writing status: pending / done / rejected / failed. */
  clueStatus: "enrichment.status",
  clueModel: "enrichment.model",
  clueReason: "enrichment.reason",
  clueAttempts: "enrichment.attempts",
  /** The pipeline's validation decision: accepted / review / reject. Read-only here. */
  decision: "validation.decision",
  decisionBy: "validation.by",
  validationSources: "validation.sources",
  validation: "validation",
  /** Word-frequency (Zipf) score, the difficulty dial. */
  zipf: "validation.sources.wordfreq.zipf",
  updatedAt: "updatedAt",
  // Added by this app (§7.4).
  approval: "approval",
  approvalStatus: "approval.status",
  familyFriendly: "familyFriendly",
  familyFriendlyBy: "familyFriendlyBy",
  familyFriendlyAt: "familyFriendlyAt",
  /** BankSuggestion, written by `crossword.suggest` (WP11). */
  suggestion: "suggestion",
} as const;

/** Dotted paths into a prototype clue document. */
export const BANK_CLUE_FIELDS = {
  /** The word document's ObjectId. */
  answerId: "answerId",
  answerNorm: "answerNorm",
  answerLength: "answerLength",
  text: "clue",
  difficulty: "difficulty",
  /** `source` is `{ name, ref, createdBy }`; `ref` holds the model for an LLM clue. */
  source: "source.name",
  model: "source.ref",
  createdBy: "source.createdBy",
  createdAt: "createdAt",
  updatedAt: "updatedAt",
  // Added by this app (§7.4).
  approval: "approval",
  approvalStatus: "approval.status",
  familyFriendly: "familyFriendly",
  familyFriendlyBy: "familyFriendlyBy",
  familyFriendlyAt: "familyFriendlyAt",
  /** The text before the first operator edit. */
  original: "original",
  editedBy: "editedBy",
  editedAt: "editedAt",
} as const;

/** Parts of speech that mark a word as a name, place or proper noun (never playable). */
export const BANK_PROPER_POS = ["proper-noun"] as const;

export type BankClueStatus = "pending" | "done" | "rejected" | "failed";
export type BankDecision = "accepted" | "review" | "reject";

/** A person's decision on a word or a clue (§7.4). */
export type BankApprovalStatus = "pending" | "approved" | "rejected";
export const BANK_APPROVAL_STATUSES: readonly BankApprovalStatus[] = ["pending", "approved", "rejected"];
export interface BankApproval {
  status: BankApprovalStatus;
  /** Who decided (the admin's name or email). */
  by?: string;
  /** When (epoch ms). */
  at?: number;
}
/** The list filter on the family-friendly tag. */
export type BankFamilyFilter = "yes" | "no" | "untagged";

/** The model-made flags, shown as warnings only (§7.4): they decide nothing. */
export type BankWarning = "adult" | "vulgar" | "offensive";

/**
 * A model's suggestion for a word (`crossword.suggest`, WP11). Shown in the
 * queue marked as a suggestion; never an approval.
 */
export interface BankSuggestion {
  /** One polished clue, at most CLUE_MAX characters, for the most common sense. */
  clue: string;
  familyFriendly: boolean;
  /** One line on why. */
  reason: string;
  model: string;
  at: number;
}

/** Frequency bands for the list filter and the totals. Upper bound exclusive. */
export const BANK_ZIPF_BANDS = [
  { id: "rare", label: "Rare (< 2)", min: -Infinity, max: 2 },
  { id: "uncommon", label: "Uncommon (2–3)", min: 2, max: 3 },
  { id: "known", label: "Known (3–4)", min: 3, max: 4 },
  { id: "common", label: "Common (4–5)", min: 4, max: 5 },
  { id: "everyday", label: "Everyday (5+)", min: 5, max: Infinity },
] as const;
export type BankZipfBand = (typeof BANK_ZIPF_BANDS)[number]["id"] | "none";

/** A list row on the Words page. */
export interface BankWordRow {
  id: string;
  word: string;
  length: number;
  clueStatus?: string;
  pos: string[];
  categories: string[];
  flags: { adult?: boolean; vulgar?: boolean; offensive?: boolean };
  /** The same flags as a list, for showing as warnings. */
  warnings: BankWarning[];
  model?: string;
  /** The pipeline's validation decision (read-only). */
  decision?: string;
  decisionBy?: string;
  zipf?: number;
  clueCount: number;
  reason?: string;
  updatedAt?: string;
  approval: BankApproval;
  /** null = not tagged yet. */
  familyFriendly: boolean | null;
  familyFriendlyBy?: string;
  familyFriendlyAt?: number;
  suggestion?: BankSuggestion;
}

export interface BankClue {
  id: string;
  text: string;
  difficulty?: number;
  source?: string;
  model?: string;
  approval: BankApproval;
  familyFriendly: boolean | null;
  familyFriendlyBy?: string;
  familyFriendlyAt?: number;
  /** The text before the first edit. */
  original?: string;
  editedBy?: string;
  editedAt?: number;
}

export interface BankSense {
  pos?: string;
  definitions: string[];
}

/** The Words detail page. */
export interface BankWordDetail extends BankWordRow {
  senses: BankSense[];
  /** The raw Wiktionary definitions the word was ingested with. */
  definitions: string[];
  clues: BankClue[];
  /** What each validation source said (raw). */
  validationSources?: unknown;
  /** Raw attempts and validation JSON. */
  raw: { attempts?: unknown; validation?: unknown };
}

export type BankSort = "updated" | "word" | "length" | "zipf";

/** The Words list's filters (all optional). */
export interface BankWordQuery {
  /** Substring of the word (case-insensitive) — prefix-anchored when `startsWith`-only. */
  search?: string;
  /** Single letter A–Z. */
  startsWith?: string;
  clueStatus?: BankClueStatus;
  band?: BankZipfBand;
  acceptedOnly?: boolean;
  reviewOnly?: boolean;
  /** The word's approval (§7.4). */
  approval?: BankApprovalStatus;
  /** The word's family-friendly tag. */
  familyFriendly?: BankFamilyFilter;
  sort?: BankSort;
  dir?: "asc" | "desc";
  page?: number;
  pageSize?: number;
}

export interface BankTotals {
  byClueStatus: Record<string, number>;
  byDecision: Record<string, number>;
  byBand: Record<string, number>;
  total: number;
}

export const BANK_PAGE_SIZES = [25, 50, 100, 200] as const;

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const F = BANK_WORD_FIELDS;
const C = BANK_CLUE_FIELDS;

/** Match an approval status; `pending` also matches a missing one. */
export function approvalFilter(path: string, status: BankApprovalStatus): Record<string, unknown> {
  return status === "pending" ? { [path]: { $nin: ["approved", "rejected"] } } : { [path]: status };
}

/** Match the family-friendly tag; `untagged` matches null or missing. */
export function familyFilter(path: string, v: BankFamilyFilter): Record<string, unknown> {
  return v === "yes" ? { [path]: true } : v === "no" ? { [path]: false } : { [path]: { $nin: [true, false] } };
}

/** Mongo filter for the Words list. Pure, so it is tested without a server. */
export function bankWordFilter(q: BankWordQuery): Record<string, unknown> {
  const and: Record<string, unknown>[] = [];
  const letter = (q.startsWith ?? "").toUpperCase().replace(/[^A-Z]/g, "").slice(0, 1);
  const search = (q.search ?? "").toUpperCase().replace(/[^A-Z]/g, "");
  if (letter) and.push({ [F.norm]: { $regex: `^${letter}` } });
  if (search) and.push({ [F.norm]: { $regex: escapeRe(search) } });
  if (q.clueStatus) and.push({ [F.clueStatus]: q.clueStatus });
  if (q.acceptedOnly) and.push({ [F.decision]: "accepted" });
  if (q.reviewOnly) and.push({ [F.decision]: "review" });
  if (q.approval) and.push(approvalFilter(F.approvalStatus, q.approval));
  if (q.familyFriendly) and.push(familyFilter(F.familyFriendly, q.familyFriendly));
  if (q.band) {
    if (q.band === "none") and.push({ [F.zipf]: { $exists: false } });
    else {
      const b = BANK_ZIPF_BANDS.find((x) => x.id === q.band);
      if (b) {
        const r: Record<string, number> = {};
        if (Number.isFinite(b.min)) r.$gte = b.min;
        if (Number.isFinite(b.max)) r.$lt = b.max;
        and.push({ [F.zipf]: Object.keys(r).length ? r : { $exists: true } });
      }
    }
  }
  return and.length === 0 ? {} : and.length === 1 ? and[0] : { $and: and };
}

/** Mongo sort for the Words list (stable on `_id`). */
export function bankWordSort(q: BankWordQuery): Record<string, 1 | -1> {
  const d: 1 | -1 = q.dir === "asc" ? 1 : q.dir === "desc" ? -1 : q.sort === "word" || q.sort === "length" ? 1 : -1;
  const key = q.sort === "word" ? F.norm : q.sort === "length" ? F.length : q.sort === "zipf" ? F.zipf : F.updatedAt;
  return { [key]: d, _id: d };
}

/** Clamp paging: page ≥ 1, page size one of BANK_PAGE_SIZES (default 50). */
export function bankPaging(q: BankWordQuery): { skip: number; limit: number; page: number; pageSize: number } {
  const pageSize = (BANK_PAGE_SIZES as readonly number[]).includes(q.pageSize ?? 0) ? q.pageSize! : 50;
  const page = Math.max(1, Math.floor(q.page ?? 1));
  return { skip: (page - 1) * pageSize, limit: pageSize, page, pageSize };
}

/** Options for the puzzle builder's playable pick (§7.3 step 1). */
export interface BankPlayableQuery {
  minZipf: number;
  minLength?: number;
  maxLength?: number;
  /** Norms not to return (the scene's last N puzzles' words). */
  excludeNorms?: string[];
  /** The channel's Family friendly only: word and clue must both be tagged true. */
  familyFriendlyOnly?: boolean;
  /**
   * Dev boxes only (`CROSSWORD_ALLOW_UNAPPROVED`, read by the worker): use the
   * pipeline-accepted words that are not rejected, pending ones included,
   * with their stored clues cleaned. The family-friendly tags are ignored.
   */
  allowUnapproved?: boolean;
}

const lengthRange = (q: { minLength?: number; maxLength?: number }) => ({
  $gte: Math.max(3, q.minLength ?? 3),
  $lte: Math.min(12, q.maxLength ?? 12),
});

/**
 * Mongo filter for playable words. Approved, 3–12 letters (or the given range
 * inside it), at or above `minZipf`, not excluded, and tagged family friendly
 * on a family-friendly channel. Approval is a person's call, so the model's
 * flags and the part of speech play no part. A word also needs at least one
 * approved clue: `bankPlayableClueFilter` finds those, and the repo drops a
 * word without one.
 *
 * With `allowUnapproved`, the old pipeline filter instead: accepted, clued,
 * unflagged, not a proper noun, and not rejected by a person.
 */
export function bankPlayableFilter(q: BankPlayableQuery): Record<string, unknown> {
  const f: Record<string, unknown> = q.allowUnapproved
    ? {
        [F.decision]: "accepted",
        [F.clueStatus]: "done",
        [F.approvalStatus]: { $ne: "rejected" },
        [F.flagAdult]: { $ne: true },
        [F.flagVulgar]: { $ne: true },
        [F.flagOffensive]: { $ne: true },
        [F.pos]: { $nin: [...BANK_PROPER_POS] },
      }
    : { [F.approvalStatus]: "approved", ...(q.familyFriendlyOnly ? { [F.familyFriendly]: true } : {}) };
  f[F.length] = lengthRange(q);
  f[F.zipf] = { $gte: q.minZipf };
  if (q.excludeNorms?.length) f[F.norm] = { $nin: q.excludeNorms };
  return f;
}

/** Mongo filter for the clues a playable word may use (same rules as the word pick). */
export function bankPlayableClueFilter(answerIds: unknown[], q: Pick<BankPlayableQuery, "familyFriendlyOnly" | "allowUnapproved">): Record<string, unknown> {
  return q.allowUnapproved
    ? { [C.answerId]: { $in: answerIds }, [C.approvalStatus]: { $ne: "rejected" } }
    : {
        [C.answerId]: { $in: answerIds },
        [C.approvalStatus]: "approved",
        ...(q.familyFriendlyOnly ? { [C.familyFriendly]: true } : {}),
      };
}

// ---------------------------------------------------------------------------
// The approval queue (§7.4)
// ---------------------------------------------------------------------------

/**
 * The lengths the builder needs most. A criss-cross layout of 12–16 words
 * leans on 4–9 letters (the pick's length spread is weighted there), so the
 * queue serves those first.
 */
export const QUEUE_PREFERRED_LENGTHS = { min: 4, max: 9 } as const;
export const QUEUE_LIMIT_MAX = 50;

export interface BankQueueQuery {
  band?: BankZipfBand;
  minLength?: number;
  maxLength?: number;
  /** Single letter A–Z. */
  startsWith?: string;
  /** Only words with a stored suggestion. */
  withSuggestions?: boolean;
  /** Words to leave out (the ones the operator skipped this session). */
  excludeIds?: string[];
  limit: number;
}

/**
 * Mongo filter for one tier of the approval queue. The queue is pending words
 * the pipeline accepted and clued, 3–12 letters, with a frequency score; the
 * model's flags are shown as warnings, not filtered. Tier `preferred` is the
 * lengths in QUEUE_PREFERRED_LENGTHS (within the asked range), tier `rest` the
 * other lengths in range.
 *
 * Queue order: tier `preferred` first, then `rest`; inside each, most common
 * first (Zipf descending), ties by id. So the operator always works on the
 * most familiar word of a length the builder needs, and only reaches 3- and
 * 10–12-letter words once those run out (or by narrowing the length filter).
 */
export function bankQueueFilter(q: Omit<BankQueueQuery, "limit" | "excludeIds">, tier: "preferred" | "rest"): Record<string, unknown> {
  const lo = Math.max(3, q.minLength ?? 3);
  const hi = Math.min(12, q.maxLength ?? 12);
  const pLo = Math.max(lo, QUEUE_PREFERRED_LENGTHS.min);
  const pHi = Math.min(hi, QUEUE_PREFERRED_LENGTHS.max);
  const and: Record<string, unknown>[] = [
    approvalFilter(F.approvalStatus, "pending"),
    { [F.decision]: "accepted" },
    { [F.clueStatus]: "done" },
  ];
  if (tier === "preferred") and.push({ [F.length]: pLo <= pHi ? { $gte: pLo, $lte: pHi } : { $in: [] } });
  else {
    const rest: number[] = [];
    for (let n = lo; n <= hi; n++) if (n < pLo || n > pHi) rest.push(n);
    and.push({ [F.length]: { $in: rest } });
  }
  const band = q.band ? BANK_ZIPF_BANDS.find((x) => x.id === q.band) : undefined;
  const z: Record<string, unknown> = { $type: "number" };
  if (band && Number.isFinite(band.min)) z.$gte = band.min;
  if (band && Number.isFinite(band.max)) z.$lt = band.max;
  and.push({ [F.zipf]: z });
  const letter = (q.startsWith ?? "").toUpperCase().replace(/[^A-Z]/g, "").slice(0, 1);
  if (letter) and.push({ [F.norm]: { $regex: `^${letter}` } });
  if (q.withSuggestions) and.push({ [F.suggestion]: { $type: "object" } });
  return { $and: and };
}

/** Queue sort inside a tier: most common first. */
export const BANK_QUEUE_SORT: Record<string, 1 | -1> = { [F.zipf]: -1, _id: 1 };

/** A candidate clue in the queue: as stored, after `cleanClue`, and what `validateClue` says of it. */
export interface BankQueueClue extends BankClue {
  cleaned: string;
  problem: ClueProblem | null;
}

/** One word in the approval queue. Rejected clues are left out. */
export interface BankQueueWord extends BankWordRow {
  norm: string;
  senses: BankSense[];
  /** The raw Wiktionary definitions: the facts. */
  definitions: string[];
  clues: BankQueueClue[];
}

// ---------------------------------------------------------------------------
// The approved pool (§7.4 counter)
// ---------------------------------------------------------------------------

/** About this many words make a puzzle (12–16 placed). */
export const POOL_WORDS_PER_PUZZLE = 14;
/** A word may return after this many puzzles (`noRepeatWordsPuzzles`' default). */
export const POOL_NO_REPEAT_PUZZLES = 20;

export interface BankPoolCounts {
  /** Approved words, 3–12 letters, with at least one approved clue. */
  words: number;
  /** Of those: the word and at least one approved clue tagged family friendly. */
  ffWords: number;
  /** floor(words / POOL_WORDS_PER_PUZZLE). */
  puzzlesWithoutRepeat: number;
  /** The same, for a family-friendly channel. */
  ffPuzzlesWithoutRepeat: number;
  /** POOL_WORDS_PER_PUZZLE × POOL_NO_REPEAT_PUZZLES: enough to fill the no-repeat window. */
  targetWords: number;
}

/**
 * The counter's arithmetic. Each puzzle uses about 14 distinct words, so a
 * pool of W words supports floor(W / 14) puzzles before any word has to come
 * back. A word may return after 20 puzzles, so a pool of 14 × 20 = 280 words
 * (the plan's "about 300") lets a channel play on with no word ever reused
 * inside the window. Minimum frequency is per channel and is not applied
 * here, so the counter is an upper bound for a channel with a high `minZipf`.
 */
export function poolCounts(words: number, ffWords: number): BankPoolCounts {
  const w = Math.max(0, Math.floor(words));
  const ff = Math.max(0, Math.floor(ffWords));
  return {
    words: w,
    ffWords: ff,
    puzzlesWithoutRepeat: Math.floor(w / POOL_WORDS_PER_PUZZLE),
    ffPuzzlesWithoutRepeat: Math.floor(ff / POOL_WORDS_PER_PUZZLE),
    targetWords: POOL_WORDS_PER_PUZZLE * POOL_NO_REPEAT_PUZZLES,
  };
}

/**
 * Index specs `yarn crossword:bank-index` builds once after an import (§7.2
 * step 3). The compound `xwbank_approved_pick_ix` serves the builder's pick
 * (approval, family friendly, length, frequency); the clue one on approval
 * serves the pool counter.
 */
export const BANK_WORD_INDEXES: { key: Record<string, 1 | -1>; name: string }[] = [
  { key: { [F.norm]: 1 }, name: "xwbank_norm_ix" },
  { key: { [F.clueStatus]: 1 }, name: "xwbank_cluestatus_ix" },
  { key: { [F.updatedAt]: -1 }, name: "xwbank_updated_ix" },
  { key: { [F.length]: 1 }, name: "xwbank_length_ix" },
  { key: { [F.zipf]: -1 }, name: "xwbank_zipf_ix" },
  {
    key: { [F.approvalStatus]: 1, [F.familyFriendly]: 1, [F.length]: 1, [F.zipf]: -1 },
    name: "xwbank_approved_pick_ix",
  },
];
export const BANK_CLUE_INDEXES: { key: Record<string, 1 | -1>; name: string }[] = [
  { key: { [C.answerId]: 1 }, name: "xwbank_clue_answer_ix" },
  { key: { [C.approvalStatus]: 1, [C.answerId]: 1 }, name: "xwbank_clue_approval_ix" },
];

/** Read a dotted path out of a plain object. */
export function getPath(doc: unknown, path: string): unknown {
  let cur: unknown = doc;
  for (const k of path.split(".")) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[k];
  }
  return cur;
}

export const asStrings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x) => typeof x === "string") : typeof v === "string" && v ? [v] : [];
const asNum = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const asStr = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);
const asIso = (v: unknown): string | undefined =>
  v instanceof Date ? v.toISOString() : typeof v === "string" ? v : typeof v === "number" ? new Date(v).toISOString() : undefined;
const asMs = (v: unknown): number | undefined => (v instanceof Date ? v.getTime() : asNum(v));

/** A stored approval → wire. Missing or unknown status is `pending`. */
export function toBankApproval(v: unknown): BankApproval {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const status = (BANK_APPROVAL_STATUSES as readonly unknown[]).includes(o.status) ? (o.status as BankApprovalStatus) : "pending";
  const by = asStr(o.by);
  const at = asMs(o.at);
  return { status, ...(by ? { by } : {}), ...(at !== undefined ? { at } : {}) };
}

/** A stored tag → wire: true / false, anything else null (untagged). */
export const toFamilyFriendly = (v: unknown): boolean | null => (typeof v === "boolean" ? v : null);

/** A stored suggestion → wire, or undefined when it is missing or malformed. */
export function toBankSuggestion(v: unknown): BankSuggestion | undefined {
  if (!v || typeof v !== "object") return undefined;
  const o = v as Record<string, unknown>;
  const clue = asStr(o.clue);
  if (!clue || typeof o.familyFriendly !== "boolean") return undefined;
  return { clue, familyFriendly: o.familyFriendly, reason: asStr(o.reason) ?? "", model: asStr(o.model) ?? "", at: asMs(o.at) ?? 0 };
}

/** Who and when on a family-friendly tag. */
function tagMeta(doc: Record<string, unknown>, byPath: string, atPath: string) {
  const by = asStr(getPath(doc, byPath));
  const at = asMs(getPath(doc, atPath));
  return { ...(by ? { familyFriendlyBy: by } : {}), ...(at !== undefined ? { familyFriendlyAt: at } : {}) };
}

/** A raw prototype word document → list row. The clue count is not stored on the word. */
export function toBankWordRow(doc: Record<string, unknown>, clueCount = 0): BankWordRow {
  const word = asStr(getPath(doc, F.word)) ?? asStr(getPath(doc, F.norm)) ?? "";
  const norm = asStr(getPath(doc, F.norm)) ?? word.toUpperCase().replace(/[^A-Z]/g, "");
  const flags = {
    adult: getPath(doc, F.flagAdult) === true || undefined,
    vulgar: getPath(doc, F.flagVulgar) === true || undefined,
    offensive: getPath(doc, F.flagOffensive) === true || undefined,
  };
  const suggestion = toBankSuggestion(getPath(doc, F.suggestion));
  return {
    id: String(doc._id),
    word,
    length: asNum(getPath(doc, F.length)) ?? norm.length,
    clueStatus: asStr(getPath(doc, F.clueStatus)),
    pos: asStrings(getPath(doc, F.pos)),
    categories: asStrings(getPath(doc, F.categories)),
    flags,
    warnings: (["adult", "vulgar", "offensive"] as const).filter((k) => flags[k]),
    model: asStr(getPath(doc, F.clueModel)),
    decision: asStr(getPath(doc, F.decision)),
    decisionBy: asStr(getPath(doc, F.decisionBy)),
    zipf: asNum(getPath(doc, F.zipf)),
    clueCount,
    reason: asStr(getPath(doc, F.clueReason)),
    updatedAt: asIso(getPath(doc, F.updatedAt)),
    approval: toBankApproval(getPath(doc, F.approval)),
    familyFriendly: toFamilyFriendly(getPath(doc, F.familyFriendly)),
    ...tagMeta(doc, F.familyFriendlyBy, F.familyFriendlyAt),
    ...(suggestion ? { suggestion } : {}),
  };
}

/** A raw prototype clue document → wire clue. */
export function toBankClue(doc: Record<string, unknown>): BankClue {
  const editedBy = asStr(getPath(doc, C.editedBy));
  const editedAt = asMs(getPath(doc, C.editedAt));
  const original = asStr(getPath(doc, C.original));
  return {
    id: String(doc._id),
    text: asStr(getPath(doc, C.text)) ?? "",
    difficulty: asNum(getPath(doc, C.difficulty)),
    source: asStr(getPath(doc, C.source)),
    model: asStr(getPath(doc, C.model)),
    approval: toBankApproval(getPath(doc, C.approval)),
    familyFriendly: toFamilyFriendly(getPath(doc, C.familyFriendly)),
    ...tagMeta(doc, C.familyFriendlyBy, C.familyFriendlyAt),
    ...(original !== undefined ? { original } : {}),
    ...(editedBy ? { editedBy } : {}),
    ...(editedAt !== undefined ? { editedAt } : {}),
  };
}

/** Senses with their definitions (the pipeline writes one `definition` a sense; lists tolerated). */
export function toBankSenses(v: unknown): BankSense[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((s) => s && typeof s === "object")
    .map((s: Record<string, unknown>) => ({
      pos: asStr(s.pos),
      definitions: [...asStrings(s.definition), ...asStrings(s.definitions), ...asStrings(s.glosses)],
    }));
}

/** The band a Zipf score falls in. */
export function zipfBand(z: number | undefined): BankZipfBand {
  if (typeof z !== "number") return "none";
  return BANK_ZIPF_BANDS.find((b) => z >= b.min && z < b.max)?.id ?? "none";
}
