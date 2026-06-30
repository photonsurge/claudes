/**
 * Client-side auto-director helpers.
 *
 * Two flows:
 *  - Config (operator, /control): GET/PATCH /api/director/:scene/config. The
 *    worker re-reads the persisted config each tick, so a PATCH takes effect
 *    within ~1s — no operator→worker socket plumbing needed.
 *  - Live state (/watch + /control readout): the worker emits DIRECTOR_STATE on
 *    every cut + heartbeat; useDirector subscribes and returns the current shot
 *    for this scene.
 */
"use client";

import { useEffect, useState } from "react";
import {
  DIRECTOR_STATE,
  DEFAULT_DIRECTOR_CONFIG,
  type DirectorConfig,
  type DirectorState,
} from "@photonsurge/shared/director";
import { useSocket } from "./socket-provider";

/** Cold-start a scene's director config from the API. */
export async function fetchDirectorConfig(sceneId: string): Promise<DirectorConfig> {
  try {
    const res = await fetch(`/api/director/${encodeURIComponent(sceneId)}/config`, { cache: "no-store" });
    if (!res.ok) return DEFAULT_DIRECTOR_CONFIG;
    return (await res.json()) as DirectorConfig;
  } catch {
    return DEFAULT_DIRECTOR_CONFIG;
  }
}

/** Persist a director-config patch for a scene; returns the merged config. */
export async function patchDirectorConfig(
  sceneId: string,
  patch: Partial<DirectorConfig>,
): Promise<DirectorConfig> {
  const res = await fetch(`/api/director/${encodeURIComponent(sceneId)}/config`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  return (await res.json()) as DirectorConfig;
}

/**
 * Operator hook: load + edit a scene's director config. `update` PATCHes the
 * server and optimistically updates local state.
 */
export function useDirectorConfig(sceneId: string): {
  config: DirectorConfig;
  ready: boolean;
  update: (patch: Partial<DirectorConfig>) => void;
} {
  const [config, setConfig] = useState<DirectorConfig>(DEFAULT_DIRECTOR_CONFIG);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setReady(false);
    fetchDirectorConfig(sceneId).then((c) => {
      if (cancelled) return;
      setConfig(c);
      setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [sceneId]);

  const update = (patch: Partial<DirectorConfig>) => {
    setConfig((prev) => ({ ...prev, ...patch, kinds: { ...prev.kinds, ...(patch.kinds ?? {}) } }));
    void patchDirectorConfig(sceneId, patch).then(setConfig);
  };

  return { config, ready, update };
}

/**
 * Live director state for a scene, or null when the director isn't driving it.
 * Reads the worker-event envelope's `data` field, filtered by scene id.
 */
export function useDirector(sceneId: string): DirectorState | null {
  const { socket } = useSocket();
  const [state, setState] = useState<DirectorState | null>(null);

  useEffect(() => {
    setState(null); // reset when switching scenes
    if (!socket) return;
    const onDirector = (payload: { data?: DirectorState } & Partial<DirectorState>) => {
      const ds = (payload?.data ?? payload) as DirectorState;
      if (!ds || ds.sceneId !== sceneId) return;
      setState(ds.active ? ds : null);
    };
    socket.on(DIRECTOR_STATE, onDirector);
    return () => {
      socket.off(DIRECTOR_STATE, onDirector);
    };
  }, [socket, sceneId]);

  return state;
}
