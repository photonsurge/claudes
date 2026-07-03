"use client";

import { useEffect, useState } from "react";
import type { Fire } from "@photonsurge/shared/fires/types";
import { useSocket } from "./socket-provider";
import { TRACKS_UPDATED } from "@photonsurge/shared/control";

const EMPTY: Fire[] = [];

/**
 * Poll worker-cached NASA FIRMS active fires for the globe overlay. Like quakes,
 * these are point-in-time detections (no dead reckoning). The worker emits
 * TRACKS_UPDATED (kind:"fires") after each snapshot, so we refetch the instant a
 * snapshot lands; the interval is a fallback. Disabling drops the data.
 */
export function useFires(enabled: boolean): Fire[] {
  const [fires, setFires] = useState<Fire[]>(EMPTY);
  const { socket } = useSocket();
  const [liveTick, setLiveTick] = useState(0);

  useEffect(() => {
    if (!socket) return;
    const onUpdated = (p?: { kind?: string }) => {
      if (p?.kind === "fires") setLiveTick((n) => n + 1);
    };
    socket.on(TRACKS_UPDATED, onUpdated);
    return () => {
      socket.off(TRACKS_UPDATED, onUpdated);
    };
  }, [socket]);

  useEffect(() => {
    if (!enabled) {
      setFires(EMPTY);
      return;
    }
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await fetch("/api/fires", { cache: "no-store" });
        const body = await res.json().catch(() => null);
        if (!cancelled && body) setFires(body.fires ?? []);
      } catch {
        /* leave previous data in place on a transient fetch error */
      }
    };
    poll();
    const iv = setInterval(poll, 120000);
    return () => {
      cancelled = true;
      clearInterval(iv);
    };
  }, [enabled, liveTick]);

  return fires;
}
