/**
 * The two dedicated scenes scripted short videos play on
 * (docs/short-video-plan.md §3 "Fixed scenes, not one per script"):
 *
 *  • `shorts`         — the render scene. A render run's encoder captures
 *                       /watch/shorts while the script plays, and its director
 *                       config carries the thresholds and holds the lineup
 *                       template reads (worker/src/director/script-generate.ts).
 *  • `shorts-preview` — the editor's preview (/watch/shorts-preview in an
 *                       iframe), so trying a script never touches a render.
 *
 * Both are `hidden`: production surfaces, not channels, so they stay off the
 * public home page and the channel launcher.
 *
 * Pure catalog data, like simple-scenes.ts:
 * `worker/src/scripts/seedShortScenes.ts` creates them. Everything after the
 * seed (brand, look, widgets, pace) is edited on /admin/scenes/:id like any
 * other scene.
 */
import { DEFAULT_AUDIO_SETTINGS, type ControlState } from "./control";

/** Scene id of the render scene (also the generate job's default config source). */
export const SHORTS_SCENE_ID = "shorts";
/** Scene id of the editor's preview scene (the play CLI's default). */
export const SHORTS_PREVIEW_SCENE_ID = "shorts-preview";

export interface ShortScenePreset {
  /** Scene id → /watch/<id>. */
  id: string;
  /** Scene name shown in admin pickers ("Shorts ·" prefix groups them). */
  name: string;
  /** Kept off viewer-facing scene lists (scene metadata, not ControlState). */
  hidden: true;
  seed: Partial<ControlState>;
}

/**
 * A clean round-up video: the main scene's on-air chrome (the ControlState
 * defaults — chrome, atmosphere, city labels) with the music bed on, since a
 * video has no presenter (§4 "No narration in v1. The audio bed plays").
 * No spin: the script's shots drive the camera. The director config is left at
 * its defaults — mode `off` (the runner sets `script` per play), default kinds
 * and holds.
 */
const ROUNDUP_LOOK: Partial<ControlState> = {
  audio: { ...DEFAULT_AUDIO_SETTINGS, enabled: true },
};

export const SHORT_SCENE_PRESETS: ShortScenePreset[] = [
  { id: SHORTS_SCENE_ID, name: "Shorts · Render", hidden: true, seed: ROUNDUP_LOOK },
  { id: SHORTS_PREVIEW_SCENE_ID, name: "Shorts · Preview", hidden: true, seed: ROUNDUP_LOOK },
];
