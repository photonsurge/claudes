"use client";

import { useEffect, useState } from "react";
import { listAlerts, alertsToFeatures, type AlertFeature } from "./alerts";

/**
 * Poll active alerts and expose them as GeoJSON polygon features for the globe
 * overlay. Refreshes on a slow interval (alerts change on the minute scale).
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
      if (!cancelled) setFeatures(alertsToFeatures(alerts));
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
