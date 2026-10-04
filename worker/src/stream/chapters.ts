/**
 * As-run chapters → YouTube video description (docs/vod-as-run-plan.md §4).
 *
 * When a YouTube run ends, the director's cuts for that video become a chapter
 * list ("0:00 Main · 3:12 🚨 M6.1 earthquake · Fiji …") appended to the video's
 * description under a "⏱ As aired" header. Whatever the operator wrote above
 * the header stays; re-publishing replaces only our block. The timeline is the
 * SAME shared loader the admin page reads, so the description and
 * /admin/streams/:id never disagree.
 *
 * Fired from finishRun as its own delayed + retried job (a YouTube hiccup must
 * never touch the finish path); the admin button awaits it with `force`.
 * Idempotent via `run.chapters.publishedAt`. 1 + 50 quota units per publish.
 */
import { getQueue } from "@photonsurge/shared/bull/bull";
import { getAppDb } from "@photonsurge/shared/db/index";
import { runIsFinished } from "@photonsurge/shared/runs";
import { log } from "@photonsurge/shared/utill/logger";
import { buildChapters, chapterBudget, composeDescription } from "@photonsurge/shared/vod";
import { loadAsRunTimeline, vodLeadMsFromEnv } from "@photonsurge/shared/vod-bundle";
import { getVideoStats, getYoutubeClient, setVideoDescription } from "../youtube/client";
import { stampVideoTimes } from "../youtube/video-times";

const TAG = "stream-chapters";
/** Let YouTube settle the broadcast's end instant before reading it back. */
const CHAPTERS_DELAY_MS = 30_000;

/** Kill switch for the automatic publish (YOUTUBE_CHAPTERS=off); the button ignores it. */
export function chaptersEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return (env.YOUTUBE_CHAPTERS ?? "on").trim().toLowerCase() !== "off";
}

export async function queueChapters(runId: string): Promise<void> {
  await getQueue("foreground").add(
    "do",
    { domain: "stream", type: "run-lifecycle", event: "chapters", data: { runId } },
    {
      delay: CHAPTERS_DELAY_MS,
      attempts: 5,
      backoff: { type: "exponential", delay: 60_000 },
      removeOnComplete: true,
      removeOnFail: true,
    },
  );
}

export interface ChaptersResult {
  ok: boolean;
  /** Why nothing was written, when that's fine (no video, still live, already done). */
  skipped?: string;
  count?: number;
  descriptionLength?: number;
  changed?: boolean;
  error?: string;
}

/**
 * Publish (or, with `force`, re-publish) a finished run's chapters. Resolves
 * with a structured skip when there's nothing to do; THROWS on a YouTube/Mongo
 * failure so the BullMQ attempts drive the retry (the run's `chapters.error`
 * records the last failure either way).
 */
export async function publishChapters(runId: string, opts: { force?: boolean } = {}): Promise<ChaptersResult> {
  const db = await getAppDb();
  let run = await db.getRun(runId);
  if (!run) return { ok: false, error: "no such run" };
  const yt = run.platforms?.youtube;
  if (!yt?.broadcastId) return { ok: false, skipped: "run has no YouTube video" };
  if (!runIsFinished(run.status)) return { ok: false, skipped: "run is still live" };
  if (run.chapters?.publishedAt && !opts.force) {
    return { ok: true, skipped: "already published", count: run.chapters.count };
  }

  try {
    const ctx = await getYoutubeClient(yt.accountId);

    // The VOD time base: make sure YouTube's own start/end instants are on the
    // run before placing cuts (finishRun stamps them, but the end can lag).
    if (!yt.actualStartTime || !yt.actualEndTime) {
      const [video] = await getVideoStats(ctx, [yt.broadcastId]);
      if (await stampVideoTimes(db, run, video)) run = (await db.getRun(runId)) ?? run;
    }

    const timeline = await loadAsRunTimeline(db.airLog, run, { leadMs: vodLeadMsFromEnv() });
    if (!timeline.window) return { ok: false, skipped: "run never went live" };

    const scenes = await db.listScenes();
    const openingLabel = scenes.find((s) => s.id === run!.sceneId)?.name ?? run.title ?? run.sceneId;

    let count = 0;
    const res = await setVideoDescription(ctx, yt.broadcastId, (existing) => {
      // A video render's chapters are its places, so they carry the place name
      // alone, not the shot's caption (short-video plan §4, several places).
      const chapters = buildChapters(timeline.items, {
        maxChars: chapterBudget(existing),
        openingLabel,
        subtitles: !run!.script,
      });
      count = chapters.length;
      return composeDescription(existing, chapters);
    });

    await db.updateRun(runId, { chapters: { publishedAt: Date.now(), count, error: null } });
    log(TAG, `run ${runId}: ${res.changed ? "published" : "unchanged"} ${count} chapters on ${yt.broadcastId}`);
    return { ok: true, count, changed: res.changed, descriptionLength: res.description.length };
  } catch (err) {
    const message = String((err as Error)?.message ?? err);
    await db
      .updateRun(runId, {
        chapters: { publishedAt: run.chapters?.publishedAt ?? null, count: run.chapters?.count ?? 0, error: message.slice(0, 300) },
      })
      .catch(() => {});
    log(TAG, `run ${runId}: chapters failed`, message);
    throw err;
  }
}
