"use client";

import { useEffect, useState } from "react";
import { listAlerts, alertsToFeatures, type AlertFeature } from "./alerts";
import { useSocket } from "./socket-provider";
import { ALERTS_UPDATED } from "@photonsurge/shared/control";

/**
 * Poll active alerts and expose them as GeoJSON polygon features for the globe
 * overlay. The worker emits ALERTS_UPDATED after each ingest, so we refetch the
 * instant new/expired alerts land (the interval is a fallback). Same-event-
 * across-sources are clustered server-side (the API tags each alert with a
 * groupId; the representative has id === groupId), so we draw each event ONCE —
 * a warning carried by both WMO and MeteoAlarm doesn't double-draw.
 *
 * `enabled` only *arms* the fetch — once alerts have been wanted, polling stays
 * on and the last features are kept, even when `enabled` flips back to false.
 * The auto-director toggles showAlerts on every cut; if we cleared + refetched
 * each time, the overlay would blank out and reload (5000-row fetch + full
 * re-tessellation) on every shot. Instead the data stays warm and the globe
 * just toggles layer *visibility* (see alertsLayer's `visible`).
 */
export function useAlertFeatures(enabled: boolean, severityMin: number): AlertFeature[] {
  const [features, setFeatures] = useState<AlertFeature[]>([]);
  const { socket } = useSocket();
  const [liveTick, setLiveTick] = useState(0);

  // Latch on first enable; never disarm. Keeps the poll independent of the
  // per-cut showAlerts flicker so it doesn't tear down + refetch every shot.
  const [armed, setArmed] = useState(enabled);
  if (enabled && !armed) setArmed(true);

  useEffect(() => {
    if (!socket) return;
    const onUpdated = () => setLiveTick((n) => n + 1);
    socket.on(ALERTS_UPDATED, onUpdated);
    return () => {
      socket.off(ALERTS_UPDATED, onUpdated);
    };
  }, [socket]);

  useEffect(() => {
    if (!armed) return;
    let cancelled = false;
    const poll = async () => {
      const alerts = await listAlerts({ activeOnly: true, severityMin, limit: 5000 });
      // One polygon per event: keep only each cluster's representative (id ===
      // groupId). Grouping itself was done server-side (see /api/alerts).
      const oncePerEvent = alerts.filter((a) => !a.groupId || a.id === a.groupId);
      const next = alertsToFeatures(oncePerEvent);
      // A transient empty/failed fetch must not blank an on-air overlay; keep
      // the last good features until a real non-empty result arrives.
      if (cancelled || next.length === 0) return;
      setFeatures(next);
    };
    poll();
    const iv = setInterval(poll, 60000);
    return () => {
      cancelled = true;
      clearInterval(iv);
    };
  }, [armed, severityMin, liveTick]);

  return features;
}
