/**
 * Client calls for the Words admin: the list (filters forwarded as the page's
 * own query string) and one word's detail.
 */
import type { BankWordDetail, BankWordQuery } from "@photonsurge/shared/crossword-bank";
import { bankQueryString, type BankWordsResponse } from "./query";

export type Outcome<T> = { ok: true; data: T } | { ok: false; error: string };

async function call<T>(url: string): Promise<Outcome<T>> {
  try {
    const res = await fetch(url, { cache: "no-store" });
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

/** Path of a word's detail page. */
export const wordHref = (id: string) => `/admin/crosswords/words/${encodeURIComponent(id)}`;
