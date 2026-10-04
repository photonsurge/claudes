/**
 * Scripted short videos (docs/short-video-plan.md) — the worker jobs.
 *
 *  • generate — write a draft ShortScript from the lineup template for a scope
 *    (`{ scope, include?, budgetMs?, title?, sceneId? }`). With no include
 *    switch on (the default) it's a round-up video, and fails when the scope
 *    has no usable round-up. See director/script-generate.ts.
 *  • seedScenes — create the two hidden scenes the videos play on (`shorts`,
 *    `shorts-preview`). Skips a scene that already exists; `{ force: true }`
 *    re-applies the preset look. See director/short-scenes-seed.ts.
 *
 * The job loader registers every export of this file as a handler, so it
 * exports handlers ONLY — helpers live in director/script-generate.ts.
 */
import { UnrecoverableError, type Job } from "bullmq";
import { getAppDb } from "@photonsurge/shared/db/index";
import { scriptDurationMs } from "@photonsurge/shared/short-script";
import { log } from "@photonsurge/shared/utill/logger";
import { generateShortScript, type GenerateRequest } from "../director/script-generate";
import { seedShortScenes } from "../director/short-scenes-seed";
import { blogInfo, blogErr } from "../blog";
import { summarizeForLog } from "../utils";

const TAG = "job:short-video";

/** Job handler: `short-video.generate` — write a draft script from the lineup template. */
export async function generate(job: Job) {
  const req = (job.data?.data ?? {}) as GenerateRequest;
  try {
    const db = await getAppDb();
    const script = await generateShortScript(db, req);
    const durationMs = scriptDurationMs(script.clips);
    const result = { id: script.id, title: script.title, clips: script.clips.length, durationMs };
    log(TAG, "generate done", result);
    blogInfo(TAG, `short script generated: ${script.title} (${script.clips.length} clips)`, result, "short-video", script.id);
    return result;
  } catch (err) {
    log(TAG, "generate failed", { err: summarizeForLog(err), scope: req.scope });
    blogErr(TAG, "short script generation failed", err, "short-video", "generate");
    // An operator is waiting on this job (/api/shorts/generate), and its
    // failures are things only they can fix — no round-up for the place, an
    // unknown scope. A retry would just repeat the same answer three times
    // before they see it, so every failure is terminal and reaches them at once.
    throw new UnrecoverableError((err as Error)?.message ?? String(err));
  }
}

/** Job handler: `short-video.seedScenes` — the admin "Seed short video scenes" button. */
export async function seedScenes(job: Job) {
  try {
    const db = await getAppDb();
    const result = await seedShortScenes(db, { force: job.data?.data?.force === true });
    log(TAG, "seedScenes done", result);
    const summary = result.scenes.map((s) => `${s.id}: ${s.outcome}`).join(", ");
    blogInfo(TAG, `short video scenes seeded (${summary})`, result, "short-video", "seedScenes");
    return result;
  } catch (err) {
    log(TAG, "seedScenes failed", { err: summarizeForLog(err) });
    blogErr(TAG, "short video scene seed failed", err, "short-video", "seedScenes");
    throw err;
  }
}
