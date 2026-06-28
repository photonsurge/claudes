/**
 * Client-side control-state helpers.
 *
 * Source of truth flow (see shared/control): /control mutates state → emits
 * CONTROL_STATE over the socket (instant) + debounced-persists to
 * /api/broadcast/state (durable). /watch cold-starts from the API then live
 * updates from CONTROL_STATE.
 */
"use client";

import { useEffect, useRef, useState } from "react";
import type { Socket } from "socket.io-client";
import {
  CONTROL_STATE,
  DEFAULT_CONTROL_STATE,
  mergeControlState,
  type ControlState,
} from "@photonsurge/shared/control";
import { useSocket } from "./socket-provider";

/** Cold-start the broadcast state from the API. */
export async function fetchBroadcastState(): Promise<ControlState> {
  try {
    const res = await fetch("/api/broadcast/state", { cache: "no-store" });
    if (!res.ok) return DEFAULT_CONTROL_STATE;
    const json = await res.json();
    return mergeControlState(DEFAULT_CONTROL_STATE, json ?? {});
  } catch {
    return DEFAULT_CONTROL_STATE;
  }
}

/**
 * Subscribe to live control state. Cold-starts from the API, then applies any
 * CONTROL_STATE socket patches via the shared merge. Returns the live state.
 */
export function useBroadcastState(): {
  state: ControlState;
  setState: React.Dispatch<React.SetStateAction<ControlState>>;
  ready: boolean;
} {
  const { socket } = useSocket();
  const [state, setState] = useState<ControlState>(DEFAULT_CONTROL_STATE);
  const [ready, setReady] = useState(false);

  // Cold start.
  useEffect(() => {
    let cancelled = false;
    fetchBroadcastState().then((s) => {
      if (cancelled) return;
      setState(s);
      setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Live updates.
  useEffect(() => {
    if (!socket) return;
    const onState = (patch: Partial<ControlState>) =>
      setState((prev) => mergeControlState(prev, patch ?? {}));
    socket.on(CONTROL_STATE, onState);
    return () => {
      socket.off(CONTROL_STATE, onState);
    };
  }, [socket]);

  return { state, setState, ready };
}

const PERSIST_DEBOUNCE_MS = 400;

async function persistState(state: ControlState): Promise<void> {
  try {
    await fetch("/api/broadcast/state", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(state),
    });
  } catch {
    // Persistence is best-effort; the live socket update already propagated.
  }
}

/**
 * Operator emit: push the full state over the socket immediately, and persist
 * to Mongo on a debounce. The `persist` arg is injectable for tests.
 */
export function emitControlState(
  socket: Socket | null,
  state: ControlState,
  persist: (s: ControlState) => void,
): void {
  socket?.emit(CONTROL_STATE, state);
  persist(state);
}

/**
 * Hook that returns a stable `emit` fn wiring the live socket + debounced
 * persist. Call it from /control whenever local state changes.
 */
export function useControlEmitter(): (state: ControlState) => void {
  const { socket } = useSocket();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef<ControlState | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  return (state: ControlState) => {
    latest.current = state;
    const debouncedPersist = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        if (latest.current) persistState(latest.current);
      }, PERSIST_DEBOUNCE_MS);
    };
    emitControlState(socket, state, debouncedPersist);
  };
}
