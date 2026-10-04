/**
 * The default short format's scene (docs/short-video-plan.md §5.6).
 *
 * Every short plays on its FORMAT's own scene — preview and render alike — and a
 * format's id is its scene's id (shared/src/short-format.ts). The default format
 * lives on `shorts`, the scene the first release played everything on; the
 * seed (worker/src/director/short-format-seed.ts) creates it with this look.
 * The old `shorts-preview` scene is retired: the seed no longer creates it, and
 * an existing one is an ordinary scene to delete from /admin/scenes.
 *
 * Format scenes are `hidden` (off the public home page and the channel
 * launcher) and `kind: "short"` (off /admin/scenes and the stream and slot
 * forms — /admin/shorts lists them as formats).
 */
import { DEFAULT_AUDIO_SETTINGS, type ControlState } from "./control";

/** Scene id of the default format's scene — and so the default format's id. */
export const SHORTS_SCENE_ID = "shorts";

/** The id of the format a script with none uses (= its scene id). */
export const DEFAULT_SHORT_FORMAT_ID = SHORTS_SCENE_ID;

/** Name of the default format (and its scene, which the chapter job's opening label reads). */
export const DEFAULT_SHORT_FORMAT_NAME = "Round-up";

/**
 * A clean round-up video: the main scene's on-air chrome (the ControlState
 * defaults — chrome, atmosphere, city labels) with the music bed on, since a
 * video has no presenter (§4 "No narration yet: the music bed plays").
 * No spin: the script's shots drive the camera. The director config is left at
 * its defaults — mode `off` (the runner sets `script` per play), default kinds
 * and holds.
 */
export const SHORT_SCENE_SEED: Partial<ControlState> = {
  audio: { ...DEFAULT_AUDIO_SETTINGS, enabled: true },
};
