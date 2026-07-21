/**
 * OBS control channel for the streaming-runs feature. Talks the obs-websocket v5
 * protocol to a local (or LAN) OBS instance that captures /watch and pushes RTMP.
 *
 * Endpoint is configurable (`OBS_WEBSOCKET_URL`, e.g. ws://127.0.0.1:4455) so the
 * SAME code works with OBS on this box today and on a GPU VM later — the worker
 * and OBS just need to be network-reachable. `OBS_WEBSOCKET_PASSWORD` authenticates.
 *
 * Every call is throw-safe: if OBS is unreachable/unconfigured we throw
 * `ObsUnavailableError`, which the run orchestrator catches to fall back to a
 * MANUAL stream-key handoff (operator pastes the key into OBS) rather than failing
 * the run. A single lazy connection is reused across heartbeat polls and cleared
 * on error so the next call reconnects.
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

let client: OBSWebSocket | null = null;
let connecting: Promise<OBSWebSocket> | null = null;

/** True when an OBS endpoint is configured. Gates OBS-dependent behaviour. */
export function obsConfigured(): boolean {
  return !!process.env.OBS_WEBSOCKET_URL;
}

function reset() {
  if (client) {
    try {
      client.disconnect();
    } catch {
      /* ignore */
    }
  }
  client = null;
  connecting = null;
}

/** Ensure a live, authenticated OBS connection. Throws ObsUnavailableError on failure. */
async function ensure(): Promise<OBSWebSocket> {
  const url = process.env.OBS_WEBSOCKET_URL;
  if (!url) throw new ObsUnavailableError("OBS_WEBSOCKET_URL is not set");
  if (client) return client;
  if (connecting) return connecting;

  const password = process.env.OBS_WEBSOCKET_PASSWORD || undefined;
  const obs = new OBSWebSocket();
  obs.on("ConnectionClosed", () => {
    log(TAG, "connection closed");
    if (client === obs) reset();
  });
  obs.on("ConnectionError", (err: unknown) => log(TAG, "connection error", String(err)));

  connecting = (async () => {
    try {
      await Promise.race([
        obs.connect(url, password),
        new Promise((_, rej) => setTimeout(() => rej(new Error("connect timeout")), CONNECT_TIMEOUT_MS)),
      ]);
      client = obs;
      connecting = null;
      log(TAG, "connected", url);
      return obs;
    } catch (err) {
      connecting = null;
      try {
        await obs.disconnect();
      } catch {
        /* ignore */
      }
      throw new ObsUnavailableError(`cannot reach OBS at ${url}: ${String((err as Error)?.message ?? err)}`);
    }
  })();
  return connecting;
}

/** Run one OBS call; on any transport error reset the connection and rethrow as ObsUnavailableError. */
async function withObs<T>(fn: (obs: OBSWebSocket) => Promise<T>): Promise<T> {
  const obs = await ensure();
  try {
    return await fn(obs);
  } catch (err) {
    reset();
    if (err instanceof ObsUnavailableError) throw err;
    throw new ObsUnavailableError(String((err as Error)?.message ?? err));
  }
}

/** Point OBS at a custom RTMP server + stream key (the YouTube ingestion address + key). */
export async function setStreamKey(server: string, key: string): Promise<void> {
  await withObs((obs) =>
    obs.call("SetStreamServiceSettings", {
      streamServiceType: "rtmp_custom",
      streamServiceSettings: { server, key, use_auth: false },
    }),
  );
}

/** Start the OBS streaming output. Idempotent-ish: OBS errors if already streaming. */
export async function startStream(): Promise<void> {
  await withObs(async (obs) => {
    const status = await obs.call("GetStreamStatus");
    if (status.outputActive) return; // already streaming — treat as success
    await obs.call("StartStream");
  });
}

/** Stop the OBS streaming output. Best-effort — a not-streaming state is fine. */
export async function stopStream(): Promise<void> {
  await withObs(async (obs) => {
    const status = await obs.call("GetStreamStatus");
    if (!status.outputActive) return;
    await obs.call("StopStream");
  });
}

/** Current stream output status (for the health heartbeat). */
export async function getStatus(): Promise<ObsStreamStatus> {
  return withObs(async (obs) => {
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

/** Tear down the shared connection (worker shutdown). */
export function closeObs(): void {
  reset();
}
