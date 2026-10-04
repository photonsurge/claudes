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
  type SceneKind,
  type SceneMeta,
  type SceneStatePayload,
} from "@photonsurge/shared/control";
import { useSocket } from "./socket-provider";
import { useLoadAndResync } from "./use-resync";

/**
 * List scenes (main first, then by name) — all of them, or one kind: the
 * channel lists (/admin/scenes, the stream and slot forms) pass
 * `{ kind: "channel" }` so short format scenes stay off them.
 */
export async function listScenes(opts: { kind?: SceneKind } = {}): Promise<SceneMeta[]> {
  try {
    const qs = opts.kind ? `?kind=${encodeURIComponent(opts.kind)}` : "";
    const res = await fetch(`/api/scenes${qs}`, { cache: "no-store" });
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
): Promise<{ state: ControlState; tokenError: boolean; ok: boolean }> {
  try {
    const qs = token ? `?token=${encodeURIComponent(token)}` : "";
    const res = await fetch(`/api/scenes/${encodeURIComponent(id)}${qs}`, { cache: "no-store" });
    if (res.status === 401) return { state: DEFAULT_CONTROL_STATE, tokenError: true, ok: false };
    if (!res.ok) return { state: DEFAULT_CONTROL_STATE, tokenError: false, ok: false };
    const json = await res.json();
    return { state: mergeControlState(DEFAULT_CONTROL_STATE, json ?? {}), tokenError: false, ok: true };
  } catch {
    return { state: DEFAULT_CONTROL_STATE, tokenError: false, ok: false };
  }
}

/**
 * `fetchSceneState` shaped for retryUntil: null on a transient failure (5xx,
 * refused, timeout) so the loop goes again; a 401 is final and lands as-is.
 */
export const loadSceneState = (id: string, token?: string) =>
  fetchSceneState(id, token).then((r) => (r.ok || r.tokenError ? r : null));

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
 * Persist only a partial scene patch (merged server-side via mergeControlState).
 * Used by config forms — e.g. the per-channel widget layout on /admin/scenes/:id
 * — that must NOT clobber the operator's live full state (camera, layers) the
 * way persisting a stale whole snapshot would.
 *
 * Returns the outcome rather than throwing: the debounced live patchers ignore
 * it (the socket already carried the change), while the settings page's Save
 * awaits it so a rejected write surfaces instead of looking saved.
 */
export async function patchScene(
  id: string,
  patch: Partial<ControlState>,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`/api/scenes/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (res.ok) return { ok: true };
    const body = await res.json().catch(() => ({}));
    return { ok: false, error: body?.error || `HTTP ${res.status}` };
  } catch (err) {
    return { ok: false, error: String(err) };
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

  // Cold start (re-runs if the id or token changes), retried until it lands and
  // re-run on every socket (re)connect — see use-resync.ts for why a one-shot
  // fetch stranded OBS pages on DEFAULT_CONTROL_STATE (audio off) for days.
  useEffect(() => setReady(false), [sceneId, token]);
  useLoadAndResync(
    socket,
    () => loadSceneState(sceneId, token),
    ({ state: s, tokenError: te }) => {
      setState(s);
      setTokenError(te);
      setReady(true);
    },
    [sceneId, token],
  );

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

/**
 * Pure delta-emit for scenes: push a PARTIAL patch over SCENE_STATE (its `state`
 * field carries only the changed keys, which /watch merges via mergeControlState)
 * and, for the main scene, the legacy CONTROL_STATE. Then persist the same delta.
 * `persist` is injectable for tests. Mirrors `emitSceneState`, but never sends a
 * full state — so a config form can't overwrite what the operator drives live.
 */
export function emitScenePatch(
  socket: { emit: (e: string, ...a: unknown[]) => void } | null,
  sceneId: string,
  patch: Partial<ControlState>,
  persist: (id: string, p: Partial<ControlState>) => void,
): void {
  socket?.emit(SCENE_STATE, { id: sceneId, state: patch } as SceneStatePayload);
  if (sceneId === MAIN_SCENE_ID) socket?.emit(CONTROL_STATE, patch);
  persist(sceneId, patch);
}

/**
 * Hook wiring a live socket + debounced persist for PARTIAL scene patches.
 * Returns a stable `(sceneId, patch)` fn that emits the delta instantly and
 * debounce-persists it to `/api/scenes/:id` (last write per scene wins). Unlike
 * `useSceneEmitter` it never sends a full state — see `emitScenePatch`.
 */
export function useScenePatcher(): (sceneId: string, patch: Partial<ControlState>) => void {
  const { socket } = useSocket();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef<{ id: string; patch: Partial<ControlState> } | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  return (sceneId: string, patch: Partial<ControlState>) => {
    latest.current = { id: sceneId, patch };
    const debouncedPersist = (id: string) => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        if (latest.current && latest.current.id === id) patchScene(id, latest.current.patch);
      }, PERSIST_DEBOUNCE_MS);
    };
    emitScenePatch(socket, sceneId, patch, debouncedPersist);
  };
}

export { MAIN_SCENE_ID };
