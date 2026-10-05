/**
 * Resolve which OBS instance a run publishes through. Encoder ids come from the
 * StreamEncoder registry (Mongo); ENV_ENCODER_ID — or a run with no encoderId at
 * all (legacy) — means the `OBS_WEBSOCKET_URL`/`OBS_WEBSOCKET_PASSWORD` env pair.
 *
 * Only the worker decrypts the stored websocket password (secretbox, same key as
 * the YouTube refresh tokens); `public` handles it write-only. Every failure mode
 * here throws `ObsUnavailableError` so callers land on the existing manual
 * stream-key handoff path instead of failing the run.
 */
import { getAppDb } from "@photonsurge/shared/db/index";
import { MAIN_SCENE_ID, outputPath } from "@photonsurge/shared/control";
import { ENV_ENCODER_ID, encoderKeyForRun, encoderUse, type Run } from "@photonsurge/shared/runs";
import { decryptSecret } from "@photonsurge/shared/utill/secretbox";
import { obsNamesFor } from "../obs/names";
import {
  ObsUnavailableError,
  envEndpoint,
  getSourceScreenshot,
  provisionBrowserScene,
  refreshBrowserSource,
  type ObsEndpoint,
  type ProvisionResult,
} from "../obs/client";

/** The ObsEndpoint for an encoder id ("env"/empty = the env-configured instance). */
export async function endpointForEncoderId(encoderId?: string): Promise<ObsEndpoint> {
  const key = encoderId || ENV_ENCODER_ID;
  if (key === ENV_ENCODER_ID) {
    const ep = envEndpoint();
    if (!ep) throw new ObsUnavailableError("OBS_WEBSOCKET_URL is not set");
    return ep;
  }
  const enc = await (await getAppDb()).getStreamEncoder(key);
  if (!enc) throw new ObsUnavailableError(`encoder "${key}" is not registered`);
  if (!enc.enabled) throw new ObsUnavailableError(`encoder "${key}" is disabled`);
  if (!enc.passwordEnc) return { url: enc.url };
  try {
    return { url: enc.url, password: decryptSecret(enc.passwordEnc) };
  } catch (err) {
    throw new ObsUnavailableError(
      `encoder "${key}": cannot decrypt password (${String((err as Error)?.message ?? err)})`,
    );
  }
}

/** The ObsEndpoint a run publishes through. */
export async function endpointForRun(run: Pick<Run, "encoderId">): Promise<ObsEndpoint> {
  return endpointForEncoderId(encoderKeyForRun(run));
}

/**
 * The public base URL the /watch page is served from (for OBS browser sources).
 * `PUBLIC_BASE_URL`/`WATCH_BASE_URL` win; else derive from `APP_DOMAIN` (deploy);
 * else localhost for a dev box.
 */
export function watchBaseUrl(): string {
  const explicit = process.env.PUBLIC_BASE_URL || process.env.WATCH_BASE_URL;
  if (explicit) return explicit.replace(/\/+$/, "");
  const domain = process.env.APP_DOMAIN;
  if (domain) return `https://${domain.replace(/^https?:\/\//, "").replace(/\/+$/, "")}`;
  return "http://localhost:10100";
}

/**
 * The tokened URL an OBS browser source should load for a channel/scene: its
 * output page as `outputPath` names it — `/watch/<id>` for a weather channel,
 * `/crossword/<id>` for a crossword one (crossword plan §3). The main channel is
 * always weather.
 */
export async function watchUrlForScene(sceneId: string): Promise<string> {
  const db = await getAppDb();
  // getScene / getOrInitBroadcastState both backfill a watchToken if absent.
  const doc = sceneId === MAIN_SCENE_ID ? await db.getOrInitBroadcastState() : await db.getScene(sceneId);
  const token = (doc as { watchToken?: string } | null)?.watchToken;
  const surface = sceneId === MAIN_SCENE_ID ? undefined : (doc as { surface?: unknown } | null)?.surface;
  const url = `${watchBaseUrl()}${outputPath({ id: sceneId, surface })}`;
  return token ? `${url}?token=${token}` : url;
}

