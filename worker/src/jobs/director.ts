/**
 * Auto-director config jobs (worker side of the admin "Director" buttons):
 *
 *  • seedSlides  — backfill DEFAULT_KIND_SLIDES onto every scene's director
 *    config, so a fresh "Look per shot type" panel has a starter library.
 *    Schema/DEFAULT_DIRECTOR_CONFIG defaults only populate a doc at insert
 *    time, never on read of a pre-existing one, so a scene created before
 *    these slides existed needs an explicit backfill (same gap as
 *    broadcastState.watchToken / ensureWatchToken). Non-destructive and
 *    repeatable: only fills a kind whose slide list is currently empty, so
 *    it never clobbers slides the operator has since saved.
 *  • clearSlides — wipe every scene's saved-slide library back to empty, so
 *    a re-run of seedSlides lays down the current DEFAULT_KIND_SLIDES again
 *    (mainly for iterating on the starter set itself). Destructive: also
 *    drops any slide the operator saved by hand.
 *
 * `seedKindSlides`/`clearKindSlides` are exported so the `yarn
 * seed:director-slides`/`yarn clear:director-slides` one-shot scripts run
 * the exact same code as the buttons.
 */
import type { Job } from "bullmq";
import { getAppDb } from "@photonsurge/shared/db/index";
import { DEFAULT_KIND_SLIDES, SEGMENT_KINDS, type KindSlide, type SegmentKind } from "@photonsurge/shared/director";
import { log } from "@photonsurge/shared/utill/logger";
import { blogInfo, blogErr } from "../blog";
import { summarizeForLog } from "../utils";

const TAG = "job:director";

/**
 * Replace the retired seeded quake magnetic slide without disturbing slides an
 * operator created. Older scenes keep their saved library forever, so merely
 * removing this slide from DEFAULT_KIND_SLIDES was not enough.
 */
export function migrateLegacyQuakeSlides(slides: KindSlide[]): KindSlide[] {
  const legacyId = "quake-magnetic-signature";
  if (!slides.some((slide) => slide.id === legacyId)) return slides;

  const retained = slides.filter((slide) => slide.id !== legacyId);
  const ids = new Set(retained.map((slide) => slide.id));
  for (const slide of DEFAULT_KIND_SLIDES.quake ?? []) {
    if (!ids.has(slide.id)) retained.push(slide);
  }
  return retained;
}

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
    const quakeSlides = cfg.kindSlides.quake ?? [];
    const migratedQuakeSlides = migrateLegacyQuakeSlides(quakeSlides);
    const retiredQuakeSlideSelected = cfg.activeSlideId.quake === "quake-magnetic-signature";
    if (migratedQuakeSlides !== quakeSlides) patch.quake = migratedQuakeSlides;

    if (Object.keys(patch).length === 0 && !retiredQuakeSlideSelected) continue;
    await db.saveDirectorConfig(scene.id, {
      kindSlides: patch,
      ...(retiredQuakeSlideSelected
        ? {
            activeSlideId: { quake: null },
            overlayOverrides: {
              quake: { ...cfg.overlayOverrides.quake, showMagneticField: false },
            },
          }
        : {}),
    });
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

/** Wipe every scene's saved-slide library back to empty (per kind, only where non-empty). */
export async function clearKindSlides() {
  const db = await getAppDb();
  const scenes = await db.listScenes();

  const cleared: Record<string, string[]> = {};
  for (const scene of scenes) {
    const cfg = await db.getOrInitDirectorConfig(scene.id);
    const patch: Partial<Record<SegmentKind, KindSlide[]>> = {};
    for (const kind of SEGMENT_KINDS) {
      if ((cfg.kindSlides[kind] ?? []).length > 0) patch[kind] = [];
    }
    if (Object.keys(patch).length === 0) continue;
    await db.saveDirectorConfig(scene.id, { kindSlides: patch });
    cleared[scene.id] = Object.keys(patch);
  }

  const result = { scenes: scenes.length, cleared };
  log(TAG, "clearSlides done", result);
  return result;
}

/** Job handler: `director.clearSlides` — the admin "Clear look slides" button. */
export async function clearSlides(_job: Job) {
  try {
    const result = await clearKindSlides();
    const kinds = Object.values(result.cleared).flat().length;
    blogInfo(TAG, `director slides cleared: ${kinds} kind(s) across ${Object.keys(result.cleared).length} scene(s)`, result, "director", "clearSlides");
    return result;
  } catch (err) {
    log(TAG, "clearSlides failed", { err: summarizeForLog(err) });
    blogErr(TAG, "director slide clearing failed", err, "director", "clearSlides");
    throw err;
  }
}
