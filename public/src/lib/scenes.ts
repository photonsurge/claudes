/**
 * Client CRUD + live-state helpers for broadcast *scenes*.
 *
 * A scene is a named ControlState rendered at `/watch/:id` (an OBS source /
 * overlay window). The main scene (`MAIN_SCENE_ID`) is the legacy `/watch`. The
 * operator drives a scene from `/control`: each change emits SCENE_STATE over the
 * socket (instant) and debounce-persists to `/api/scenes/:id` (durable).
 */
"use client";

import { useEffect, useRef, useState } from "react";
import {
  CONTROL_STATE,
  DEFAULT_CONTROL_STATE,
  mergeControlState,
  SCENE_STATE,
  MAIN_SCENE_ID,
  type ControlState,
  type SceneMeta,
  type SceneStatePayload,
} from "@photonsurge/shared/control";
import { useSocket } from "./socket-provider";

/** List all scenes (main first, then by name). */
export async function listScenes(): Promise<SceneMeta[]> {
  try {
    const res = await fetch("/api/scenes", { cache: "no-store" });
    if (!res.ok) return [];
    const json = await res.json();
    return Array.isArray(json?.scenes) ? json.scenes : [];
  } catch {
    return [];
  }
}

/** Cold-start a single scene's ControlState from the API (defaults on failure).
 * `tokenError` is true on a 401 (missing/invalid watch token) so /watch/:id can
 * show that distinctly from "still loading" instead of silently defaulting. */
export async function fetchSceneState(
  id: string,
  token?: string,
): Promise<{ state: ControlState; tokenError: boolean }> {
  try {
    const qs = token ? `?token=${encodeURIComponent(token)}` : "";
    const res = await fetch(`/api/scenes/${encodeURIComponent(id)}${qs}`, { cache: "no-store" });
    if (res.status === 401) return { state: DEFAULT_CONTROL_STATE, tokenError: true };
    if (!res.ok) return { state: DEFAULT_CONTROL_STATE, tokenError: false };
    const json = await res.json();
    return { state: mergeControlState(DEFAULT_CONTROL_STATE, json ?? {}), tokenError: false };
  } catch {
    return { state: DEFAULT_CONTROL_STATE, tokenError: false };
  }
}

/** Rotate a scene's watch token, invalidating any previously-copied /watch URL. */
export async function rotateSceneToken(id: string): Promise<{ token?: string; error?: string }> {
  try {
    const res = await fetch(`/api/scenes/${encodeURIComponent(id)}/rotate-token`, { method: "POST" });
    const json = await res.json().catch(() => ({}));
    return res.ok ? { token: json.watchToken } : { error: json.error || `HTTP ${res.status}` };
  } catch (err) {
    return { error: String(err) };
  }
}

/** Create a scene by name (id is slugged server-side). Returns the new id, or an error. */
export async function createScene(
  name: string,
  copyFrom?: string,
): Promise<{ id?: string; error?: string }> {
  try {
    const res = await fetch("/api/scenes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, copyFrom }),
    });
    const json = await res.json().catch(() => ({}));
    return res.ok ? { id: json.id } : { error: json.error || `HTTP ${res.status}` };
  } catch (err) {
    return { error: String(err) };
  }
}

/** Delete a scene by id. */
export async function deleteScene(id: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`/api/scenes/${encodeURIComponent(id)}`, { method: "DELETE" });
    const json = await res.json().catch(() => ({}));
    return res.ok ? { ok: true } : { ok: false, error: json.error || `HTTP ${res.status}` };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

/** Persist a scene's full state (best-effort; the live socket already propagated). */
export async function persistScene(id: string, state: ControlState): Promise<void> {
  try {
    await fetch(`/api/scenes/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(state),
    });
  } catch {
    /* best-effort */
  }
}

/**
 * Subscribe to a scene's live ControlState for a `/watch/:id` page: cold-start
 * from the API, then apply SCENE_STATE patches whose id matches. Returns the
 * live state + a `ready` flag.
 */
export function useSceneState(
  sceneId: string,
  token?: string,
): { state: ControlState; ready: boolean; tokenError: boolean } {
  const { socket } = useSocket();
  const [state, setState] = useState<ControlState>(DEFAULT_CONTROL_STATE);
  const [ready, setReady] = useState(false);
  const [tokenError, setTokenError] = useState(false);

  // Cold start (re-runs if the id or token changes).
  useEffect(() => {
    let cancelled = false;
    setReady(false);
    fetchSceneState(sceneId, token).then(({ state: s, tokenError: te }) => {
      if (cancelled) return;
      setState(s);
      setTokenError(te);
      setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [sceneId, token]);

  // Live updates scoped to this scene id.
  useEffect(() => {
    if (!socket) return;
    const onScene = (payload: SceneStatePayload) => {
      if (!payload || payload.id !== sceneId) return;
      setState((prev) => mergeControlState(prev, payload.state ?? {}));
    };
    socket.on(SCENE_STATE, onScene);
    return () => {
      socket.off(SCENE_STATE, onScene);
    };
  }, [socket, sceneId]);

  return { state, ready, tokenError };
}

const PERSIST_DEBOUNCE_MS = 400;

/**
 * Operator emit for scenes. Returns a stable `(sceneId, state)` fn that pushes
 * SCENE_STATE live and debounce-persists to `/api/scenes/:id`. When the target
 * is the main scene it also emits the legacy CONTROL_STATE so the bare `/watch`
 * keeps following. The `persist` arg is injectable for tests.
 */
export function emitSceneState(
  socket: { emit: (e: string, ...a: unknown[]) => void } | null,
  sceneId: string,
  state: ControlState,
  persist: (id: string, s: ControlState) => void,
): void {
  socket?.emit(SCENE_STATE, { id: sceneId, state } satisfies SceneStatePayload);
  if (sceneId === MAIN_SCENE_ID) socket?.emit(CONTROL_STATE, state);
  persist(sceneId, state);
}

/** Hook wiring the live socket + per-scene debounced persist for `/control`. */
export function useSceneEmitter(): (sceneId: string, state: ControlState) => void {
  const { socket } = useSocket();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef<{ id: string; state: ControlState } | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  return (sceneId: string, state: ControlState) => {
    latest.current = { id: sceneId, state };
    const debouncedPersist = (id: string) => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        if (latest.current && latest.current.id === id) persistScene(id, latest.current.state);
      }, PERSIST_DEBOUNCE_MS);
    };
    emitSceneState(socket, sceneId, state, debouncedPersist);
  };
}

export { MAIN_SCENE_ID };
