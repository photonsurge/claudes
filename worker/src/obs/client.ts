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

/** Tear down every cached connection (worker shutdown). */
export function closeObs(): void {
  for (const url of [...conns.keys()]) reset(url);
}
