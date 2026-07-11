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

import { useEffect, useState } from "react";
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

/** Just the latest round-up for a cadence — the broadcast frame's world-spin
 *  deck slide (no history needed). Fetches the public /api/roundup/latest. */
export async function getLatestRoundup(
  period: SummaryPeriod = "hourly",
): Promise<iEventSummaryModel | null> {
  const res = await fetch(`/api/roundup/latest?period=${period}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`roundup fetch failed: ${res.status}`);
  const body = (await res.json()) as { latest: iEventSummaryModel | null };
  return body.latest;
}

/** Poll the latest round-up so world spins carry the current narrative + stats.
 *  Round-ups regenerate hourly, so a 5-minute refresh is plenty. */
export function useLatestRoundup(period: SummaryPeriod = "hourly"): iEventSummaryModel | null {
  const [roundup, setRoundup] = useState<iEventSummaryModel | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      getLatestRoundup(period)
        .then((r) => {
          if (!cancelled) setRoundup(r);
        })
        .catch(() => {});
    load();
    const timer = setInterval(load, 5 * 60 * 1000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [period]);

  return roundup;
}

/** Cadence tab metadata. */
export const SUMMARY_PERIODS: { id: SummaryPeriod; label: string; jobId: string }[] = [
  { id: "hourly", label: "Hourly", jobId: "summaries-hourly" },
  { id: "12h", label: "12-hour", jobId: "summaries-12h" },
  { id: "daily", label: "Daily", jobId: "summaries-daily" },
];
