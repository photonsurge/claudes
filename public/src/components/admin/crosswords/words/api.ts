/**
 * Client calls for the Words admin: the list (filters forwarded as the page's
 * own query string), one word's detail, and the approval decisions on a word
 * or a clue (shared with the approval queue).
 */
import type { BankApprovalStatus, BankWordDetail, BankWordQuery } from "@photonsurge/shared/crossword-bank";
import { bankQueryString, type BankWordsResponse } from "./query";

export type Outcome<T> = { ok: true; data: T } | { ok: false; error: string };

async function call<T>(url: string, patch?: unknown, headers: Record<string, string> = {}): Promise<Outcome<T>> {
  try {
    const res = await fetch(
      url,
      patch === undefined
        ? { cache: "no-store" }
        : { method: "PATCH", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(patch), cache: "no-store" },
    );
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: body?.error || `HTTP ${res.status}` };
    return { ok: true, data: body as T };
  } catch (err) {
    return { ok: false, error: String((err as Error)?.message ?? err) };
  }
}

export function getBankWords(q: BankWordQuery): Promise<Outcome<BankWordsResponse>> {
  const qs = bankQueryString(q);
  return call(`/api/crossword/words${qs ? `?${qs}` : ""}`);
}

export function getBankWord(id: string): Promise<Outcome<BankWordDetail>> {
  return call(`/api/crossword/words/${encodeURIComponent(id)}`);
}

/** PATCH /api/crossword/words/:id body. */
export interface WordPatch {
  approval?: BankApprovalStatus;
  familyFriendly?: boolean | null;
  /** Save the stored suggestion as a new pending clue. */
  acceptSuggestion?: true;
}
/** PATCH /api/crossword/clues/:id body. */
export interface CluePatch {
  text?: string;
  approval?: BankApprovalStatus;
  familyFriendly?: boolean | null;
}

/** Decide on a word; answers with the updated detail. */
export function patchBankWord(id: string, patch: WordPatch): Promise<Outcome<BankWordDetail>> {
  return call(`/api/crossword/words/${encodeURIComponent(id)}`, patch);
}

/**
 * Decide on or edit a clue. `wordId` (sent as the X-Word-Id header) is the
 * clue's word: with it the route checks the clue (`validateClue`) before
 * approving it.
 */
export function patchBankClue(id: string, patch: CluePatch, wordId?: string): Promise<Outcome<{ ok: true }>> {
  return call(`/api/crossword/clues/${encodeURIComponent(id)}`, patch, wordId ? { "X-Word-Id": wordId } : {});
}

/** Queue `crossword.suggest` for these words (at most 50). Answers at once; suggestions land later. */
export async function postSuggest(wordIds: string[]): Promise<Outcome<{ queued: true; count: number }>> {
  try {
    const res = await fetch("/api/crossword/suggest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ wordIds }),
      cache: "no-store",
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: body?.error || `HTTP ${res.status}` };
    return { ok: true, data: body };
  } catch (err) {
    return { ok: false, error: String((err as Error)?.message ?? err) };
  }
}

/** How often, and how many times, a page refetches while a suggest job runs. */
export const SUGGEST_POLL_MS = 4000;
export const SUGGEST_POLL_MAX = 15;

/** Path of a word's detail page. */
export const wordHref = (id: string) => `/admin/crosswords/words/${encodeURIComponent(id)}`;
