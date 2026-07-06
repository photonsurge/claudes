/**
 * Auto-director config jobs (worker side of the admin "Director" button):
 *
 *  • seedSlides — backfill DEFAULT_KIND_SLIDES onto every scene's director
 *    config, so a fresh "Look per shot type" panel has a starter library.
 *    Schema/DEFAULT_DIRECTOR_CONFIG defaults only populate a doc at insert
 *    time, never on read of a pre-existing one, so a scene created before
 *    these slides existed needs an explicit backfill (same gap as
 *    broadcastState.watchToken / ensureWatchToken). Non-destructive and
 *    repeatable: only fills a kind whose slide list is currently empty, so
 *    it never clobbers slides the operator has since saved.
 *
 * `seedKindSlides` is exported so the `yarn seed:director-slides` one-shot
 * script runs the exact same code as the button.
 */
import type { Job } from "bullmq";
import { getAppDb } from "@photonsurge/shared/db/index";
import { DEFAULT_KIND_SLIDES, SEGMENT_KINDS, type KindSlide, type SegmentKind } from "@photonsurge/shared/director";
import { log } from "@photonsurge/shared/utill/logger";
import { blogInfo, blogErr } from "../blog";
import { summarizeForLog } from "../utils";

const TAG = "job:director";

/** Backfill DEFAULT_KIND_SLIDES onto every scene missing a kind's slide list. */
export async function seedKindSlides() {
  const db = await getAppDb();
  const scenes = await db.listScenes();

  const seeded: Record<string, string[]> = {};
  for (const scene of scenes) {
    const cfg = await db.getOrInitDirectorConfig(scene.id);
    const patch: Partial<Record<SegmentKind, KindSlide[]>> = {};
    for (const kind of SEGMENT_KINDS) {
      const seed = DEFAULT_KIND_SLIDES[kind];
      if (!seed || (cfg.kindSlides[kind] ?? []).length > 0) continue;
      patch[kind] = seed;
    }
    if (Object.keys(patch).length === 0) continue;
    await db.saveDirectorConfig(scene.id, { kindSlides: patch });
    seeded[scene.id] = Object.keys(patch);
  }

  const result = { scenes: scenes.length, seeded };
  log(TAG, "seedSlides done", result);
  return result;
}

/** Job handler: `director.seedSlides` — the admin "Seed look slides" button. */
export async function seedSlides(_job: Job) {
  try {
    const result = await seedKindSlides();
    const kinds = Object.values(result.seeded).flat().length;
    blogInfo(TAG, `director slides seeded: ${kinds} kind(s) across ${Object.keys(result.seeded).length} scene(s)`, result, "director", "seedSlides");
    return result;
  } catch (err) {
    log(TAG, "seedSlides failed", { err: summarizeForLog(err) });
    blogErr(TAG, "director slide seeding failed", err, "director", "seedSlides");
    throw err;
  }
}
