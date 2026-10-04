/**
 * The approval queue's request (docs/crossword-mode-plan.md §7.4, §8.4): the
 * filters and the skipped ids as a query string for GET
 * /api/crossword/approve/next. `parseQueueQuery` (route side) and
 * `queueQueryString` (page side) are inverses. Pure.
 */
import { BANK_ZIPF_BANDS, type BankPoolCounts, type BankQueueQuery, type BankQueueWord, type BankZipfBand } from "@photonsurge/shared/crossword-bank";

/** The operator's queue filters. */
export interface QueueFilters {
  band?: BankZipfBand;
  minLength?: number;
  maxLength?: number;
  /** Single letter A–Z. */
  startsWith?: string;
  withSuggestions?: boolean;
}

export const QUEUE_DEFAULT_LIMIT = 3;
const BAND_IDS: readonly string[] = [...BANK_ZIPF_BANDS.map((b) => b.id), "none"];
const OBJECT_ID = /^[0-9a-f]{24}$/i;

const len = (v: string | null): number | undefined => {
  const n = v == null ? NaN : Number(v);
  return Number.isInteger(n) && n >= 3 && n <= 12 ? n : undefined;
};

type ParamsLike = Pick<URLSearchParams, "get">;

/** The repo's queue query from a request's query string. Unknown or malformed values are dropped. */
export function parseQueueQuery(sp: ParamsLike, maxLimit: number): BankQueueQuery {
  const q: BankQueueQuery = { limit: QUEUE_DEFAULT_LIMIT };
  const band = sp.get("band");
  if (band && BAND_IDS.includes(band)) q.band = band as BankZipfBand;
  const min = len(sp.get("min"));
  if (min) q.minLength = min;
  const max = len(sp.get("max"));
  if (max) q.maxLength = max;
  const letter = (sp.get("letter") ?? "").trim().toUpperCase();
  if (/^[A-Z]$/.test(letter)) q.startsWith = letter;
  const s = sp.get("suggestions");
  if (s === "1" || s === "true") q.withSuggestions = true;
  const exclude = (sp.get("exclude") ?? "").split(",").map((x) => x.trim()).filter((x) => OBJECT_ID.test(x));
  if (exclude.length) q.excludeIds = [...new Set(exclude)].slice(0, 1000);
  const limit = Number(sp.get("limit"));
  if (Number.isInteger(limit) && limit >= 1) q.limit = Math.min(maxLimit, limit);
  return q;
}

/** The query string for GET /api/crossword/approve/next (no leading `?`). */
export function queueQueryString(f: QueueFilters, excludeIds: readonly string[] = [], limit = QUEUE_DEFAULT_LIMIT): string {
  const sp = new URLSearchParams();
  if (f.band) sp.set("band", f.band);
  if (f.minLength) sp.set("min", String(f.minLength));
  if (f.maxLength) sp.set("max", String(f.maxLength));
  if (f.startsWith) sp.set("letter", f.startsWith);
  if (f.withSuggestions) sp.set("suggestions", "1");
  if (excludeIds.length) sp.set("exclude", excludeIds.join(","));
  sp.set("limit", String(limit));
  return sp.toString();
}

/** GET /api/crossword/approve/next. */
export interface ApproveNextResponse {
  words: BankQueueWord[];
  pool: BankPoolCounts;
}