/**
 * Resolve an encoder to its OBS endpoint + the channel it publishes + its
 * scene/input names. `sceneOverride` names the scene instead of the encoder's
 * binding — a video render points the encoder at its script's scene (§6.4).
 */
async function resolveEncoderScene(
  encoderId?: string,
  sceneOverride?: string,
): Promise<{
  ep: ObsEndpoint;
  sceneId: string;
  sceneName: string;
  inputName: string;
}> {
  const db = await getAppDb();
  const key = encoderId && encoderId !== ENV_ENCODER_ID ? encoderId : undefined;
  const enc = key && !sceneOverride ? await db.getStreamEncoder(key) : null;
  const sceneId = sceneOverride || enc?.sceneId || MAIN_SCENE_ID; // unbound / env encoder → main channel
  const ep = await endpointForEncoderId(encoderId);
  return { ep, sceneId, ...obsNamesFor(sceneId) };
}

/**
 * The scene an encoder shows when no run has borrowed it: its bound channel, or
 * the main channel for the env encoder (the legacy single OBS). Null for a
 * video encoder and for a registered encoder bound to no channel: those idle on
 * a blank page instead, so a hand-back never starts a main-channel globe on a
 * GPU nobody asked for. Restoring after a run compares against this.
 */
export async function encoderOwnSceneId(encoderId?: string): Promise<string | null> {
  const key = encoderId && encoderId !== ENV_ENCODER_ID ? encoderId : undefined;
  if (!key) return MAIN_SCENE_ID;
  const enc = await (await getAppDb()).getStreamEncoder(key);
  if (encoderUse(enc) === "videos") return null;
  return enc?.sceneId || null;
}

// One OBS change at a time per encoder, in this process (the worker is one
// process): a run's provision and another run's hand-back of the same encoder
// queue behind each other instead of interleaving.
const encoderLocks = new Map<string, Promise<unknown>>();

/** Run `fn` holding the encoder's lock ("env" for the env encoder). */
export function withEncoderLock<T>(encoderId: string | undefined, fn: () => Promise<T>): Promise<T> {
  const key = encoderId || ENV_ENCODER_ID;
  const prev = encoderLocks.get(key) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  const tail = next.catch(() => {});
  encoderLocks.set(key, tail);
  void tail.then(() => {
    if (encoderLocks.get(key) === tail) encoderLocks.delete(key);
  });
  return next;
}

/**
 * A run showing another channel on this encoder right now (a channel run on a
 * picked encoder, or a video render), or null. A manual Provision or Refresh of
 * the encoder's own channel would swap that run's live picture, so the admin
 * actions refuse while one exists.
 */
export async function borrowingRun(encoderId?: string): Promise<Run | null> {
  const run = await (await getAppDb()).activeRunForEncoder(encoderId || ENV_ENCODER_ID);
  if (!run) return null;
  return run.sceneId !== (await encoderOwnSceneId(encoderId)) ? (run as Run) : null;
}

/** OBS names for a video encoder's idle state: a blank page, no globe. */
export const IDLE_SCENE_KEY = "idle";
export const IDLE_URL = "about:blank";

/**
 * Full auto-provision an encoder's OBS: build the channel's tokened /watch URL and
 * push a full-canvas browser-source scene into that OBS instance (switching to it,
 * then reloading the page). The scene/input are named after the channel so re-running
 * is idempotent — a rotated token just re-pushes the URL. By default this is a HARD
 * reset (the existing browser source is torn down and rebuilt, so every run starts
 * on a fresh Chromium with zero accumulated state); `OBS_HARD_PROVISION=off` in the
 * env — or `{ hard: false }` — falls back to a settings-restamp + no-cache refresh.
 * Either way the instance is also swept down to this one channel (other channels'
 * globes and stray /watch sources removed — see ../obs/prune.ts), because a hidden
 * browser source still runs a full Chromium against the same GPU.
 * Throws ObsUnavailableError if OBS is unreachable (callers treat it as best-effort
 * at go-live).
 */
