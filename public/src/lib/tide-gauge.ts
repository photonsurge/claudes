"use client";

import { useEffect, useState } from "react";
import { getTideGauge } from "./tracks/client";
import type { TideGaugeResponse } from "./tides/types";
import { useSocket } from "./socket-provider";
import { TRACKS_UPDATED } from "@photonsurge/shared/control";

/**
 * Fetch the worker-cached sea-level series for the tide gauge nearest an on-air
 * point ([lng,lat]). Returns null when disabled, no point, or no gauge in range
 * — the broadcast gauge then hides ("not relevant"). The worker emits
 * TRACKS_UPDATED (kind:"tides") after each snapshot, so we refetch the instant a
 * fresh series lands; the interval is a fallback if the socket is down.
 */
export function useTideGauge(center: [number, number] | null, enabled = true): TideGaugeResponse | null {
  const [gauge, setGauge] = useState<TideGaugeResponse | null>(null);
  const { socket } = useSocket();
  const [liveTick, setLiveTick] = useState(0);

  const lng = center?.[0];
  const lat = center?.[1];

  useEffect(() => {
    if (!socket) return;
    const onUpdated = (p?: { kind?: string }) => {
      if (!p || p.kind === "tides") setLiveTick((n) => n + 1);
    };
    socket.on(TRACKS_UPDATED, onUpdated);
    return () => {
      socket.off(TRACKS_UPDATED, onUpdated);
    };
  }, [socket]);

  useEffect(() => {
    if (!enabled || lat == null || lng == null) {
      setGauge(null);
      return;
    }
    let cancelled = false;
    const poll = async () => {
      const r = await getTideGauge(lat, lng);
      if (!cancelled) setGauge(r);
    };
    poll();
    const iv = setInterval(poll, 120000);
    return () => {
      cancelled = true;
      clearInterval(iv);
    };
  }, [enabled, lat, lng, liveTick]);

  return gauge;
}
