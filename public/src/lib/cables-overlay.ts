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
 * "cables") after a refresh lands. Once fetched the data stays for the page
 * (see `armed` below).
 */
export function useCables(enabled: boolean): CableOverlay {
  const [data, setData] = useState<CableOverlay>(EMPTY);
  const { socket } = useSocket();
  const [liveTick, setLiveTick] = useState(0);
  // `enabled` ARMS the fetch; the data is then kept for the page. A global spin
  // cycles map types, and clearing on every off-step meant a re-fetch, a JSON
  // parse and a rebuilt PathLayer on every on-step (docs/watch-perf-plan.md,
  // round 51). Globe toggles the layers' `visible` instead, so deck keeps their
  // geometry too. Refetches still follow the worker's TRACKS_UPDATED beat.
  const [armed, setArmed] = useState(enabled);
  if (enabled && !armed) setArmed(true);

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
    if (!armed) return;
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
  }, [armed, liveTick]);

  return data;
}