export async function provisionEncoderScene(
  encoderId?: string,
  opts?: { hard?: boolean; prune?: boolean; sceneId?: string },
): Promise<ProvisionResult & { url: string; sceneId: string }> {
  const { ep, sceneId, sceneName, inputName } = await resolveEncoderScene(encoderId, opts?.sceneId);
  const url = await watchUrlForScene(sceneId);
  const hard = opts?.hard ?? process.env.OBS_HARD_PROVISION !== "off";
  const res = await provisionBrowserScene(ep, { url, sceneName, inputName, hard, prune: opts?.prune });
  return { ...res, url, sceneId };
}

/**
 * Put an encoder in its idle state: a browser source on a blank page in our
 * "idle" OBS scene, with the sweep ON, so the video's /watch source (another
 * Chromium drawing a globe) is removed. Used for video encoders between
 * videos (§13: an unbound encoder must NOT fall back to the main channel).
 */
export async function idleEncoderScene(encoderId?: string): Promise<ProvisionResult & { url: string }> {
  const ep = await endpointForEncoderId(encoderId);
  const { sceneName, inputName } = obsNamesFor(IDLE_SCENE_KEY);
  const res = await provisionBrowserScene(ep, { url: IDLE_URL, sceneName, inputName, hard: false, prune: true });
  return { ...res, url: IDLE_URL };
}

/**
 * Hand an encoder back after a video render (§6.4): a channel encoder gets its
 * own scene re-provisioned, as before the video; a video encoder (`use:
 * "videos"`, bound to no channel) goes idle instead of falling back to the main
 * channel. Throws ObsUnavailableError when OBS can't be reached (callers treat
 * the restore as best-effort).
 */
export async function restoreEncoderScene(encoderId?: string): Promise<{ idle: boolean; url: string }> {
  const key = encoderId && encoderId !== ENV_ENCODER_ID ? encoderId : undefined;
  const enc = key ? await (await getAppDb()).getStreamEncoder(key) : null;
  if (encoderUse(enc) === "videos") {
    const res = await idleEncoderScene(encoderId);
    return { idle: true, url: res.url };
  }
  const res = await provisionEncoderScene(encoderId);
  return { idle: false, url: res.url };
}

/**
 * Force a no-cache reload of an encoder's globe browser source (the OBS "Refresh"
 * button) — for picking up a new /watch bundle after a deploy without re-switching
 * scenes. Throws ObsUnavailableError if OBS is unreachable or not provisioned yet.
 */
export async function refreshEncoderScene(encoderId?: string): Promise<{ sceneId: string; inputName: string }> {
  const { ep, sceneId, sceneName, inputName } = await resolveEncoderScene(encoderId);
  const refreshed = await refreshBrowserSource(ep, inputName, sceneName);
  return { sceneId, inputName: refreshed };
}

/**
 * A screenshot of what a run's encoder is drawing for its scene: the OBS scene
 * provisioned for `run.sceneId` (the render's browser source, full canvas).
 * The scene is named rather than the input because a fallback rebuild can
 * leave the input as `<name> #n`; the scene name never moves. Throws
 * ObsUnavailableError when OBS can't be reached or the scene isn't there.
 */
export async function screenshotRunScene(
  run: Pick<Run, "encoderId" | "sceneId">,
  opts: { imageFormat?: "jpg" | "png"; imageWidth?: number } = {},
): Promise<{ mimeType: string; data: Buffer }> {
  const ep = await endpointForRun(run);
  const { sceneName } = obsNamesFor(run.sceneId);
  return getSourceScreenshot(ep, { sourceName: sceneName, imageFormat: opts.imageFormat ?? "jpg", imageWidth: opts.imageWidth });
}
