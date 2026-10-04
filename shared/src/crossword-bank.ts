/**
 * The February word bank (docs/crossword-mode-plan.md §7.2, §8.3): wire types,
 * the document field map and the pure query builders behind `db.crosswordBank`.
 *
 * The bank keeps the prototype's document shape (ObjectId keys, no `id`
 * field), imported whole by the operator as `crosswordbankwords` and
 * `crosswordbankclues`. NOTE: the field paths in BANK_WORD_FIELDS /
 * BANK_CLUE_FIELDS were written from the plan's description of the prototype,
 * without the prototype repo to hand. Check them against a real imported
 * document (`db.crosswordbankwords.findOne()`) and correct them here — every
 * reader goes through this one map.
 */

export const BANK_WORDS_COLLECTION = "crosswordbankwords";
export const BANK_CLUES_COLLECTION = "crosswordbankclues";

/** Dotted paths into a prototype word document. */
export const BANK_WORD_FIELDS = {
  word: "word",
  /** Uppercase A–Z form, the answer. */
  norm: "norm",
  length: "length",
  pos: "pos",
  categories: "categories",
  senses: "senses",
  flagAdult: "flags.adult",
  flagVulgar: "flags.vulgar",
  flagOffensive: "flags.offensive",
  /** Clue-writing status: pending / done / rejected / failed. */
  clueStatus: "enrichment.status",
  clueModel: "enrichment.model",
  clueReason: "enrichment.reason",
  clueAttempts: "enrichment.attempts",
  clueCount: "clueCount",
  /** Validation decision: accept / review / reject. */
  decision: "validation.decision",
  /** Who made the decision: the pipeline, or "operator" (written by this app). */
  decisionBy: "validation.by",
  decisionAt: "validation.at",
  validationSources: "validation.sources",
  validation: "validation",
  /** Word-frequency (Zipf) score, the difficulty dial. */
  zipf: "validation.zipf",
  updatedAt: "updatedAt",
} as const;

/** Dotted paths into a prototype clue document. */
export const BANK_CLUE_FIELDS = {
  /** The word document's ObjectId. */
  answerId: "answerId",
  text: "clue",
  difficulty: "difficulty",
  source: "source",
  model: "model",
  /** Added by this app: candidate / approved / rejected. Missing = candidate. */
  status: "status",
  /** Added by this app: the text before an operator edit. */
  original: "original",
  updatedAt: "updatedAt",
} as const;

/** Parts of speech that mark a word as a name, place or proper noun (never playable). */
export const BANK_PROPER_POS = ["name", "proper noun", "proper-noun", "place", "propn"] as const;

export type BankClueStatus = "pending" | "done" | "rejected" | "failed";
export type BankDecision = "accept" | "review" | "reject";
export type BankClueDecision = "candidate" | "approved" | "rejected";

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
  model?: string;
  decision?: string;
  decisionBy?: string;
  zipf?: number;
  clueCount: number;
  reason?: string;
  updatedAt?: string;
}

export interface BankClue {
  id: string;
  text: string;
  difficulty?: number;
  source?: string;
  model?: string;
  status: BankClueDecision;
  original?: string;
}

export interface BankSense {
  pos?: string;
  definitions: string[];
}

