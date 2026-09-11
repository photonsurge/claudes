import { getAppDb } from "@photonsurge/shared/db/index";
import { runIsActive } from "@photonsurge/shared/runs";
import { getVideoStats, getYoutubeClient } from "./client";
import { stampVideoTimes } from "./video-times";

interface VideoStats {
  views?: string;
  likes?: string;
  watchingNow?: string;
  fetchedAt?: number;
  error?: string;
}
const cache = new Map<string, { stats: VideoStats; retryAt: number; active: boolean }>();
let pending: Promise<Record<string, VideoStats>> | undefined;

/** One shared refresh across admin tabs. Cache live counters for a minute, archives for 15 minutes. */
export function streamVideoStats(): Promise<Record<string, VideoStats>> {
  if (!pending) pending = refresh().finally(() => { pending = undefined; });
  return pending;
}

async function refresh(): Promise<Record<string, VideoStats>> {
  const db = await getAppDb();
  const runs = (await db.listRuns()).filter((r) => r.platforms.youtube?.broadcastId);
  const now = Date.now();
  const keys = new Set(runs.map((r) => r.id));
  for (const key of cache.keys()) if (!keys.has(key)) cache.delete(key);
  const groups = new Map<string, typeof runs>();
  for (const run of runs) {
    const cached = cache.get(run.id);
    if (cached && cached.retryAt > now && cached.active === runIsActive(run.status)) continue;
    const account = run.platforms.youtube!.accountId || run.platforms.youtube!.channelId || "";
    const group = groups.get(account) ?? [];
    group.push(run);
    groups.set(account, group);
  }
  await Promise.all([...groups].map(async ([account, group]) => {
    for (let offset = 0; offset < group.length; offset += 50) {
      const batch = group.slice(offset, offset + 50);
      try {
        const ctx = await getYoutubeClient(account || undefined);
        const videos = await getVideoStats(ctx, [...new Set(batch.map((r) => r.platforms.youtube!.broadcastId!))]);
        const fetchedAt = Date.now();
        for (const run of batch) {
          const video = videos.find((v) => v.id === run.platforms.youtube!.broadcastId);
          const active = runIsActive(run.status);
          const live = video?.liveStreamingDetails;
          // VOD time base for the as-run pages — this poll already carries the
          // instants, so stamping them here costs nothing (writes only when new).
          await stampVideoTimes(db, run, video);
          cache.set(run.id, {
            active,
            retryAt: fetchedAt + (active ? 60_000 : 15 * 60_000),
            stats: video ? {
              views: video.statistics?.viewCount ?? undefined,
              likes: video.statistics?.likeCount ?? undefined,
              watchingNow: run.status === "live" && !live?.actualEndTime ? live?.concurrentViewers ?? undefined : undefined,
              fetchedAt,
            } : { error: "Video unavailable", fetchedAt },
          });
        }
      } catch {
        // Preserve useful previous counts, but never present old concurrent viewers as current.
        for (const run of batch) {
          cache.set(run.id, {
            active: runIsActive(run.status), retryAt: Date.now() + 60_000,
            stats: { ...cache.get(run.id)?.stats, watchingNow: undefined, error: "YouTube stats temporarily unavailable" },
          });
        }
      }
    }
  }));
  return Object.fromEntries(runs.map((r) => [r.id, cache.get(r.id)!.stats]));
}
