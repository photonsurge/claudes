/**
 * Which scene a script plays on when it renders (docs/short-video-plan.md §6.4).
 * Render never names a scene itself; it asks this one adapter, so it builds on
 * either side of the formats merge.
 *
 * Today: the script's format id (a format's id IS its scene id, §5.2), else the
 * default short scene `shorts`. After the formats branch (WP5) merges, this
 * delegates to the shared `sceneIdForScript(script)` it adds to
 * shared/src/short-script.ts — replace the body with that call.
 */
import { SHORTS_SCENE_ID } from "@photonsurge/shared/short-scenes";

export const sceneForScript = (s: { formatId?: string }): string => s.formatId || SHORTS_SCENE_ID;

/** The format a script renders in — the same id as its scene until formats land. */
export const formatForScript = (s: { formatId?: string }): string => sceneForScript(s);
