"use client";

import { useEffect, useState } from "react";
import { listAlerts, alertsToFeatures, type AlertFeature } from "./alerts";

/**
 * Poll active alerts and expose them as GeoJSON polygon features for the globe
 * overlay. Refreshes on a slow interval (alerts change on the minute scale).
 * Same-event-across-sources are clustered server-side (the API tags each alert
 * with a groupId; the representative has id === groupId), so we draw each event
 * ONCE — a warning carried by both WMO and MeteoAlarm doesn't double-draw.
 */
export function useAlertFeatures(enabled: boolean, severityMin: number): AlertFeature[] {
  const [features, setFeatures] = useState<AlertFeature[]>([]);

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
  }, [enabled, severityMin]);

  return features;
}
