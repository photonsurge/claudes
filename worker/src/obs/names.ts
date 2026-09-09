/**
 * The names the app owns inside an OBS instance.
 *
 * Every scene/source this app provisions is named after the channel it renders,
 * so a re-provision is idempotent and — just as importantly — so the sweep in
 * ./prune.ts can tell OUR leftovers (another channel's globe, parked in the same
 * instance by an older setup) from an operator's own scenes, which it never
 * touches. Both prefixes are load-bearing: renaming one orphans every scene and
 * source already provisioned out there.
 */

/** Prefix of every scene this app provisions (`PhotonSurge — <sceneId>`). */
export const SCENE_PREFIX = "PhotonSurge — ";
/** Prefix of every browser source this app provisions (`PhotonSurge globe — <sceneId>`). */
export const INPUT_PREFIX = "PhotonSurge globe — ";

/** Stable OBS scene/input names for a channel — shared by provision, refresh and prune so they never drift. */
export function obsNamesFor(sceneId: string): { sceneName: string; inputName: string } {
  return { sceneName: `${SCENE_PREFIX}${sceneId}`, inputName: `${INPUT_PREFIX}${sceneId}` };
}

/** True if this scene name was provisioned by us (any channel). */
export function isOurSceneName(name: string): boolean {
  return name.startsWith(SCENE_PREFIX);
}

/** True if this input name was provisioned by us (any channel, including `#n` rebuild siblings). */
export function isOurInputName(name: string): boolean {
  return name.startsWith(INPUT_PREFIX);
}
