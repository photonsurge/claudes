"use client";

import { useEffect, useState } from "react";
import type { Fault } from "@photonsurge/shared/faults/types";
import { useSocket } from "./socket-provider";
import { TRACKS_UPDATED } from "@photonsurge/shared/control";

const EMPTY: Fault[] = [];

/**
 * Load worker-cached tectonic plate boundaries for the globe overlay. The
 * dataset is effectively fixed, so there's no polling interval — we fetch once
 * when the overlay is enabled and refetch only when the worker emits
 * TRACKS_UPDATED (kind "faults") after a refresh lands. Disabling drops the data
 * to free GL memory.
 */
export function useFaults(enabled: boolean): Fault[] {
  const [data, setData] = useState<Fault[]>(EMPTY);
  const { socket } = useSocket();
  const [liveTick, setLiveTick] = useState(0);
  // `enabled` ARMS the fetch; the data is then kept for the page (the map-type
  // tour flips showFaults every few steps — see cables-overlay.ts, round 51).
  const [armed, setArmed] = useState(enabled);
  if (enabled && !armed) setArmed(true);

  useEffect(() => {
    if (!socket) return;
    const onUpdated = (p?: { kind?: string }) => {
      if (p?.kind === "faults") setLiveTick((n) => n + 1);
    };
    socket.on(TRACKS_UPDATED, onUpdated);
    return () => {
      socket.off(TRACKS_UPDATED, onUpdated);
    };
  }, [socket]);

  useEffect(() => {
    if (!armed) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/faults", { cache: "no-store" });
        const body = await res.json().catch(() => null);
        if (!cancelled && body) setData(body.faults ?? []);
      } catch {
        /* leave previous data in place on a transient fetch error */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [armed, liveTick]);

  return data;
}
