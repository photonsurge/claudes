/**
 * The Words list's URL query (docs/crossword-mode-plan.md §8.3): the filters
 * live in the page's query string so a view is linkable, and the same string is
 * forwarded to GET /api/crossword/words. `parseBankQuery` turns it into a
 * BankWordQuery (dropping anything unknown); `bankQueryString` is its inverse.
 * Both pure, shared by the page and the route; the Mongo filter itself is the
 * shared `bankWordFilter`.
 */
import {
  BANK_APPROVAL_STATUSES,
  BANK_PAGE_SIZES,
  BANK_ZIPF_BANDS,
  type BankClueStatus,
  type BankFamilyFilter,
  type BankPoolCounts,
  type BankSort,
  type BankTotals,
  type BankWordQuery,
  type BankWordRow,
  type BankZipfBand,
} from "@photonsurge/shared/crossword-bank";

export const BANK_CLUE_STATUSES: readonly BankClueStatus[] = ["pending", "done", "rejected", "failed"];
export const BANK_FAMILY_FILTERS: readonly { id: BankFamilyFilter; label: string }[] = [
  { id: "yes", label: "Family friendly" },
  { id: "no", label: "Not family friendly" },
  { id: "untagged", label: "Untagged" },
];
export const BANK_SORTS: readonly { id: BankSort; label: string }[] = [
  { id: "updated", label: "Updated" },
  { id: "word", label: "Word" },
  { id: "length", label: "Length" },
  { id: "zipf", label: "Frequency" },
];
export const BANK_BAND_IDS: readonly BankZipfBand[] = [...BANK_ZIPF_BANDS.map((b) => b.id), "none"];

/** Query-string keys, short so a shared link stays readable. */
const K = {
  search: "q",
  startsWith: "letter",
  clueStatus: "status",
  band: "band",
  acceptedOnly: "accepted",
  reviewOnly: "review",
  approval: "approval",
  familyFriendly: "ff",
  sort: "sort",
  dir: "dir",
  page: "page",
  pageSize: "size",
} as const;

const oneOf = <T extends string>(v: string | null, allowed: readonly T[]): T | undefined =>
  v != null && (allowed as readonly string[]).includes(v) ? (v as T) : undefined;
const truthy = (v: string | null) => v === "1" || v === "true";
const posInt = (v: string | null): number | undefined => {
  const n = v == null ? NaN : Number(v);
  return Number.isInteger(n) && n > 0 ? n : undefined;
};

type ParamsLike = Pick<URLSearchParams, "get">;

/** The list's filters from a query string. Unknown or malformed values are dropped. */
export function parseBankQuery(sp: ParamsLike): BankWordQuery {
  const q: BankWordQuery = {};
  const search = (sp.get(K.search) ?? "").trim().slice(0, 64);
  if (search) q.search = search;
  const letter = (sp.get(K.startsWith) ?? "").trim().toUpperCase();
  if (/^[A-Z]$/.test(letter)) q.startsWith = letter;
  const status = oneOf(sp.get(K.clueStatus), BANK_CLUE_STATUSES);
  if (status) q.clueStatus = status;
  const band = oneOf(sp.get(K.band), BANK_BAND_IDS);
  if (band) q.band = band;
  if (truthy(sp.get(K.acceptedOnly))) q.acceptedOnly = true;
  if (truthy(sp.get(K.reviewOnly))) q.reviewOnly = true;
  const approval = oneOf(sp.get(K.approval), BANK_APPROVAL_STATUSES);
  if (approval) q.approval = approval;
  const ff = oneOf(sp.get(K.familyFriendly), BANK_FAMILY_FILTERS.map((f) => f.id));
  if (ff) q.familyFriendly = ff;
  const sort = oneOf(sp.get(K.sort), BANK_SORTS.map((s) => s.id));
  if (sort) q.sort = sort;
  const dir = oneOf(sp.get(K.dir), ["asc", "desc"] as const);
  if (dir) q.dir = dir;
  const page = posInt(sp.get(K.page));
  if (page && page > 1) q.page = page;
  const size = posInt(sp.get(K.pageSize));
  if (size && (BANK_PAGE_SIZES as readonly number[]).includes(size)) q.pageSize = size;
  return q;
}

/** The query string for a set of filters (no leading `?`); empty for the default view. */
export function bankQueryString(q: BankWordQuery): string {
  const sp = new URLSearchParams();
  if (q.search) sp.set(K.search, q.search);
  if (q.startsWith) sp.set(K.startsWith, q.startsWith);
  if (q.clueStatus) sp.set(K.clueStatus, q.clueStatus);
  if (q.band) sp.set(K.band, q.band);
  if (q.acceptedOnly) sp.set(K.acceptedOnly, "1");
  if (q.reviewOnly) sp.set(K.reviewOnly, "1");
  if (q.approval) sp.set(K.approval, q.approval);
  if (q.familyFriendly) sp.set(K.familyFriendly, q.familyFriendly);
  if (q.sort) sp.set(K.sort, q.sort);
  if (q.dir) sp.set(K.dir, q.dir);
  if (q.page && q.page > 1) sp.set(K.page, String(q.page));
  if (q.pageSize) sp.set(K.pageSize, String(q.pageSize));
  return sp.toString();
}

/** GET /api/crossword/words. `imported` is false when the bank collection is empty or absent. */
export interface BankWordsResponse {
  rows: BankWordRow[];
  total: number;
  /** A filtered count stopped at BANK_COUNT_CAP: `total` is a floor, shown as "10,000+". */
  totalCapped?: boolean;
  page: number;
  pageSize: number;
  totals: BankTotals;
  /** The approved pool (§7.4 counter). */
  pool: BankPoolCounts;
  imported: boolean;
}

/** The §7.2 import command, shown on an empty bank. */
export const BANK_IMPORT_COMMAND = `mongorestore --uri "mongodb://127.0.0.1:27017" \\
  --nsInclude 'crossword.words' --nsInclude 'crossword.clues' \\
  --nsFrom 'crossword.words' --nsTo 'weather.crosswordbankwords' \\
  --nsFrom 'crossword.clues' --nsTo 'weather.crosswordbankclues' \\
  /home/rich/code/thronix/dump`;
