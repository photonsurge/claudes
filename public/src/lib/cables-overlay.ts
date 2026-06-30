"use client";

import { useEffect, useState } from "react";
import type { Cable, LandingPoint } from "@photonsurge/shared/cables/types";
import { useSocket } from "./socket-provider";
import { TRACKS_UPDATED } from "@photonsurge/shared/control";

export interface CableOverlay {
  cables: Cable[];
  landings: LandingPoint[];
}

const EMPTY: CableOverlay = { cables: [], landings: [] };

/**
 * Load worker-cached submarine cables for the globe overlay. The dataset is
 * near-static, so there's no polling interval — we fetch once when the overlay
 * is enabled and refetch only when the worker emits TRACKS_UPDATED (kind
 * "cables") after a refresh lands. Disabling drops the data to free GL memory.
 */
export function useCables(enabled: boolean): CableOverlay {
  const [data, setData] = useState<CableOverlay>(EMPTY);
  const { socket } = useSocket();
  const [liveTick, setLiveTick] = useState(0);

  useEffect(() => {
    if (!socket) return;
    const onUpdated = (p?: { kind?: string }) => {
      if (p?.kind === "cables") setLiveTick((n) => n + 1);
    };
    socket.on(TRACKS_UPDATED, onUpdated);
    return () => {
      socket.off(TRACKS_UPDATED, onUpdated);
    };
  }, [socket]);

  useEffect(() => {
    if (!enabled) {
      setData(EMPTY);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/cables", { cache: "no-store" });
        const body = await res.json().catch(() => null);
        if (!cancelled && body) {
          setData({ cables: body.cables ?? [], landings: body.landings ?? [] });
        }
      } catch {
        /* leave previous data in place on a transient fetch error */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled, liveTick]);

  return data;
}
