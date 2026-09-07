"use client";

/**
 * Client-side streaming-run helpers, mirroring lib/director.ts:
 *  - Config/commands (operator, /control + /admin/streams): POST /api/streams to
 *    go live, POST /api/streams/:id/stop to end — the worker holds the OBS/YouTube
 *    credentials; the browser only calls these routes.
 *  - Live state: the worker emits RUN_STATE on every lifecycle change and RUN_STATUS
 *    (health) on a heartbeat; these hooks subscribe and expose the current run +
 *    health per scene.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  RUN_STATE,
  RUN_STATUS,
  runIsActive,
  youtubeChatUrl,
  type RunState,
  type StreamHealth,
  type CreateRunRequest,
  type StreamEncoderInfo,
  type StreamSlot,
} from "@photonsurge/shared/runs";
import { useSocket } from "./socket-provider";

export interface StreamAccount {
  channelId: string;
  channelTitle?: string;
  connectedAt?: number;
}

export interface StreamSnapshot {
  youtubeConfigured: boolean;
  obsConfigured: boolean;
  accounts: StreamAccount[];
  encoders: StreamEncoderInfo[];
  slots: StreamSlot[];
  runs: RunState[];
}

const jsonHeaders = { "Content-Type": "application/json" };

/** Cold-start snapshot (admin) + live run:state/run:status merged in. For /control + /admin/streams. */
export function useStreams() {
  const { socket } = useSocket();
  const [snapshot, setSnapshot] = useState<StreamSnapshot | null>(null);
  const [health, setHealth] = useState<Record<string, StreamHealth>>({});
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    try {
      const res = await fetch("/api/streams", { cache: "no-store" });
      if (res.status === 401) {
        setError("admin only");
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setSnapshot((await res.json()) as StreamSnapshot);
      setError(null);
    } catch (e) {
      setError(String((e as Error)?.message ?? e));
    }
  }, []);

  useEffect(() => {
    refetch();
  }, [refetch]);

  useEffect(() => {
    if (!socket) return;
    const onState = (payload: { data?: RunState } & Partial<RunState>) => {
      const rs = (payload?.data ?? payload) as RunState;
      if (!rs?.id) return;
      setSnapshot((prev) => {
        const runs = prev?.runs ? [...prev.runs] : [];
        const i = runs.findIndex((r) => r.id === rs.id);
        if (i >= 0) runs[i] = rs;
        else runs.unshift(rs);
        return prev
          ? { ...prev, runs }
          : { youtubeConfigured: false, obsConfigured: false, accounts: [], encoders: [], slots: [], runs };
      });
    };
    const onHealth = (payload: { data?: StreamHealth } & Partial<StreamHealth>) => {
      const h = (payload?.data ?? payload) as StreamHealth;
      if (!h?.runId) return;
      setHealth((prev) => ({ ...prev, [h.runId]: h }));
    };
    socket.on(RUN_STATE, onState);
    socket.on(RUN_STATUS, onHealth);
    return () => {
      socket.off(RUN_STATE, onState);
      socket.off(RUN_STATUS, onHealth);
    };
  }, [socket]);

  const activeRunFor = useCallback(
    (sceneId: string): RunState | null =>
      snapshot?.runs.find((r) => r.sceneId === sceneId && runIsActive(r.status)) ?? null,
    [snapshot],
  );

  return { snapshot, health, error, refetch, activeRunFor };
}

/** Start a run. Returns the created RunState, or throws with the server error. */
export async function startStream(body: CreateRunRequest): Promise<RunState> {
  const res = await fetch("/api/streams", { method: "POST", headers: jsonHeaders, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
  return data as RunState;
}

/** Stop a run (operator). */
export async function stopStream(runId: string): Promise<void> {
  const res = await fetch(`/api/streams/${runId}/stop`, { method: "POST" });
  if (!res.ok && res.status !== 202) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data?.error ?? `HTTP ${res.status}`);
  }
}

