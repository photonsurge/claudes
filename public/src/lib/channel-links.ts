/**
 * Where a channel's operator links go, by kind (plan §8.1). The watch URL is
 * `watchPath` in shared; this is its operator-side counterpart, so the Channels
 * list, the settings page and the home launcher agree.
 */
import { MAIN_SCENE_ID, sceneSurface, type SceneSurface } from "@photonsurge/shared/control";

/** The console that drives a channel live: /control for weather, the Desk for a crossword. */
export function consoleHref(scene: { id: string; surface?: SceneSurface }): string {
  if (sceneSurface(scene) === "crossword") return `/admin/crosswords/desk/${encodeURIComponent(scene.id)}`;
  return scene.id === MAIN_SCENE_ID ? "/control" : `/control?scene=${scene.id}`;
}

/** The channel's settings page. */
export const settingsHref = (id: string) => `/admin/scenes/${id}`;

/** "Weather" / "Crossword" — the Type chip's label. */
export const surfaceLabel = (surface: SceneSurface) => (surface === "crossword" ? "Crossword" : "Weather");
