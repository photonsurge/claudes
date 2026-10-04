/**
 * Scripted short videos (docs/short-video-plan.md) — the worker jobs.
 *
 *  • generate — write a draft ShortScript from the lineup template in a format
 *    (`{ formatId?, scope?, include?, budgetMs?, title? }`; absent fields come
 *    from the format's template). With no include switch on it's a round-up
 *    video, and fails when the scope has no usable round-up. See
 *    director/script-generate.ts.
 *  • seedFormat — create the default short format and its hidden scene
 *    (`shorts`). Skips what already exists; `{ force: true }` re-applies the
 *    seed look. See director/short-format-seed.ts.
 *
 * The job loader registers every export of this file as a handler, so it
 * exports handlers ONLY — helpers live in director/script-generate.ts.
 */
import { UnrecoverableError, type Job } from "bullmq";
import { getAppDb } from "@photonsurge/shared/db/index";
import { scriptDurationMs } from "@photonsurge/shared/short-script";
import { log } from "@photonsurge/shared/utill/logger";
import { generateShortScript, type GenerateRequest } from "../director/script-generate";
import { seedShortFormat } from "../director/short-format-seed";
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
    log(TAG, "generate failed", { err: summarizeForLog(err), formatId: req.formatId, scope: req.scope });
    blogErr(TAG, "short script generation failed", err, "short-video", "generate");
    // An operator is waiting on this job (/api/shorts/generate), and its
    // failures are things only they can fix — no round-up for the place, an
    // unknown scope. A retry would just repeat the same answer three times
    // before they see it, so every failure is terminal and reaches them at once.
    throw new UnrecoverableError((err as Error)?.message ?? String(err));
  }
}

/** Job handler: `short-video.seedFormat` — the admin "Seed default short format" button. */
export async function seedFormat(job: Job) {
  try {
    const db = await getAppDb();
    const result = await seedShortFormat(db, { force: job.data?.data?.force === true });
    log(TAG, "seedFormat done", result);
    const summary = `scene ${result.id}: ${result.scene}, settings: ${result.settings}`;
    blogInfo(TAG, `default short format seeded (${summary})`, result, "short-video", "seedFormat");
    return result;
  } catch (err) {
    log(TAG, "seedFormat failed", { err: summarizeForLog(err) });
    blogErr(TAG, "default short format seed failed", err, "short-video", "seedFormat");
    throw err;
  }
}
