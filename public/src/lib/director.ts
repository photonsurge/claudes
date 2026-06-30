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

import { useEffect, useMemo, useState } from "react";
import type { ControlState } from "@photonsurge/shared/control";
import {
  DIRECTOR_STATE,
  DEFAULT_DIRECTOR_CONFIG,
  type DirectorConfig,
  type DirectorState,
  type Segment,
  type SegmentKind,
} from "@photonsurge/shared/director";
import { useSocket } from "./socket-provider";

/**
 * While a detail shot holds on its subject, rotate the weather layer over time
 * so the same event is read through several fields (gust → rain → CAPE → …).
 * The index is derived from the cut's spinEpoch + a fixed period, so /control
 * and /watch switch in lockstep — the same deterministic trick as the spin /
 * push-in, with no extra socket traffic.
 */
const DETAIL_VAR_CYCLE: Partial<Record<SegmentKind, string[]>> = {
  storm: ["gust", "rain", "storm", "humidity"],
  quake: ["temp", "humidity", "rain", "gust"],
};
const VAR_CYCLE_MS = 5500;

/**
 * The weather variable to show for the current moment of a cut, or null to leave
 * the cut's own variable untouched. Updates on a slow timer (not per frame).
 */
export function useCutVariable(cut: Segment | null): string | null {
  const [variable, setVariable] = useState<string | null>(null);
  useEffect(() => {
    const cycle = cut ? DETAIL_VAR_CYCLE[cut.kind] : undefined;
    if (!cut || !cycle?.length) {
      setVariable(null);
      return;
    }
    const epoch = cut.patch.spinEpoch ?? 0;
    const pick = () => {
      const elapsed = Math.max(0, Date.now() - epoch);
      setVariable(cycle[Math.floor(elapsed / VAR_CYCLE_MS) % cycle.length]);
    };
    pick();
    const t = setInterval(pick, 500);
    return () => clearInterval(t);
  }, [cut]);
  return variable;
}

/**
 * The effective ControlState patch for the current cut: its baseline patch with
 * the time-cycled weather variable folded in (detail shots only). Pages merge
 * this over their own state to get what to render. Null when no cut is on air.
 */
export function useDirectorPatch(cut: Segment | null): Partial<ControlState> | null {
  const cutVariable = useCutVariable(cut);
  return useMemo(() => {
    if (!cut) return null;
    return cutVariable ? { ...cut.patch, activeVariable: cutVariable } : cut.patch;
  }, [cut, cutVariable]);
}

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
