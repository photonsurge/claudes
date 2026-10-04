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
import { listInputNames, ourInputs, pickLiveInput, rebuildBrowserInput } from "./rebuild";
import { pruneEnabled, pruneForeignInputs, pruneForeignScenes } from "./prune";

const TAG = "obs";
const CONNECT_TIMEOUT_MS = 4_000;

/**
 * Websocket traffic log. Every request the worker sends an OBS instance and every
 * state event OBS pushes back is logged (`→ url Request …` / `← url Request ok 12ms …`),
 * with the stream key and any password redacted. GetStreamStatus is polled every
 * few seconds per run, so by default it is logged only when the answer CHANGES;
 * `OBS_WS_LOG=all` logs every poll verbatim, `OBS_WS_LOG=off` silences request
 * logging (failures + events always log). Why: obs-websocket's StartStream is
 * fire-and-forget — OBS accepts it and only later fails (encoder init, RTMP
 * connect…) — so the traffic log is the worker-side record of what OBS was told
 * and what it said back.
 */
type WsLogMode = "default" | "all" | "off";
function wsLogMode(): WsLogMode {
  const v = (process.env.OBS_WS_LOG || "").toLowerCase();
  return v === "all" || v === "off" ? v : "default";
}
const LOG_MAX = 400;
const POLL_REQUESTS = new Set(["GetStreamStatus", "GetOutputStatus"]);
const SECRET_KEYS = /^(key|password|streamKey|server_password|bearer_token)$/i;

/** Strip secrets from a request/response object before it hits a log line. */
export function redactObsValue(data: unknown): unknown {
  if (!data || typeof data !== "object") return data;
  if (Array.isArray(data)) return data.map(redactObsValue);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
    if (SECRET_KEYS.test(k) && typeof v === "string") out[k] = v.length > 4 ? `…${v.slice(-4)}` : "…";
    else out[k] = redactObsValue(v);
  }
  return out;
}

/** Compact one-line JSON for a log line, bounded (scene/input lists can be huge). */
export function summarizeObsValue(v: unknown, max = LOG_MAX): string {
  if (v === undefined) return "";
  let s: string | undefined;
  try {
    s = JSON.stringify(v);
  } catch {
    s = String(v);
  }
  if (s === undefined) return "";
  return s.length > max ? `${s.slice(0, max)}…(${s.length} chars)` : s;
}

/** Last `StreamStateChanged` an OBS instance pushed to this worker. */
export interface ObsStreamState {
  outputActive: boolean;
  outputState: string; // OBS_WEBSOCKET_OUTPUT_STARTING | STARTED | STOPPING | STOPPED | RECONNECTING | RECONNECTED
  at: number;
}
const lastStreamState = new Map<string, ObsStreamState>();

/** The last streaming-output state event OBS at `url` sent (since we connected), if any. */
export function lastStreamStateFor(url: string): ObsStreamState | undefined {
  return lastStreamState.get(url);
}

/** True while OBS's last event says the output is still coming up / reconnecting. */
export function outputInFlight(state: ObsStreamState | undefined): boolean {
  return !!state && /_(STARTING|RECONNECTING)$/.test(state.outputState);
}

function pollSignature(res: unknown): string {
  const r = (res ?? {}) as Record<string, unknown>;
  return summarizeObsValue({ outputActive: r.outputActive, outputReconnecting: r.outputReconnecting });
}

/**
 * Monkey-patch `call` on one client so every request → response (or failure) is
 * logged for that url. Polls are de-duplicated (logged on change) unless
 * OBS_WS_LOG=all.
 */
