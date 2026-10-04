/**
 * Crossword puzzle building (docs/crossword-mode-plan.md §7) — the job
 * handlers, re-exported by jobs/crossword.ts.
 *
 *  • generate — build one puzzle for a scene from approved words and clues
 *    (`CrosswordGenerateRequest`: `{ sceneId, seed? }`). See build.ts.
 *  • topUp — one build for each enabled crossword scene short of stock, when
 *    the pool can supply one (repeatable, every 30 minutes, and a button on
 *    /admin/jobs).
 *  • bankIndex — build the imported word bank's indexes and drop the legacy
 *    pick index. Idempotent.
 *  • writeClues — the Words page's "Write clues" (WP11, not built yet).
 *
 * Only the handlers are re-exported from jobs/crossword.ts; the work lives in
 * build.ts so the scripts run the exact same code.
 */
import { UnrecoverableError, type Job } from "bullmq";
import { getAppDb } from "@photonsurge/shared/db/index";
import type { CrosswordGenerateRequest } from "@photonsurge/shared/crossword";
import { log } from "@photonsurge/shared/utill/logger";
import { buildPuzzle, indexBank, topUpScenes } from "./build";
import { blogInfo, blogErr, blogWarn } from "../blog";
import { summarizeForLog } from "../utils";

const TAG = "job:crossword";

/** Job handler: `crossword.generate` — build one puzzle for a scene. */
export async function generate(job: Job) {
  const req = (job.data?.data ?? {}) as CrosswordGenerateRequest;
  try {
    const db = await getAppDb();
    const r = await buildPuzzle(db, req);
    const result = {
      id: r.puzzle.id,
      title: r.puzzle.title,
      words: r.puzzle.entries.length,
      size: `${r.puzzle.width}x${r.puzzle.height}`,
      status: r.puzzle.status,
      familyFriendly: r.puzzle.familyFriendly,
      source: r.source,
      seed: r.seed,
      available: r.available,
      ...(r.unapproved ? { unapproved: true } : {}),
    };
    log(TAG, "generate done", result);
    blogInfo(TAG, `crossword built: ${r.puzzle.title} (${r.puzzle.entries.length} words${r.puzzle.familyFriendly ? ", family friendly" : ""})`, result, "crossword", r.puzzle.id);
    return result;
  } catch (err) {
    log(TAG, "generate failed", { err: summarizeForLog(err), sceneId: req.sceneId });
    blogErr(TAG, "crossword build failed", err, "crossword", req.sceneId ?? "generate");
    // An operator is usually waiting on this one (Generate now), and a failed
    // build is the bank or the config, not a blip: a retry repeats the answer.
    throw new UnrecoverableError((err as Error)?.message ?? String(err));
  }
}

/** Job handler: `crossword.topUp` — one build per enabled crossword scene short of stock. */
export async function topUp(_job: Job) {
  try {
    const db = await getAppDb();
    const scenes = await topUpScenes(db);
    const result = { scenes };
    log(TAG, "topUp done", result);
    const built = scenes.filter((s) => s.outcome === "built").length;
    const failed = scenes.filter((s) => s.outcome === "failed");
    // A skip is the pool being too small, not a fault: logged each run, not blogged.
    for (const s of scenes) if (s.outcome === "skipped") log(TAG, "topUp skipped", { sceneId: s.sceneId, reason: s.reason });
    if (failed.length) {
      blogWarn(TAG, `crossword top-up: ${failed.length} scene(s) failed to build`, result, "crossword", "topUp");
    } else if (built) {
      blogInfo(TAG, `crossword top-up built ${built} puzzle(s)`, result, "crossword", "topUp");
    }
    return result;
  } catch (err) {
    log(TAG, "topUp failed", { err: summarizeForLog(err) });
    blogErr(TAG, "crossword top-up failed", err, "crossword", "topUp");
    throw err;
  }
}

/** Job handler: `crossword.bankIndex` — the word bank's indexes (safe to re-run). */
export async function bankIndex(_job: Job) {
  try {
    const db = await getAppDb();
    const result = await indexBank(db);
    log(TAG, "bankIndex done", result);
    blogInfo(TAG, `crossword bank indexed (${result.indexes.length} indexes${result.dropped.length ? `, dropped ${result.dropped.join(", ")}` : ""})`, result, "crossword", "bankIndex");
    return result;
  } catch (err) {
    log(TAG, "bankIndex failed", { err: summarizeForLog(err) });
    blogErr(TAG, "crossword bank index failed", err, "crossword", "bankIndex");
    throw err;
  }
}

/** Job handler: `crossword.writeClues` — WP11. */
export async function writeClues(_job: Job) {
  throw new UnrecoverableError("crossword.writeClues is not built yet (WP11)");
}
