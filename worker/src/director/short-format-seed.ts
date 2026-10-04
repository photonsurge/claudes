/**
 * Seed the default short format (docs/short-video-plan.md §5.6): its hidden
 * scene `shorts` (`kind: "short"`, look SHORT_SCENE_SEED, a default director
 * config — mode off, a play sets `script` itself) and its short settings
 * (`defaultShortFormat`). Scripts with no format play there.
 *
 * Existing things are SKIPPED so a re-run never clobbers an operator's edits:
 * an existing scene only has its metadata (re)asserted — hidden, kind short —
 * which touches nothing on air, and existing settings are left as they are.
 * `force` re-applies the seed look to the scene (never the settings).
 *
 * The retired `shorts-preview` scene is no longer created; one that exists is
 * left alone, an ordinary scene to delete from /admin/scenes.
 *
 * Shared by the `yarn seed:short-format` one-shot and the admin "Seed default
 * short format" button (jobs/short-video.ts#seedFormat), so both run the exact
 * same code.
 */
import type { AppDb } from "@photonsurge/shared/db/index";
import { sceneKindOf } from "@photonsurge/shared/control";
import { defaultShortFormat } from "@photonsurge/shared/short-format";
import { DEFAULT_SHORT_FORMAT_ID, DEFAULT_SHORT_FORMAT_NAME, SHORT_SCENE_SEED } from "@photonsurge/shared/short-scenes";

export type ShortSceneSeedOutcome = "created" | "re-applied" | "skipped" | "marked short";
export type ShortSettingsSeedOutcome = "created" | "skipped";

export interface ShortFormatSeedResult {
  /** The format's id, = its scene's id. */
  id: string;
  name: string;
  scene: ShortSceneSeedOutcome;
  settings: ShortSettingsSeedOutcome;
}

export async function seedShortFormat(db: AppDb, opts: { force?: boolean } = {}): Promise<ShortFormatSeedResult> {
  const id = DEFAULT_SHORT_FORMAT_ID;
  const settingsDoc = await db.shortFormats.get(id);
  // An operator may have renamed the format; the scene keeps its name then.
  const name = settingsDoc?.name ?? DEFAULT_SHORT_FORMAT_NAME;

  const existing = await db.getScene(id);
  let scene: ShortSceneSeedOutcome;
  if (existing && !opts.force) {
    const unmarked = existing.hidden !== true || sceneKindOf(existing) !== "short";
    if (unmarked) await db.setSceneMeta(id, { hidden: true, kind: "short" });
    scene = unmarked ? "marked short" : "skipped";
  } else {
    // spinEpoch anchors the deterministic spin; stamp it at seed time.
    await db.createScene(id, name, { ...SHORT_SCENE_SEED, spinEpoch: Date.now() }, { hidden: true, kind: "short" });
    await db.getOrInitDirectorConfig(id); // defaults if absent; never overwrites
    scene = existing ? "re-applied" : "created";
  }

  let settings: ShortSettingsSeedOutcome = "skipped";
  if (!settingsDoc) {
    await db.shortFormats.upsert(defaultShortFormat(id, name));
    // The scene name is what pickers and the chapter label show — the format's.
    if (existing && existing.name !== name) await db.setSceneMeta(id, { name });
    settings = "created";
  }
  return { id, name, scene, settings };
}
