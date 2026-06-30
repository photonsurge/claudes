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
 */
export function useAlertFeatures(enabled: boolean, severityMin: number): AlertFeature[] {
  const [features, setFeatures] = useState<AlertFeature[]>([]);
  const { socket } = useSocket();
  const [liveTick, setLiveTick] = useState(0);

  useEffect(() => {
    if (!socket) return;
    const onUpdated = () => setLiveTick((n) => n + 1);
    socket.on(ALERTS_UPDATED, onUpdated);
    return () => {
      socket.off(ALERTS_UPDATED, onUpdated);
    };
  }, [socket]);

  useEffect(() => {
    if (!enabled) {
      setFeatures([]);
      return;
    }
    let cancelled = false;
    const poll = async () => {
      const alerts = await listAlerts({ activeOnly: true, severityMin, limit: 5000 });
      // One polygon per event: keep only each cluster's representative (id ===
      // groupId). Grouping itself was done server-side (see /api/alerts).
      const oncePerEvent = alerts.filter((a) => !a.groupId || a.id === a.groupId);
      if (!cancelled) setFeatures(alertsToFeatures(oncePerEvent));
    };
    poll();
    const iv = setInterval(poll, 60000);
    return () => {
      cancelled = true;
      clearInterval(iv);
    };
  }, [enabled, severityMin, liveTick]);

  return features;
}
