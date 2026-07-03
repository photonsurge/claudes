"use client";

import { useEffect, useState } from "react";
import type { AuroraMeta } from "@photonsurge/shared/aurora/types";
import { useSocket } from "./socket-provider";
import { TRACKS_UPDATED } from "@photonsurge/shared/control";

/** Poll fallback in case a socket beat is missed; the worker re-bakes ~5 min. */
const POLL_MS = 5 * 60 * 1000;

/**
 * Load the worker-cached aurora frame metadata for the globe overlay. Refetches
 * when the worker emits TRACKS_UPDATED (kind "aurora") after a fresh bake lands,
 * with a slow interval as a fallback. Returns null until a frame exists or when
 * disabled (which drops the GL texture). The pixel bytes are served separately at
 * /api/aurora/image — the layer builds that URL from `updatedAt`.
 */
export function useAurora(enabled: boolean): AuroraMeta | null {
  const [data, setData] = useState<AuroraMeta | null>(null);
  const { socket } = useSocket();
  const [liveTick, setLiveTick] = useState(0);

  useEffect(() => {
    if (!socket) return;
    const onUpdated = (p?: { kind?: string }) => {
      if (p?.kind === "aurora") setLiveTick((n) => n + 1);
    };
    socket.on(TRACKS_UPDATED, onUpdated);
    return () => {
      socket.off(TRACKS_UPDATED, onUpdated);
    };
  }, [socket]);

  useEffect(() => {
    if (!enabled) {
      setData(null);
      return;
    }
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch("/api/aurora", { cache: "no-store" });
        const body = await res.json().catch(() => null);
        if (!cancelled && body) setData(body.aurora ?? null);
      } catch {
        /* leave previous frame in place on a transient fetch error */
      }
    };
    load();
    const t = setInterval(load, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [enabled, liveTick]);

  return data;
}
