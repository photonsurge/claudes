/**
 * Client calls for the Words admin: the list (filters forwarded as the page's
 * own query string), one word's detail, and the approval decisions on a word
 * or a clue (shared with the approval queue).
 */
import type { BankApprovalStatus, BankWordDetail, BankWordQuery } from "@photonsurge/shared/crossword-bank";
import { bankQueryString, type BankWordsResponse } from "./query";

export type Outcome<T> = { ok: true; data: T } | { ok: false; error: string };

async function call<T>(url: string, patch?: unknown): Promise<Outcome<T>> {
  try {
    const res = await fetch(
      url,
      patch === undefined
        ? { cache: "no-store" }
        : { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch), cache: "no-store" },
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

/** Decide on or edit a clue. */
export function patchBankClue(id: string, patch: CluePatch): Promise<Outcome<{ ok: true }>> {
  return call(`/api/crossword/clues/${encodeURIComponent(id)}`, patch);
}

/** Path of a word's detail page. */
export const wordHref = (id: string) => `/admin/crosswords/words/${encodeURIComponent(id)}`;
