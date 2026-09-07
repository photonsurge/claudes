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
import { MAIN_SCENE_ID } from "@photonsurge/shared/control";
import { ENV_ENCODER_ID, encoderKeyForRun, type Run } from "@photonsurge/shared/runs";
import { decryptSecret } from "@photonsurge/shared/utill/secretbox";
import {
  ObsUnavailableError,
  envEndpoint,
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

/** The tokened /watch URL an OBS browser source should load for a channel/scene. */
export async function watchUrlForScene(sceneId: string): Promise<string> {
  const db = await getAppDb();
  // getScene / getOrInitBroadcastState both backfill a watchToken if absent.
  const doc = sceneId === MAIN_SCENE_ID ? await db.getOrInitBroadcastState() : await db.getScene(sceneId);
  const token = (doc as { watchToken?: string } | null)?.watchToken;
  const url = `${watchBaseUrl()}/watch/${encodeURIComponent(sceneId)}`;
  return token ? `${url}?token=${token}` : url;
}

/** Stable OBS scene/input names for a channel — shared by provision + refresh so they never drift. */
function obsNamesFor(sceneId: string): { sceneName: string; inputName: string } {
  return { sceneName: `PhotonSurge — ${sceneId}`, inputName: `PhotonSurge globe — ${sceneId}` };
}

/** Resolve an encoder to its OBS endpoint + the channel it publishes + its scene/input names. */
async function resolveEncoderScene(encoderId?: string): Promise<{
  ep: ObsEndpoint;
  sceneId: string;
  sceneName: string;
  inputName: string;
}> {
  const db = await getAppDb();
  const key = encoderId && encoderId !== ENV_ENCODER_ID ? encoderId : undefined;
  const enc = key ? await db.getStreamEncoder(key) : null;
  const sceneId = enc?.sceneId || MAIN_SCENE_ID; // unbound / env encoder → main channel
  const ep = await endpointForEncoderId(encoderId);
  return { ep, sceneId, ...obsNamesFor(sceneId) };
}

/**
 * Full auto-provision an encoder's OBS: build the channel's tokened /watch URL and
 * push a full-canvas browser-source scene into that OBS instance (switching to it,
 * then reloading the page). The scene/input are named after the channel so re-running
 * is idempotent — a rotated token just re-pushes the URL. By default this is a HARD
 * reset (the existing browser source is torn down and rebuilt, so every run starts
 * on a fresh Chromium with zero accumulated state); `OBS_HARD_PROVISION=off` in the
 * env — or `{ hard: false }` — falls back to a settings-restamp + no-cache refresh.
 * Throws ObsUnavailableError if OBS is unreachable (callers treat it as best-effort
 * at go-live).
 */
export async function provisionEncoderScene(
  encoderId?: string,
  opts?: { hard?: boolean },
): Promise<ProvisionResult & { url: string; sceneId: string }> {
  const { ep, sceneId, sceneName, inputName } = await resolveEncoderScene(encoderId);
  const url = await watchUrlForScene(sceneId);
  const hard = opts?.hard ?? process.env.OBS_HARD_PROVISION !== "off";
  const res = await provisionBrowserScene(ep, { url, sceneName, inputName, hard });
  return { ...res, url, sceneId };
}

/**
 * Force a no-cache reload of an encoder's globe browser source (the OBS "Refresh"
 * button) — for picking up a new /watch bundle after a deploy without re-switching
 * scenes. Throws ObsUnavailableError if OBS is unreachable or not provisioned yet.
 */
export async function refreshEncoderScene(encoderId?: string): Promise<{ sceneId: string; inputName: string }> {
  const { ep, sceneId, inputName } = await resolveEncoderScene(encoderId);
  await refreshBrowserSource(ep, inputName);
  return { sceneId, inputName };
}