function installCallLogging(obs: OBSWebSocket, url: string): void {
  const raw = obs.call.bind(obs) as (requestType: string, requestData?: unknown) => Promise<unknown>;
  const lastPoll = new Map<string, string>();
  const wrapped = async (requestType: string, requestData?: unknown): Promise<unknown> => {
    const mode = wsLogMode();
    const isPoll = POLL_REQUESTS.has(requestType);
    const verbose = mode === "all" || (mode === "default" && !isPoll);
    if (verbose) {
      const params = requestData === undefined ? "" : ` ${summarizeObsValue(redactObsValue(requestData))}`;
      log(TAG, `→ ${url} ${requestType}${params}`);
    }
    const t0 = Date.now();
    try {
      const res = await raw(requestType, requestData);
      const ms = Date.now() - t0;
      if (verbose) {
        log(TAG, `← ${url} ${requestType} ok ${ms}ms ${summarizeObsValue(redactObsValue(res))}`.trimEnd());
      } else if (mode === "default" && isPoll) {
        const sig = pollSignature(res);
        if (lastPoll.get(requestType) !== sig) {
          lastPoll.set(requestType, sig);
          log(TAG, `← ${url} ${requestType} changed: ${sig}`);
        }
      }
      return res;
    } catch (err) {
      log(TAG, `← ${url} ${requestType} FAILED ${Date.now() - t0}ms: ${String((err as Error)?.message ?? err)}`);
      throw err;
    }
  };
  obs.call = wrapped as typeof obs.call;
}

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
  lastStreamState.delete(url); // events stop with the connection — don't report a stale one
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
  installCallLogging(obs, url);
  obs.on("ConnectionClosed", () => {
    log(TAG, "connection closed", url);
    if (conns.get(url)?.client === obs) reset(url);
  });
  obs.on("ConnectionError", (err: unknown) => log(TAG, "connection error", `${url}: ${String(err)}`));
  obs.on("Identified", (d) => log(TAG, `${url} identified (rpc v${d.negotiatedRpcVersion})`));
  // The one event that answers "did StartStream actually take?" — OBS reports the
  // output's real lifecycle here, long after the request itself returned OK.
  obs.on("StreamStateChanged", (d) => {
    lastStreamState.set(url, { outputActive: !!d.outputActive, outputState: String(d.outputState), at: Date.now() });
    log(TAG, `${url} event StreamStateChanged ${d.outputState} (active=${d.outputActive})`);
  });
  obs.on("ExitStarted", () => log(TAG, `${url} event ExitStarted — OBS is shutting down`));

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

/**
 * Go-live hard-reset guard: if this instance's streaming output is still active
 * (a crashed/stale run's leftover — the per-encoder guard means no live run of
 * ours should be on it), stop it and wait for it to settle, so the new stream
 * key isn't set under a running output (OBS only reads the key at StartStream —
 * a stale output would keep pushing to the OLD destination while the run sits
 * on AWAITING INGEST forever). Returns true if a stale output was stopped;
 * proceeds after `timeoutMs` even if it's still draining.
 */
