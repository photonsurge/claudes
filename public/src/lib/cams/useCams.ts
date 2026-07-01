"use client";

import { useEffect, useState } from "react";
import type { Cam } from "./types";
import { useSocket } from "../socket-provider";
import { TRACKS_UPDATED } from "@photonsurge/shared/control";

/**
 * Load the worker-cached webcam catalog (active cams) for the broadcast overlay.
 * The catalog is near-static, so — like cables — we fetch once when enabled and
 * refetch only when the worker emits TRACKS_UPDATED (kind "cams") after a
 * refresh. Disabling drops the data. The public app never calls the upstream
 * webcam provider; it only reads Mongo via /api/cams.
 */
export function useCams(enabled: boolean): Cam[] {
  const [cams, setCams] = useState<Cam[]>([]);
  const { socket } = useSocket();
  const [liveTick, setLiveTick] = useState(0);

  useEffect(() => {
    if (!socket) return;
    const onUpdated = (p?: { kind?: string }) => {
      if (p?.kind === "cams") setLiveTick((n) => n + 1);
    };
    socket.on(TRACKS_UPDATED, onUpdated);
    return () => {
      socket.off(TRACKS_UPDATED, onUpdated);
    };
  }, [socket]);

  useEffect(() => {
    if (!enabled) {
      setCams([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/cams", { cache: "no-store" });
        const body = await res.json().catch(() => null);
        if (!cancelled && res.ok && body?.cams) setCams(body.cams as Cam[]);
      } catch {
        /* leave whatever we had */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled, liveTick]);

  return cams;
}
