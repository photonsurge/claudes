/**
 * OBS control channel for the streaming-runs feature. Talks the obs-websocket v5
 * protocol to OBS instances that capture /watch scenes and push RTMP.
 *
 * MULTI-ENCODER: one OBS instance has exactly ONE streaming output, so N
 * concurrent runs need N instances. Every call therefore takes an `ObsEndpoint`
 * ({ url, password }); connections are cached per url with the same lazy-connect
 * semantics the old singleton had. Endpoints come from the StreamEncoder registry
 * (Mongo, resolved in ../stream/encoders.ts) or the legacy `OBS_WEBSOCKET_URL` /
 * `OBS_WEBSOCKET_PASSWORD` env pair (the "env" encoder).
 *
 * Every call is throw-safe: if an instance is unreachable/unconfigured we throw
 * `ObsUnavailableError`, which the run orchestrator catches to fall back to a
 * MANUAL stream-key handoff (operator pastes the key into OBS) rather than
 * failing the run. A failed call drops that url's cached connection so the next
 * call reconnects.
 */
import OBSWebSocket from "obs-websocket-js";
import { log } from "@photonsurge/shared/utill/logger";

const TAG = "obs";
const CONNECT_TIMEOUT_MS = 4_000;

/** Thrown when OBS can't be reached — the orchestrator branches to manual handoff. */
export class ObsUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ObsUnavailableError";
  }
}

/** A reachable OBS instance (obs-websocket v5). */
export interface ObsEndpoint {
  url: string;
  password?: string;
}

/** Normalised OBS stream output status (subset of GetStreamStatus). */
export interface ObsStreamStatus {
  outputActive: boolean;
  outputReconnecting: boolean;
  outputBytes: number;
  outputSkippedFrames: number;
  outputTotalFrames: number;
  outputDurationMs: number;
  outputCongestion: number;
}

interface Conn {
  client: OBSWebSocket | null;
  connecting: Promise<OBSWebSocket> | null;
}

const conns = new Map<string, Conn>();

/** True when the legacy env-configured OBS endpoint exists. */
export function obsConfigured(): boolean {
  return !!process.env.OBS_WEBSOCKET_URL;
}

/** The env-configured endpoint (the implicit "env" encoder), or null. */
export function envEndpoint(): ObsEndpoint | null {
  const url = process.env.OBS_WEBSOCKET_URL;
  if (!url) return null;
  return { url, password: process.env.OBS_WEBSOCKET_PASSWORD || undefined };
}

function reset(url: string) {
  const conn = conns.get(url);
  if (!conn) return;
  if (conn.client) {
    try {
      conn.client.disconnect();
    } catch {
      /* ignore */
    }
  }
  conns.delete(url);
}

/** Ensure a live, authenticated connection to `ep`. Throws ObsUnavailableError on failure. */
async function ensure(ep: ObsEndpoint): Promise<OBSWebSocket> {
  const url = ep?.url;
  if (!url) throw new ObsUnavailableError("no OBS endpoint configured");
  let conn = conns.get(url);
  if (conn?.client) return conn.client;
  if (conn?.connecting) return conn.connecting;

  const obs = new OBSWebSocket();
  obs.on("ConnectionClosed", () => {
    log(TAG, "connection closed", url);
    if (conns.get(url)?.client === obs) reset(url);
  });
  obs.on("ConnectionError", (err: unknown) => log(TAG, "connection error", `${url}: ${String(err)}`));

  conn = { client: null, connecting: null };
  conns.set(url, conn);
  conn.connecting = (async () => {
    try {
      await Promise.race([
        obs.connect(url, ep.password || undefined),
        new Promise((_, rej) => setTimeout(() => rej(new Error("connect timeout")), CONNECT_TIMEOUT_MS)),
      ]);
      conn.client = obs;
      conn.connecting = null;
      log(TAG, "connected", url);
      return obs;
    } catch (err) {
      conns.delete(url);
      try {
        await obs.disconnect();
      } catch {
        /* ignore */
      }
      throw new ObsUnavailableError(`cannot reach OBS at ${url}: ${String((err as Error)?.message ?? err)}`);
    }
  })();
  return conn.connecting;
}

/** Run one OBS call; on any transport error reset that connection and rethrow as ObsUnavailableError. */
async function withObs<T>(ep: ObsEndpoint, fn: (obs: OBSWebSocket) => Promise<T>): Promise<T> {
  const obs = await ensure(ep);
  try {
    return await fn(obs);
  } catch (err) {
    reset(ep.url);
    if (err instanceof ObsUnavailableError) throw err;
    throw new ObsUnavailableError(String((err as Error)?.message ?? err));
  }
}

