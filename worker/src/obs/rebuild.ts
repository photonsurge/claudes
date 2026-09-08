/**
 * Tear-down-and-recreate of an auto-provisioned browser source (the go-live
 * hard reset), done SAFELY against obs-websocket's asynchronous removal.
 *
 * `RemoveInput` only MARKS a source removed and returns at once; OBS actually
 * frees it later on its UI thread (the scene items and source-tree entries that
 * hold refs are dropped there). Until that happens the name is still taken, so
 * a naive RemoveInput → CreateInput under the same name fails with obs-websocket
 * 601 "A source already exists by that input name." — and by then the old source
 * is already gone from the scene, so the scene (and the stream) is left BLANK.
 *
 * `rebuildBrowserInput` waits for OBS to really let go of the name before
 * recreating. If OBS never does within the deadline (a wedged UI thread), it
 * recreates under a numbered sibling name (`<name> #2`) so the picture comes
 * back regardless; `ourInputs` recognises those siblings so the next hard reset
 * sweeps them and the refresh button still finds the live source.
 */
import type OBSWebSocket from "obs-websocket-js";

/** How long a hard reset waits for OBS to release a removed source's name. */
export const REMOVE_SETTLE_MS = 10_000;
/** Poll cadence while waiting (each poll is one GetInputList round-trip). */
export const REMOVE_POLL_MS = 200;

/** True if `name` is the canonical input name or one of its `<name> #n` fallback siblings. */
export function isOurInput(name: string, canonical: string): boolean {
  if (name === canonical) return true;
  const prefix = `${canonical} #`;
  return name.startsWith(prefix) && /^[1-9]\d*$/.test(name.slice(prefix.length));
}

/** The inputs among `names` that are ours for `canonical`: canonical first, then siblings in numeric order. */
export function ourInputs(names: string[], canonical: string): string[] {
  const rank = (n: string) => (n === canonical ? 0 : Number(n.slice(canonical.length + 2)));
  return names.filter((n) => isOurInput(n, canonical)).sort((a, b) => rank(a) - rank(b));
}

/** The first `<canonical> #n` (n ≥ 2) not already in `taken`. */
export function nextSiblingName(taken: string[], canonical: string): string {
  const set = new Set(taken);
  for (let n = 2; ; n++) {
    const candidate = `${canonical} #${n}`;
    if (!set.has(candidate)) return candidate;
  }
}

/** obs-websocket 601 ResourceAlreadyExists (CreateInput / SetInputName name clash). */
export function isAlreadyExists(err: unknown): boolean {
  return (err as { code?: unknown })?.code === 601 || /already exists/i.test(String((err as Error)?.message ?? ""));
}

/** obs-websocket 600 ResourceNotFound (the source vanished between our list and our call). */
export function isNotFound(err: unknown): boolean {
  return (err as { code?: unknown })?.code === 600 || /no source was found|not found/i.test(String((err as Error)?.message ?? ""));
}

/** Every input name OBS currently knows (a removed-but-not-yet-freed source is still listed). */
export async function listInputNames(obs: OBSWebSocket): Promise<string[]> {
  const { inputs } = await obs.call("GetInputList");
  return (inputs as { inputName: string }[]).map((i) => i.inputName);
}

/** Source names that have a scene item in `sceneName` (empty on any failure — advisory only). */
export async function sourcesInScene(obs: OBSWebSocket, sceneName: string): Promise<Set<string>> {
  try {
    const { sceneItems } = await obs.call("GetSceneItemList", { sceneName });
    return new Set((sceneItems as { sourceName?: string }[]).map((i) => String(i.sourceName ?? "")));
  } catch {
    return new Set();
  }
}

/**
 * Of our inputs, the one to treat as LIVE: an input that is actually in the
 * scene wins (a lingering ghost from a half-done reset has no scene item any
 * more), else canonical-first order.
 */
export async function pickLiveInput(obs: OBSWebSocket, sceneName: string, ours: string[]): Promise<string | undefined> {
  if (ours.length <= 1) return ours[0];
  const inScene = await sourcesInScene(obs, sceneName);
  return ours.find((n) => inScene.has(n)) ?? ours[0];
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export interface RebuildOpts {
  sceneName: string;
  /** Canonical input name the fresh source should get. */
  inputName: string;
  /** Our current inputs (canonical and/or siblings) — all are removed. */
  existing: string[];
  inputSettings: Record<string, string | number | boolean>;
  settleMs?: number;
  pollMs?: number;
}

export interface RebuildResult {
  /** The name the fresh input actually got — canonical, or a sibling if OBS wouldn't release the canonical in time. */
  inputName: string;
  /** True when the sibling fallback was used. */
  fallback: boolean;
  /** How long OBS took to release the canonical name (ms), for the log line. */
  waitedMs: number;
}

/**
 * Remove every existing input in `opts.existing`, wait until OBS has released
 * the canonical name, then create the fresh browser source in `sceneName`.
 * Falls back to a numbered sibling after `settleMs` so the scene is never left
 * empty. Any OBS error other than the name clash / vanish races is rethrown.
 */
export async function rebuildBrowserInput(obs: OBSWebSocket, opts: RebuildOpts): Promise<RebuildResult> {
  const { sceneName, inputName, existing, inputSettings } = opts;
  const settleMs = opts.settleMs ?? REMOVE_SETTLE_MS;
  const pollMs = opts.pollMs ?? REMOVE_POLL_MS;

  for (const name of existing) {
    try {
      await obs.call("RemoveInput", { inputName: name });
    } catch (err) {
      if (!isNotFound(err)) throw err; // already gone → fine
    }
  }

  const create = (name: string) =>
    obs.call("CreateInput", {
      sceneName,
      inputName: name,
      inputKind: "browser_source",
      inputSettings,
      sceneItemEnabled: true,
    });

  const t0 = Date.now();
  for (;;) {
    const names = await listInputNames(obs);
    if (!names.includes(inputName)) {
      try {
        await create(inputName);
        return { inputName, fallback: false, waitedMs: Date.now() - t0 };
      } catch (err) {
        // The list said free but OBS still had it by name — keep waiting.
        if (!isAlreadyExists(err)) throw err;
      }
    }
    if (Date.now() - t0 >= settleMs) {
      const sibling = nextSiblingName(names, inputName);
      await create(sibling);
      return { inputName: sibling, fallback: true, waitedMs: Date.now() - t0 };
    }
    await sleep(pollMs);
  }
}