/** The Words detail page. */
export interface BankWordDetail extends BankWordRow {
  senses: BankSense[];
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

/** Mongo filter for the Words list. Pure, so it is tested without a server. */
export function bankWordFilter(q: BankWordQuery): Record<string, unknown> {
  const and: Record<string, unknown>[] = [];
  const letter = (q.startsWith ?? "").toUpperCase().replace(/[^A-Z]/g, "").slice(0, 1);
  const search = (q.search ?? "").toUpperCase().replace(/[^A-Z]/g, "");
  if (letter) and.push({ [F.norm]: { $regex: `^${letter}` } });
  if (search) and.push({ [F.norm]: { $regex: escapeRe(search) } });
  if (q.clueStatus) and.push({ [F.clueStatus]: q.clueStatus });
  if (q.acceptedOnly) and.push({ [F.decision]: "accept" });
  if (q.reviewOnly) and.push({ [F.decision]: "review" });
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
}

/**
 * Mongo filter for playable words: accepted, with clues, unflagged, 3–12
 * letters (or the given range), not a name, place or proper noun, at or above
 * `minZipf`. Operator rejections are covered by `decision: accept` (the
 * operator's Reject writes `reject`).
 */
export function bankPlayableFilter(q: BankPlayableQuery): Record<string, unknown> {
  const f: Record<string, unknown> = {
    [F.decision]: "accept",
    [F.clueStatus]: "done",
    [F.length]: { $gte: Math.max(3, q.minLength ?? 3), $lte: Math.min(12, q.maxLength ?? 12) },
    [F.zipf]: { $gte: q.minZipf },
    [F.flagAdult]: { $ne: true },
    [F.flagVulgar]: { $ne: true },
    [F.flagOffensive]: { $ne: true },
    [F.pos]: { $nin: [...BANK_PROPER_POS] },
  };
  if (q.excludeNorms?.length) f[F.norm] = { $nin: q.excludeNorms };
  return f;
}

/**
 * Index specs `yarn crossword:bank-index` builds once after an import (§7.2
 * step 3). The compound one serves the builder's pick.
 */
export const BANK_WORD_INDEXES: { key: Record<string, 1 | -1>; name: string }[] = [
  { key: { [F.norm]: 1 }, name: "xwbank_norm_ix" },
  { key: { [F.clueStatus]: 1 }, name: "xwbank_cluestatus_ix" },
  { key: { [F.updatedAt]: -1 }, name: "xwbank_updated_ix" },
  { key: { [F.length]: 1 }, name: "xwbank_length_ix" },
  { key: { [F.zipf]: -1 }, name: "xwbank_zipf_ix" },
  {
    key: { [F.decision]: 1, [F.clueStatus]: 1, [F.length]: 1, [F.zipf]: -1 },
    name: "xwbank_pick_ix",
  },
];
export const BANK_CLUE_INDEXES: { key: Record<string, 1 | -1>; name: string }[] = [
  { key: { [BANK_CLUE_FIELDS.answerId]: 1 }, name: "xwbank_clue_answer_ix" },
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

const asStrings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x) => typeof x === "string") : typeof v === "string" && v ? [v] : [];
const asNum = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const asStr = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);
const asIso = (v: unknown): string | undefined =>
  v instanceof Date ? v.toISOString() : typeof v === "string" ? v : typeof v === "number" ? new Date(v).toISOString() : undefined;

/** A raw prototype word document → list row. */
export function toBankWordRow(doc: Record<string, unknown>): BankWordRow {
  const word = asStr(getPath(doc, F.word)) ?? asStr(getPath(doc, F.norm)) ?? "";
  const norm = asStr(getPath(doc, F.norm)) ?? word.toUpperCase().replace(/[^A-Z]/g, "");
  return {
    id: String(doc._id),
    word,
    length: asNum(getPath(doc, F.length)) ?? norm.length,
    clueStatus: asStr(getPath(doc, F.clueStatus)),
    pos: asStrings(getPath(doc, F.pos)),
    categories: asStrings(getPath(doc, F.categories)),
    flags: {
      adult: getPath(doc, F.flagAdult) === true || undefined,
      vulgar: getPath(doc, F.flagVulgar) === true || undefined,
      offensive: getPath(doc, F.flagOffensive) === true || undefined,
    },
    model: asStr(getPath(doc, F.clueModel)),
    decision: asStr(getPath(doc, F.decision)),
    decisionBy: asStr(getPath(doc, F.decisionBy)),
    zipf: asNum(getPath(doc, F.zipf)),
    clueCount: asNum(getPath(doc, F.clueCount)) ?? 0,
    reason: asStr(getPath(doc, F.clueReason)),
    updatedAt: asIso(getPath(doc, F.updatedAt)),
  };
}

/** A raw prototype clue document → wire clue. */
export function toBankClue(doc: Record<string, unknown>): BankClue {
  const C = BANK_CLUE_FIELDS;
  const st = getPath(doc, C.status);
  return {
    id: String(doc._id),
    text: asStr(getPath(doc, C.text)) ?? "",
    difficulty: asNum(getPath(doc, C.difficulty)),
    source: asStr(getPath(doc, C.source)),
    model: asStr(getPath(doc, C.model)),
    status: st === "approved" || st === "rejected" ? st : "candidate",
    original: asStr(getPath(doc, C.original)),
  };
}

/** Senses with their definitions, tolerant of `definitions` / `glosses` / `definition`. */
export function toBankSenses(v: unknown): BankSense[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((s) => s && typeof s === "object")
    .map((s: Record<string, unknown>) => ({
      pos: asStr(s.pos),
      definitions: [...asStrings(s.definitions), ...asStrings(s.glosses), ...asStrings(s.definition)],
    }));
}

/** The band a Zipf score falls in. */
export function zipfBand(z: number | undefined): BankZipfBand {
  if (typeof z !== "number") return "none";
  return BANK_ZIPF_BANDS.find((b) => z >= b.min && z < b.max)?.id ?? "none";
}