/** Point an OBS instance at a custom RTMP server + stream key (the YouTube ingestion address + key). */
export async function setStreamKey(ep: ObsEndpoint, server: string, key: string): Promise<void> {
  await withObs(ep, (obs) =>
    obs.call("SetStreamServiceSettings", {
      streamServiceType: "rtmp_custom",
      streamServiceSettings: { server, key, use_auth: false },
    }),
  );
}

/** Start an instance's streaming output. Idempotent-ish: OBS errors if already streaming. */
export async function startStream(ep: ObsEndpoint): Promise<void> {
  await withObs(ep, async (obs) => {
    const status = await obs.call("GetStreamStatus");
    if (status.outputActive) return; // already streaming — treat as success
    await obs.call("StartStream");
  });
}

/** Stop an instance's streaming output. Best-effort — a not-streaming state is fine. */
export async function stopStream(ep: ObsEndpoint): Promise<void> {
  await withObs(ep, async (obs) => {
    const status = await obs.call("GetStreamStatus");
    if (!status.outputActive) return;
    await obs.call("StopStream");
  });
}

/** Current stream output status (for the health heartbeat). */
export async function getStatus(ep: ObsEndpoint): Promise<ObsStreamStatus> {
  return withObs(ep, async (obs) => {
    const s = await obs.call("GetStreamStatus");
    return {
      outputActive: !!s.outputActive,
      outputReconnecting: !!s.outputReconnecting,
      outputBytes: Number(s.outputBytes ?? 0),
      outputSkippedFrames: Number(s.outputSkippedFrames ?? 0),
      outputTotalFrames: Number(s.outputTotalFrames ?? 0),
      outputDurationMs: Number(s.outputDuration ?? 0),
      outputCongestion: Number(s.outputCongestion ?? 0),
    };
  });
}

/** Result of a read-only reachability probe (admin "Test connection"). */
export interface ObsProbe {
  obsVersion: string;
  websocketVersion: string;
  streaming: boolean;
  outputBytes: number;
}

/**
 * Connect + read version/status — the read-only reachability probe behind the admin
 * "Test connection" button. GetVersion + GetStreamStatus only; NO StartStream, so
 * it's safe to run against an encoder that's already live.
 */
export async function probe(ep: ObsEndpoint): Promise<ObsProbe> {
  return withObs(ep, async (obs) => {
    const v = await obs.call("GetVersion");
    const s = await obs.call("GetStreamStatus");
    return {
      obsVersion: String(v.obsVersion ?? "?"),
      websocketVersion: String(v.obsWebSocketVersion ?? "?"),
      streaming: !!s.outputActive,
      outputBytes: Number(s.outputBytes ?? 0),
    };
  });
}

/**
 * CEF paint rate for auto-provisioned browser sources. Default 30: the streams
 * encode at 1080p30, and the whole /watch page is rAF-driven (spin, wind
 * particles, label projection…), so capping the source's custom frame rate at
 * the real output rate halves every animation loop's work per instance versus
 * CEF's 60fps default. `OBS_BROWSER_FPS` overrides (clamped 10–60) for a rig
 * that actually encodes 60.
 */
export function browserSourceFps(): number {
  const n = Number(process.env.OBS_BROWSER_FPS);
  return Number.isFinite(n) && n >= 10 && n <= 60 ? Math.round(n) : 30;
}

/**
 * Settings pushed onto the /watch browser source. `existing` is the input's
 * current OBS settings object (pass null/undefined when creating it): each perf
 * default is applied ONLY when that key has never been set on the source, so a
 * hand-tuned 60fps source stays the operator's — while every fresh provision
 * starts life sensible:
 *  - fps_custom+fps → CEF paints at the stream's real frame rate, not 60;
 *  - shutdown/restart_when_active off → a scene switch must never reload the
 *    globe (black frame + a full texture refetch storm);
 *  - reroute_audio → the page's audio bed reaches the stream mix instead of
 *    playing on the encoder host (always enforced — runs depend on it).
 */
export function browserSourceSettings(
  base: { url: string; width: number; height: number },
  existing?: Record<string, unknown> | null,
): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = { ...base, reroute_audio: true };
  const owned = (k: string) => !!existing && k in existing;
  // The fps pair is owned together: an operator-set fps_custom keeps their fps.
  if (!owned("fps_custom")) {
    out.fps_custom = true;
    out.fps = browserSourceFps();
  }
  if (!owned("shutdown")) out.shutdown = false;
  if (!owned("restart_when_active")) out.restart_when_active = false;
  return out;
}

/** Result of provisioning a browser-source scene. */
export interface ProvisionResult {
  sceneName: string;
  inputName: string;
  width: number;
  height: number;
  created: boolean; // input was newly created (vs URL updated)
  switched: boolean; // program scene was switched to it
  refreshed: boolean; // CEF page was force-reloaded (no cache) onto the current URL
}

