/**
 * Client helpers + types for the round-ups admin screen. Fetches from
 * /api/admin/summaries; re-exports the shared model shapes so the page has one
 * import for both.
 */
export type {
  SummaryPeriod,
  NarrativeStatus,
  iEventSummaryModel as EventSummary,
  iSummaryStats as SummaryStats,
  iSummaryHotspot as SummaryHotspot,
  iSummaryTopEvent as SummaryTopEvent,
} from "@photonsurge/shared/db/event-summary-model";

import type { SummaryPeriod, iEventSummaryModel } from "@photonsurge/shared/db/event-summary-model";

export interface SummariesResponse {
  period: SummaryPeriod;
  latest: iEventSummaryModel | null;
  history: iEventSummaryModel[];
}

/** Latest round-up + recent history for a cadence. */
export async function getSummaries(
  period: SummaryPeriod,
  history = 10,
): Promise<SummariesResponse> {
  const res = await fetch(`/api/admin/summaries?period=${period}&history=${history}`, {
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`summaries fetch failed: ${res.status}`);
  return res.json();
}

/** Cadence tab metadata. */
export const SUMMARY_PERIODS: { id: SummaryPeriod; label: string; jobId: string }[] = [
  { id: "hourly", label: "Hourly", jobId: "summaries-hourly" },
  { id: "12h", label: "12-hour", jobId: "summaries-12h" },
  { id: "daily", label: "Daily", jobId: "summaries-daily" },
];
