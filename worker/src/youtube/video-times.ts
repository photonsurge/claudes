/**
 * Stamp YouTube's own go-live / end instants onto a run — the VOD time base
 * for the as-run pages (docs/vod-as-run-plan.md, shared/vod.ts). Two callers,
 * both best-effort: the /admin/streams stats poll (which already fetches
 * liveStreamingDetails for every run, so the stamp costs no quota) and
 * finishRun (one videos.list so a video nobody watched the fleet page for
 * still gets its base). A run is only written when something is new.
 */
import type { youtube_v3 } from "googleapis";
import type { AppDb } from "@photonsurge/shared/db/index";
import type { Run } from "@photonsurge/shared/runs";
import { log } from "@photonsurge/shared/utill/logger";

const TAG = "youtube:video-times";

export interface VideoLiveTimes {
  actualStartTime?: number;
  actualEndTime?: number;
}

const epoch = (iso?: string | null): number | undefined => {
  if (!iso) return undefined;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) && t > 0 ? t : undefined;
};

/** The live instants a videos.list row carries, as epoch ms; empty when YouTube hasn't set them. */
export function videoLiveTimes(video: Pick<youtube_v3.Schema$Video, "liveStreamingDetails"> | undefined): VideoLiveTimes {
  const d = video?.liveStreamingDetails;
  const out: VideoLiveTimes = {};
  const start = epoch(d?.actualStartTime);
  const end = epoch(d?.actualEndTime);
  if (start) out.actualStartTime = start;
  if (end) out.actualEndTime = end;
  return out;
}

/** Which of the video's times the run doesn't have yet (or has differently). */
export function newVideoTimes(run: Run, times: VideoLiveTimes): VideoLiveTimes | null {
  const yt = run.platforms?.youtube;
  if (!yt) return null;
  const patch: VideoLiveTimes = {};
  if (times.actualStartTime && yt.actualStartTime !== times.actualStartTime) patch.actualStartTime = times.actualStartTime;
  if (times.actualEndTime && yt.actualEndTime !== times.actualEndTime) patch.actualEndTime = times.actualEndTime;
  return Object.keys(patch).length ? patch : null;
}

/** Persist the video's times onto the run when new. Never throws. Returns true when written. */
export async function stampVideoTimes(
  db: Pick<AppDb, "updateRun">,
  run: Run,
  video: Pick<youtube_v3.Schema$Video, "liveStreamingDetails"> | undefined,
): Promise<boolean> {
  const patch = newVideoTimes(run, videoLiveTimes(video));
  if (!patch) return false;
  try {
    await db.updateRun(run.id, {
      platforms: { ...run.platforms, youtube: { ...run.platforms.youtube, ...patch } },
    });
    return true;
  } catch (err) {
    log(TAG, `stamp failed ${run.id}`, String((err as Error)?.message ?? err));
    return false;
  }
}
