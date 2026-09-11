/**
 * The as-run bundle of one streaming run: its video's time base + window, and
 * the director's cuts placed on it. Shared by public's /api/streams/:id/asrun
 * (the admin page) and the worker's chapters job so both see the SAME timeline.
 * Server-only (it reads the log through the db handle it's given) — the
 * browser-side helpers stay in ./vod.
 */
import type { iAirEntry } from "./db/air-log-model";
import type { AirLogRepo } from "./db/air-log-repo";
import { runIsActive, type Run } from "./runs";
import { buildAsRunTimeline, videoStartOnOurClock, videoTimeBase, type AsRunItem, type VideoTimeBase } from "./vod";

export interface AsRunTimeline {
  /** Null when the run never went live. */
  base: VideoTimeBase | null;
  /** Our-clock span of the video; `toMs` null while live; null when never live. */
  window: { fromMs: number; toMs: number | null } | null;
  /** Director sessions (AirRun ids) the video drew from, in air order. */
  sessions: string[];
  kindCounts: Record<string, number>;
  items: AsRunItem<iAirEntry>[];
}

/** Pipeline delay from the environment (see VOD_LEAD_MS in .env.sample). */
export function vodLeadMsFromEnv(env: Record<string, string | undefined> = process.env): number {
  const n = Number(env.VOD_LEAD_MS ?? 0);
  return Number.isFinite(n) ? n : 0;
}

export async function loadAsRunTimeline(
  airLog: Pick<AirLogRepo, "listEntriesInWindow">,
  run: Run,
  opts: { leadMs?: number; nowMs?: number } = {},
): Promise<AsRunTimeline> {
  const leadMs = opts.leadMs ?? 0;
  const now = opts.nowMs ?? Date.now();
  const base = videoTimeBase(run);
  if (!base) return { base: null, window: null, sessions: [], kindCounts: {}, items: [] };

  const live = runIsActive(run.status);
  const fromMs = videoStartOnOurClock(base.baseMs, leadMs);
  const endMs = run.platforms?.youtube?.actualEndTime ?? run.endedAt ?? now;
  const toMs = live ? null : videoStartOnOurClock(endMs, leadMs);
  const entries = await airLog.listEntriesInWindow({
    sceneId: run.sceneId,
    from: new Date(fromMs),
    to: new Date(toMs ?? now),
  });
  const items = buildAsRunTimeline(entries, { fromMs, toMs, baseMs: base.baseMs, leadMs, nowMs: now });

  const sessions: string[] = [];
  const kindCounts: Record<string, number> = {};
  for (const item of items) {
    if (item.type !== "cut") continue;
    if (!sessions.includes(item.entry.runId)) sessions.push(item.entry.runId);
    kindCounts[item.entry.kind] = (kindCounts[item.entry.kind] ?? 0) + 1;
  }
  return { base, window: { fromMs, toMs }, sessions, kindCounts, items };
}
