/**
 * Seed the two scenes scripted short videos play on (shared SHORT_SCENE_PRESETS):
 * `shorts` (render) and `shorts-preview` (the editor's preview), both HIDDEN
 * from the public home page and the channel launcher. Each gets the default
 * director config if it has none (mode off — a play sets `script` itself;
 * default kinds and holds).
 *
 * Existing scenes are SKIPPED so a re-run never clobbers an operator's edits on
 * /admin/scenes/:id; only the `hidden` flag is (re)asserted on them, which
 * touches nothing on air. `force` re-applies the preset look as well.
 *
 * Shared by the `yarn seed:short-scenes` one-shot and the admin "Seed short
 * video scenes" button (jobs/short-video.ts#seedScenes), so both run the exact
 * same code.
 */
import type { AppDb } from "@photonsurge/shared/db/index";
import { SHORT_SCENE_PRESETS } from "@photonsurge/shared/short-scenes";

export type ShortSceneSeedOutcome = "created" | "re-applied" | "skipped" | "marked hidden";

export interface ShortSceneSeedResult {
  scenes: { id: string; name: string; outcome: ShortSceneSeedOutcome }[];
}

export async function seedShortScenes(db: AppDb, opts: { force?: boolean } = {}): Promise<ShortSceneSeedResult> {
  const scenes: ShortSceneSeedResult["scenes"] = [];
  for (const preset of SHORT_SCENE_PRESETS) {
    const existing = await db.getScene(preset.id);
    if (existing && !opts.force) {
      const wasVisible = existing.hidden !== preset.hidden;
      if (wasVisible) await db.setSceneHidden(preset.id, preset.hidden);
      scenes.push({ id: preset.id, name: preset.name, outcome: wasVisible ? "marked hidden" : "skipped" });
      continue;
    }
    // spinEpoch anchors the deterministic spin; stamp it at seed time.
    await db.createScene(preset.id, preset.name, { ...preset.seed, spinEpoch: Date.now() }, { hidden: preset.hidden });
    await db.getOrInitDirectorConfig(preset.id); // defaults if absent; never overwrites
    scenes.push({ id: preset.id, name: preset.name, outcome: existing ? "re-applied" : "created" });
  }
  return { scenes };
}
