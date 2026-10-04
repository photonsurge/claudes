/** Client call for the approval queue: the next words. Decisions use the Words api. */
import type { Outcome } from "../words/api";
import { QUEUE_DEFAULT_LIMIT, queueQueryString, type ApproveNextResponse, type QueueFilters } from "./query";

export async function getQueue(
  filters: QueueFilters,
  excludeIds: readonly string[],
  limit = QUEUE_DEFAULT_LIMIT,
): Promise<Outcome<ApproveNextResponse>> {
  try {
    const res = await fetch(`/api/crossword/approve/next?${queueQueryString(filters, excludeIds, limit)}`, { cache: "no-store" });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: body?.error || `HTTP ${res.status}` };
    return { ok: true, data: body as ApproveNextResponse };
  } catch (err) {
    return { ok: false, error: String((err as Error)?.message ?? err) };
  }
}