export async function ensureOutputStopped(ep: ObsEndpoint, timeoutMs = 8_000): Promise<boolean> {
  return withObs(ep, async (obs) => {
    const status = await obs.call("GetStreamStatus");
    if (!status.outputActive) return false;
    await obs.call("StopStream");
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      await new Promise((r) => setTimeout(r, 500));
      const cur = await obs.call("GetStreamStatus");
      if (!cur.outputActive) return true;
    }
    return true;
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
  /** Settings → Stream as OBS holds it right now (server only — the key never leaves the worker). */
  service?: { type: string; server?: string; keySet: boolean };
  /** Last StreamStateChanged OBS pushed to this worker, e.g. OBS_WEBSOCKET_OUTPUT_STOPPED. */
  lastState?: string;
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
    let service: ObsProbe["service"];
    try {
      const svc = await obs.call("GetStreamServiceSettings");
      const st = (svc.streamServiceSettings ?? {}) as Record<string, unknown>;
      service = {
        type: String(svc.streamServiceType ?? "?"),
        server: typeof st.server === "string" ? st.server : undefined,
        keySet: typeof st.key === "string" && st.key.length > 0,
      };
    } catch {
      /* optional readout — an odd build without it must not fail the probe */
    }
    return {
      obsVersion: String(v.obsVersion ?? "?"),
      websocketVersion: String(v.obsWebSocketVersion ?? "?"),
      streaming: !!s.outputActive,
      outputBytes: Number(s.outputBytes ?? 0),
      service,
      lastState: lastStreamState.get(ep.url)?.outputState,
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
 * Settings keys the app OWNS on its auto-provisioned browser source — stamped
 * on every provision, so tuning is central (change `OBS_BROWSER_FPS`, restart
 * the worker, and the next go-live applies it everywhere) instead of frozen
 * into whatever each source happened to be created with:
 *  - url/width/height → the tokened /watch URL at exact canvas size;
 *  - fps_custom+fps → CEF paints at the stream's real frame rate, not 60;
 *  - shutdown/restart_when_active off → a scene switch must never reload the
 *    globe (black frame + a full texture refetch storm);
 *  - reroute_audio → the page's audio bed reaches the stream mix instead of
 *    playing on the encoder host.
 * Anything else (custom css, zoom…) is the operator's: soft updates preserve it
 * via overlay:true, hard recreates carry it forward via `existing`. An operator
 * who wants full manual control builds their own source under a different name
 * — provisioning only ever touches `PhotonSurge globe — <scene>`.
 */
const MANAGED_KEYS = new Set([
  "url",
  "width",
  "height",
  "reroute_audio",
  "fps_custom",
  "fps",
  "shutdown",
  "restart_when_active",
]);

/**
 * Settings pushed onto the /watch browser source. Managed keys (above) are
 * always ours; pass `existing` (the input's current settings) on a recreate to
 * carry the operator's unmanaged primitive tweaks (e.g. css) into the new input.
 */
export function browserSourceSettings(
  base: { url: string; width: number; height: number },
  existing?: Record<string, unknown> | null,
): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  if (existing) {
    for (const [k, v] of Object.entries(existing)) {
      if (MANAGED_KEYS.has(k)) continue;
      // Primitive-valued tweaks only — enough for css/zoom-style settings, and
      // keeps the payload a clean JsonObject.
      if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") out[k] = v;
    }
  }
  return {
    ...out,
    ...base,
    reroute_audio: true,
    fps_custom: true,
    fps: browserSourceFps(),
    shutdown: false,
    restart_when_active: false,
  };
}

/** Result of provisioning a browser-source scene. */
export interface ProvisionResult {
  sceneName: string;
  inputName: string;
  width: number;
  height: number;
  created: boolean; // input was newly created (vs URL updated)
  recreated: boolean; // hard reset: existing input torn down and rebuilt (fresh CEF)
  switched: boolean; // program scene was switched to it
  refreshed: boolean; // CEF page was (re)loaded onto the current URL
  removedInputs: string[]; // other channels' / stray /watch browser sources swept out
  removedScenes: string[]; // our scenes for other channels, swept out
}

/**
 * Full auto-provision: create-or-update a full-canvas browser source pointing at
 * `url`, in a dedicated scene, and (optionally) switch OBS to it. Idempotent — a
 * re-run just updates the URL (so a rotated watch token re-pushes cleanly) and
 * re-applies the transform. Sizes the source to the OBS base canvas for a crisp,
 * exact-fit render.
 *
 * `hard:true` = the go-live hard reset: an existing input is REMOVED and
 * recreated, which tears down that CEF browser entirely — dropping accumulated
 * renderer state/memory from a long-lived instance and guaranteeing the page
 * cold-starts fresh on the new run's URL. Unmanaged operator tweaks (css…) are
 * read first and carried onto the new input. OBS frees a removed source
 * asynchronously, so the recreate WAITS for the name to be released (see
 * ./rebuild.ts) — racing it fails with "A source already exists by that input
 * name" and leaves the scene empty. Soft mode just restamps the managed
 * settings (overlay:true preserves the rest) and presses a no-cache refresh.
 *
 * It also SWEEPS the instance (see ./prune.ts) down to this one channel: another
 * channel's globe left parked here by an earlier setup is a whole extra Chromium
 * holding a socket, textures and a render loop against the same GPU as the scene
 * on air — hidden costs exactly as much as visible, because our sources are
 * provisioned `shutdown:false`. Sources go first (before the fresh one is built,
 * so we never peak at N+1 pages), scenes after the switch (never the program
 * scene). `OBS_PRUNE=off` leaves a hand-built instance untouched.
 */
export async function provisionBrowserScene(
  ep: ObsEndpoint,
  opts: { url: string; sceneName: string; inputName: string; makeActive?: boolean; hard?: boolean; prune?: boolean },
): Promise<ProvisionResult> {
  const { url, sceneName, inputName: canonicalName, makeActive = true, hard = false } = opts;
  const prune = opts.prune ?? pruneEnabled();
  return withObs(ep, async (obs) => {
    const video = await obs.call("GetVideoSettings");
    const width = Number(video.baseWidth) || 1920;
    const height = Number(video.baseHeight) || 1080;
    const base = { url, width, height };

    // Sweep other channels' globes (and stray /watch sources) out FIRST: each one
    // is a live Chromium, and freeing them before the rebuild keeps peak memory at
    // one page. Best-effort — a sweep failure must never cost us the provision.
    const removedInputs: string[] = [];
    if (prune) {
      try {
        removedInputs.push(...(await pruneForeignInputs(obs, canonicalName)));
        if (removedInputs.length) log(TAG, `${ep.url} swept ${removedInputs.length} stray browser source(s): ${removedInputs.join(", ")}`);
      } catch (err) {
        log(TAG, "source sweep failed (non-fatal)", String((err as Error)?.message ?? err));
      }
    }

    const { scenes } = await obs.call("GetSceneList");
    if (!(scenes as { sceneName: string }[]).some((s) => s.sceneName === sceneName)) {
      await obs.call("CreateScene", { sceneName });
    }

    // Ours = the canonical name plus any `<name> #n` sibling a previous reset had
    // to fall back to (see ./rebuild.ts). A removed-but-not-yet-freed source is
    // still listed here, which is exactly why the hard path must wait, not race.
    const ours = ourInputs(await listInputNames(obs), canonicalName);
    let created = false;
    let recreated = false;
    let inputName = canonicalName;
    if (ours.length === 0) {
      await obs.call("CreateInput", {
        sceneName,
        inputName,
        inputKind: "browser_source",
        inputSettings: browserSourceSettings(base),
        sceneItemEnabled: true,
      });
      created = true;
    } else if (hard) {
      // Hard reset: carry the operator's unmanaged tweaks forward from the live
      // source (best-effort read — unreadable → just ours), then tear every one
      // of ours down and rebuild from scratch once OBS has released the name.
      const live = (await pickLiveInput(obs, sceneName, ours)) ?? ours[0];
      let existing: Record<string, unknown> | null = null;
      try {
        const cur = await obs.call("GetInputSettings", { inputName: live });
        existing = (cur.inputSettings ?? {}) as Record<string, unknown>;
      } catch {
        existing = null;
      }
      const r = await rebuildBrowserInput(obs, {
        sceneName,
        inputName: canonicalName,
        existing: ours,
        inputSettings: browserSourceSettings(base, existing),
      });
      inputName = r.inputName;
      recreated = true;
      if (r.fallback) {
        log(
          TAG,
          `${ep.url} did not release "${canonicalName}" within ${r.waitedMs}ms — rebuilt the browser source as "${inputName}" instead`,
        );
      } else if (r.waitedMs > 1_000) {
        log(TAG, `${ep.url} took ${r.waitedMs}ms to release "${canonicalName}" before it could be recreated`);
      }
    } else {
      inputName = (await pickLiveInput(obs, sceneName, ours)) ?? ours[0];
      await obs.call("SetInputSettings", {
        inputName,
        inputSettings: browserSourceSettings(base),
        overlay: true, // unmanaged operator tweaks (css…) stay as they are
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

    // Now that OBS is on OUR scene, the leftover scenes can go — doing this before
    // the switch would hand OBS's program to a scene of its own choosing.
    const removedScenes: string[] = [];
    if (prune) {
      try {
        removedScenes.push(...(await pruneForeignScenes(obs, sceneName)));
        if (removedScenes.length) log(TAG, `${ep.url} swept ${removedScenes.length} stray scene(s): ${removedScenes.join(", ")}`);
      } catch (err) {
        log(TAG, "scene sweep failed (non-fatal)", String((err as Error)?.message ?? err));
      }
    }

    // Force a no-cache reload so the source actually navigates to the (possibly
    // just-changed) URL and drops any stale /watch bundle — the OBS "Refresh cache
    // of current page" button, done for the operator. A just-created/recreated
    // input already cold-loaded the URL, so skip the press there (a second load
    // would only race the first). Best-effort: a build/plugin without this
    // property must not fail the whole provision.
    let refreshed = created || recreated;
    if (!refreshed) {
      try {
        await obs.call("PressInputPropertiesButton", { inputName, propertyName: "refreshnocache" });
        refreshed = true;
      } catch (err) {
        log(TAG, "refreshnocache press failed (non-fatal)", `${inputName}: ${String((err as Error)?.message ?? err)}`);
      }
    }

    return { sceneName, inputName, width, height, created, recreated, switched, refreshed, removedInputs, removedScenes };
  });
}

/**
 * Force a no-cache reload of a browser source (the OBS "Refresh" button), without
 * touching scenes/URL. `inputName` is the canonical name; a `<name> #n` sibling
 * left by a fallback rebuild is found too (the one actually in `sceneName`
 * wins). Throws ObsUnavailableError if no such input exists yet. Returns the
 * name that was refreshed.
 */
export async function refreshBrowserSource(ep: ObsEndpoint, inputName: string, sceneName?: string): Promise<string> {
  return withObs(ep, async (obs) => {
    const ours = ourInputs(await listInputNames(obs), inputName);
    const live = sceneName ? await pickLiveInput(obs, sceneName, ours) : ours[0];
    if (!live) throw new ObsUnavailableError(`browser source "${inputName}" not found — provision it first`);
    await obs.call("PressInputPropertiesButton", { inputName: live, propertyName: "refreshnocache" });
    return live;
  });
}

/** A `data:image/…;base64,…` URL (what GetSourceScreenshot returns) → its bytes. */
export function decodeImageDataUrl(dataUrl: string): { mimeType: string; data: Buffer } {
  const m = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(dataUrl ?? "");
  if (!m || !m[2]) throw new Error("OBS screenshot is not a base64 data URL");
  const data = Buffer.from(m[3], "base64");
  if (!data.length) throw new Error("OBS screenshot is empty");
  return { mimeType: m[1] || "application/octet-stream", data };
}

/**
 * One frame of a source as OBS renders it (obs-websocket v5
 * `GetSourceScreenshot`): a scene or an input, scaled to `imageWidth` (aspect
 * kept when only the width is given). The offline test's evidence (short-video
 * plan §7) and a video's frame thumbnail (§6.8) — what OBS really drew, with
 * its fonts and its GPU, which a browser preview can't prove.
 */
export async function getSourceScreenshot(
  ep: ObsEndpoint,
  opts: { sourceName: string; imageFormat?: "jpg" | "png"; imageWidth?: number; imageCompressionQuality?: number },
): Promise<{ mimeType: string; data: Buffer }> {
  const res = await withObs(ep, (obs) =>
    obs.call("GetSourceScreenshot", {
      sourceName: opts.sourceName,
      imageFormat: opts.imageFormat ?? "jpg",
      ...(opts.imageWidth ? { imageWidth: Math.round(opts.imageWidth) } : {}),
      ...(opts.imageCompressionQuality != null ? { imageCompressionQuality: opts.imageCompressionQuality } : {}),
    }),
  );
  return decodeImageDataUrl(String((res as { imageData?: string }).imageData ?? ""));
}

/** Tear down every cached connection (worker shutdown). */
export function closeObs(): void {
  for (const url of [...conns.keys()]) reset(url);
}