/** Fetch the RTMP ingestion address + stream key for manual OBS handoff (admin). */
export async function fetchStreamKey(runId: string): Promise<{ ingestionAddress: string; streamName: string }> {
  const res = await fetch(`/api/streams/${runId}/key`, { cache: "no-store" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
  return data as { ingestionAddress: string; streamName: string };
}

/** Create/update an OBS encoder registration. `password` is write-only (see the route). */
export async function saveEncoder(
  body: Partial<StreamEncoderInfo> & { url: string; password?: string; clearPassword?: boolean },
): Promise<StreamEncoderInfo> {
  const res = await fetch("/api/streams/encoders", { method: "POST", headers: jsonHeaders, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
  return data as StreamEncoderInfo;
}

/** Outcome of a read-only OBS reachability probe (see testEncoder). */
export interface ObsTestResult {
  reachable: boolean;
  url?: string;
  obsVersion?: string;
  websocketVersion?: string;
  streaming?: boolean;
  outputBytes?: number;
  /** Settings → Stream as OBS holds it (server only — never the key). */
  service?: { type: string; server?: string; keySet: boolean };
  /** Last StreamStateChanged OBS pushed to the worker (e.g. OBS_WEBSOCKET_OUTPUT_STOPPED). */
  lastState?: string;
  error?: string;
}

/** Probe an encoder's OBS (worker connects + reads version/status). Never starts a stream. */
export async function testEncoder(id: string): Promise<ObsTestResult> {
  const res = await fetch(`/api/streams/encoders/${encodeURIComponent(id)}/test`, { method: "POST" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
  return data as ObsTestResult;
}

/** Outcome of full auto-provision (worker pushes the browser-source scene into OBS). */
export interface ProvisionResult {
  ok: boolean;
  sceneName?: string;
  inputName?: string;
  url?: string;
  width?: number;
  height?: number;
  created?: boolean;
  switched?: boolean;
  refreshed?: boolean;
  error?: string;
}

/** Push a full-canvas browser source (the channel's tokened /watch URL) into the encoder's OBS. */
export async function provisionEncoder(id: string): Promise<ProvisionResult> {
  const res = await fetch(`/api/streams/encoders/${encodeURIComponent(id)}/provision`, { method: "POST" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
  return data as ProvisionResult;
}

/** Force a no-cache reload of the encoder's globe browser source (post-deploy, no scene switch). */
export async function refreshEncoder(id: string): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch(`/api/streams/encoders/${encodeURIComponent(id)}/refresh`, { method: "POST" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
  return data as { ok: boolean; error?: string };
}

/** Remove an encoder registration (refused while a run publishes through it). */
export async function deleteEncoder(id: string): Promise<void> {
  const res = await fetch(`/api/streams/encoders/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data?.error ?? `HTTP ${res.status}`);
  }
}

/** Create/update a persistent-stream slot. Toggling `enabled` starts/stops the constant stream. */
export async function saveSlot(body: Partial<StreamSlot> & { sceneId: string }): Promise<StreamSlot> {
  const res = await fetch("/api/streams/slots", { method: "POST", headers: jsonHeaders, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
  return data as StreamSlot;
}

/** Delete a slot (also ends the run it started, if still live). */
export async function deleteSlot(id: string): Promise<void> {
  const res = await fetch(`/api/streams/slots/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data?.error ?? `HTTP ${res.status}`);
  }
}

/** Begin the YouTube OAuth flow (full-page redirect to Google). */
export function connectYoutube(): void {
  window.location.href = "/api/youtube/connect";
}

/** Disconnect a stored YouTube channel. */
export async function disconnectYoutube(channelId: string): Promise<void> {
  await fetch("/api/youtube/disconnect", { method: "POST", headers: jsonHeaders, body: JSON.stringify({ channelId }) });
}

/**
 * PUBLIC live-status hooks for the home page: cold-start from the public
 * /api/streams/live, then live-update from RUN_STATE. Safe for anonymous
 * viewers — no admin, no secrets (watch/chat URLs are the public YouTube pages).
 */
export interface PublicRunLite {
  sceneId: string;
  status: string;
  title: string | null;
  watchUrl: string | null;
  chatUrl: string | null;
  startAt: number | null;
}

/** All currently-live runs keyed by scene id (one active run per scene). */
export function usePublicLiveRuns(): Record<string, PublicRunLite> {
  const { socket } = useSocket();
  const [runs, setRuns] = useState<Record<string, PublicRunLite>>({});
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    fetch("/api/streams/live", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { runs: [] }))
      .then((d: { runs: PublicRunLite[] }) => {
        if (!mounted.current) return;
        const live: Record<string, PublicRunLite> = {};
        for (const run of d.runs ?? []) if (run.status === "live") live[run.sceneId] = run;
        setRuns((prev) => ({ ...live, ...prev }));
      })
      .catch(() => {});
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (!socket) return;
    const onState = (payload: { data?: RunState } & Partial<RunState>) => {
      const rs = (payload?.data ?? payload) as RunState;
      if (!rs?.id || !rs.sceneId) return;
      setRuns((prev) => {
        if (rs.status === "live") {
          return {
            ...prev,
            [rs.sceneId]: {
              sceneId: rs.sceneId,
              status: rs.status,
              title: rs.title ?? null,
              watchUrl: rs.youtube?.watchUrl ?? null,
              chatUrl: youtubeChatUrl(rs.youtube?.broadcastId),
              startAt: rs.startAt ?? null,
            },
          };
        }
        if (!prev[rs.sceneId]) return prev;
        const next = { ...prev };
        delete next[rs.sceneId];
        return next;
      });
    };
    socket.on(RUN_STATE, onState);
    return () => {
      socket.off(RUN_STATE, onState);
    };
  }, [socket]);

  return runs;
}

/** The live run for one scene (the home-page badge), or null. */
export function usePublicLiveRun(sceneId: string): PublicRunLite | null {
  const runs = usePublicLiveRuns();
  return runs[sceneId] ?? null;
}
