"use client";

import { useEffect, useState } from "react";
import type { Volcano } from "@photonsurge/shared/volcanoes/types";
import { useSocket } from "./socket-provider";
import { TRACKS_UPDATED } from "@photonsurge/shared/control";

const EMPTY: Volcano[] = [];

/** Plain fetch of the worker-cached volcano feed — every status, no cap.
 *  Shared by the overlay hook below and by anything else that needs a
 *  one-shot read (e.g. the World Watch tally) without the polling machinery. */
export async function listVolcanoes(): Promise<Volcano[]> {
  const res = await fetch("/api/volcanoes", { cache: "no-store" });
  const body = await res.json().catch(() => null);
  return body?.volcanoes ?? [];
}

/**
 * Poll worker-cached NASA EONET active volcanoes for the globe overlay. Like
 * fires, this is a slow-moving cached feed (no dead reckoning). The worker
 * emits TRACKS_UPDATED (kind:"volcanoes") after each snapshot, so we refetch
 * the instant a snapshot lands; the interval is a fallback. Disabling drops
 * the data.
 */
export function useVolcanoes(enabled: boolean): Volcano[] {
  const [volcanoes, setVolcanoes] = useState<Volcano[]>(EMPTY);
  const { socket } = useSocket();
  const [liveTick, setLiveTick] = useState(0);

  useEffect(() => {
    if (!socket) return;
    const onUpdated = (p?: { kind?: string }) => {
      if (p?.kind === "volcanoes") setLiveTick((n) => n + 1);
    };
    socket.on(TRACKS_UPDATED, onUpdated);
    return () => {
      socket.off(TRACKS_UPDATED, onUpdated);
    };
  }, [socket]);

  useEffect(() => {
    if (!enabled) {
      setVolcanoes(EMPTY);
      return;
    }
    let cancelled = false;
    const poll = async () => {
      try {
        const vs = await listVolcanoes();
        if (!cancelled) setVolcanoes(vs);
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

  return volcanoes;
}
