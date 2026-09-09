/**
 * Sweep an OBS instance down to the ONE channel it is supposed to render.
 *
 * WHY: a browser source is a whole Chromium. Ours are provisioned with
 * `shutdown: false` (a scene switch must never reload the globe), so a source
 * left over from an earlier setup keeps running even while its scene is hidden
 * — holding its own websocket to the socket server, its own map textures and
 * its own rAF loop, on the same GPU/CPU as the scene actually on air. An
 * instance that once hosted three channels therefore pays for three /watch
 * pages forever and drops frames on the one that matters.
 *
 * WHAT IS SWEPT: only what this app provisioned (the `PhotonSurge — …` /
 * `PhotonSurge globe — …` names in ./names.ts) for a DIFFERENT channel, plus
 * browser sources pointing at a `/watch` page under any other name — a
 * hand-made duplicate costs exactly as much as one of ours. Everything else an
 * operator built (cameras, overlays, their own scenes) is left alone and
 * reported, never removed.
 *
 * ORDERING (see the call sites in ./client.ts): inputs are swept BEFORE the new
 * browser source is built, so the old Chromiums are gone before the fresh one
 * starts and go-live never peaks at N+1 pages; scenes are swept AFTER OBS has
 * switched to ours, so the program scene is never yanked out from under it.
 */
import type OBSWebSocket from "obs-websocket-js";
import { log } from "@photonsurge/shared/utill/logger";
import { isNotFound, isOurInput, listInputNames } from "./rebuild";
import { isOurInputName, isOurSceneName } from "./names";

const TAG = "obs";

/** Sweeping is on by default; `OBS_PRUNE=off` leaves a hand-built instance exactly as it is. */
export function pruneEnabled(): boolean {
  return (process.env.OBS_PRUNE || "").toLowerCase() !== "off";
}

/**
 * True for a URL that loads one of our broadcast pages (`/watch/<scene>`), on any
 * host — the dev box, the deploy domain or an IP all count, because what makes it
 * expensive is the page, not where it is served from.
 */
export function isWatchUrl(url: unknown): boolean {
  if (typeof url !== "string" || !url) return false;
  try {
    return /^\/watch(\/|$)/.test(new URL(url).pathname);
  } catch {
    return /^\/watch(\/|$)/.test(url); // a bare path in the settings is still a watch page
  }
}

/** One entry of OBS's input list, as much of it as the sweep needs. */
export interface ObsInput {
  inputName: string;
  inputKind?: string;
}

export interface InputSweep {
  /** Ours for THIS channel (canonical + `#n` rebuild siblings) — never removed. */
  keep: string[];
  /** Ours, but provisioned for another channel — removed. */
  stale: string[];
  /** Browser sources under a foreign name that need their URL checked before a verdict. */
  candidates: string[];
  /** Not ours and not a browser source — reported, never touched. */
  foreign: string[];
}

/**
 * Split OBS's input list by what the sweep may do with each entry. Pure: the
 * `candidates` still need a `GetInputSettings` round-trip to see whether they
 * load a /watch page, which is the only part that can't be decided from a name.
 */
export function sweepInputs(inputs: ObsInput[], keepCanonical: string): InputSweep {
  const out: InputSweep = { keep: [], stale: [], candidates: [], foreign: [] };
  for (const { inputName, inputKind } of inputs) {
    if (isOurInput(inputName, keepCanonical)) out.keep.push(inputName);
    else if (isOurInputName(inputName)) out.stale.push(inputName);
    else if (inputKind === "browser_source") out.candidates.push(inputName);
    else out.foreign.push(inputName);
  }
  return out;
}

/**
 * The scenes to remove: ours (any channel) except the one being provisioned, and
 * never whatever OBS currently has on program — removing that would make OBS pick
 * a replacement scene on its own. An operator's own scenes are not ours to delete.
 */
export function sweepScenes(sceneNames: string[], keepScene: string, currentProgramScene?: string): string[] {
  return sceneNames.filter((n) => isOurSceneName(n) && n !== keepScene && n !== currentProgramScene);
}

/** RemoveInput that tolerates the source having already vanished; other errors are the caller's. */
async function removeInput(obs: OBSWebSocket, inputName: string): Promise<boolean> {
  try {
    await obs.call("RemoveInput", { inputName });
    return true;
  } catch (err) {
    if (isNotFound(err)) return false;
    throw err;
  }
}

/** The `url` a browser source is currently pointed at (undefined if it can't be read). */
async function inputUrl(obs: OBSWebSocket, inputName: string): Promise<string | undefined> {
  try {
    const { inputSettings } = await obs.call("GetInputSettings", { inputName });
    const url = (inputSettings as Record<string, unknown> | undefined)?.url;
    return typeof url === "string" ? url : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Remove every /watch browser source in this instance that isn't the channel's own
 * (`inputName` and its `#n` rebuild siblings): our other channels' globes by name,
 * plus foreign-named browser sources whose URL is a /watch page. Returns the names
 * actually removed. Best-effort — a failure here must never fail a go-live, so the
 * caller logs and carries on.
 */
export async function pruneForeignInputs(obs: OBSWebSocket, inputName: string): Promise<string[]> {
  const { inputs } = await obs.call("GetInputList");
  const sweep = sweepInputs(inputs as unknown as ObsInput[], inputName);

  const doomed = [...sweep.stale];
  for (const name of sweep.candidates) {
    if (isWatchUrl(await inputUrl(obs, name))) doomed.push(name);
  }

  const removed: string[] = [];
  for (const name of doomed) {
    if (await removeInput(obs, name)) removed.push(name);
  }
  if (sweep.foreign.length) log(TAG, `left ${sweep.foreign.length} operator source(s) alone: ${sweep.foreign.join(", ")}`);
  return removed;
}

/**
 * Remove our scenes for other channels, once OBS is already on the scene we want.
 * Scene items inside them die with the scene; their browser sources are removed
 * separately (a source can live in several scenes, so the input sweep owns that).
 */
export async function pruneForeignScenes(obs: OBSWebSocket, sceneName: string): Promise<string[]> {
  const { scenes, currentProgramSceneName } = await obs.call("GetSceneList");
  const names = (scenes as { sceneName: string }[]).map((s) => s.sceneName);
  const doomed = sweepScenes(names, sceneName, currentProgramSceneName as string | undefined);

  const removed: string[] = [];
  for (const name of doomed) {
    try {
      await obs.call("RemoveScene", { sceneName: name });
      removed.push(name);
    } catch (err) {
      if (!isNotFound(err)) throw err;
    }
  }
  return removed;
}
