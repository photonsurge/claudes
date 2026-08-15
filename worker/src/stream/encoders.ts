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
import { ENV_ENCODER_ID, encoderKeyForRun, type Run } from "@photonsurge/shared/runs";
import { decryptSecret } from "@photonsurge/shared/utill/secretbox";
import { ObsUnavailableError, envEndpoint, type ObsEndpoint } from "../obs/client";

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