/**
 * Full auto-provision: create-or-update a full-canvas browser source pointing at
 * `url`, in a dedicated scene, and (optionally) switch OBS to it. Idempotent — a
 * re-run just updates the URL (so a rotated watch token re-pushes cleanly) and
 * re-applies the transform. Sizes the source to the OBS base canvas for a crisp,
 * exact-fit render. Settings go through browserSourceSettings(): perf defaults
 * (30fps custom rate, no shutdown/reload-on-visibility) apply only to keys the
 * operator has never touched, and `overlay:true` on the update preserves every
 * other tweak (css etc.) they made.
 */
export async function provisionBrowserScene(
  ep: ObsEndpoint,
  opts: { url: string; sceneName: string; inputName: string; makeActive?: boolean },
): Promise<ProvisionResult> {
  const { url, sceneName, inputName, makeActive = true } = opts;
  return withObs(ep, async (obs) => {
    const video = await obs.call("GetVideoSettings");
    const width = Number(video.baseWidth) || 1920;
    const height = Number(video.baseHeight) || 1080;
    const base = { url, width, height };

    const { scenes } = await obs.call("GetSceneList");
    if (!(scenes as { sceneName: string }[]).some((s) => s.sceneName === sceneName)) {
      await obs.call("CreateScene", { sceneName });
    }

    const { inputs } = await obs.call("GetInputList");
    const inputExists = (inputs as { inputName: string }[]).some((i) => i.inputName === inputName);
    let created = false;
    if (!inputExists) {
      await obs.call("CreateInput", {
        sceneName,
        inputName,
        inputKind: "browser_source",
        inputSettings: browserSourceSettings(base),
        sceneItemEnabled: true,
      });
      created = true;
    } else {
      // Read the source's current settings so perf defaults only fill gaps the
      // operator never set (best-effort: unreadable → treat as fresh).
      let existing: Record<string, unknown> | null = null;
      try {
        const cur = await obs.call("GetInputSettings", { inputName });
        existing = (cur.inputSettings ?? {}) as Record<string, unknown>;
      } catch {
        existing = null;
      }
      await obs.call("SetInputSettings", {
        inputName,
        inputSettings: browserSourceSettings(base, existing),
        overlay: true,
      });
      // Make sure this source is actually IN the target scene (it may live elsewhere).
      try {
        await obs.call("GetSceneItemId", { sceneName, sourceName: inputName });
      } catch {
        await obs.call("CreateSceneItem", { sceneName, sourceName: inputName, sceneItemEnabled: true });
      }
    }

    // Fill the canvas: source is already canvas-sized, so position 0,0 at scale 1.
    const { sceneItemId } = await obs.call("GetSceneItemId", { sceneName, sourceName: inputName });
    await obs.call("SetSceneItemTransform", {
      sceneName,
      sceneItemId,
      sceneItemTransform: { positionX: 0, positionY: 0, scaleX: 1, scaleY: 1, boundsType: "OBS_BOUNDS_NONE" },
    });

    let switched = false;
    if (makeActive) {
      await obs.call("SetCurrentProgramScene", { sceneName });
      switched = true;
    }

    // Force a no-cache reload so the source actually navigates to the (possibly
    // just-changed) URL and drops any stale /watch bundle — the OBS "Refresh cache
    // of current page" button, done for the operator. Best-effort: a build/plugin
    // without this property must not fail the whole provision.
    let refreshed = false;
    try {
      await obs.call("PressInputPropertiesButton", { inputName, propertyName: "refreshnocache" });
      refreshed = true;
    } catch (err) {
      log(TAG, "refreshnocache press failed (non-fatal)", `${inputName}: ${String((err as Error)?.message ?? err)}`);
    }

    return { sceneName, inputName, width, height, created, switched, refreshed };
  });
}

/**
 * Force a no-cache reload of a browser source (the OBS "Refresh" button), without
 * touching scenes/URL. Throws ObsUnavailableError if the input isn't there yet.
 */
export async function refreshBrowserSource(ep: ObsEndpoint, inputName: string): Promise<void> {
  await withObs(ep, async (obs) => {
    const { inputs } = await obs.call("GetInputList");
    if (!(inputs as { inputName: string }[]).some((i) => i.inputName === inputName)) {
      throw new ObsUnavailableError(`browser source "${inputName}" not found — provision it first`);
    }
    await obs.call("PressInputPropertiesButton", { inputName, propertyName: "refreshnocache" });
  });
}

/** Tear down every cached connection (worker shutdown). */
export function closeObs(): void {
  for (const url of [...conns.keys()]) reset(url);
}
