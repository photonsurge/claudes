"use client";

import { useEffect, useMemo, useState } from "react";
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
 *
 * `hazardsOff` (operator's per-hazard-type toggles) is applied AFTER the fetch,
 * so flipping a hazard chip filters instantly from the warm data — no refetch.
 */
/** Socket-down fallback re-poll cadence — the ALERTS_UPDATED beat is the primary
 *  trigger, so this stays long (alerts ingest minutes apart); NOT the old 60s. */
const ALERT_FALLBACK_MS = 10 * 60 * 1000;

export function useAlertFeatures(
  enabled: boolean,
  severityMin: number,
  hazardsOff: readonly string[] = [],
): AlertFeature[] {
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
      // Drop severityMin from the QUERY so this shares world-watch's canonical
      // `/api/alerts?active=1&limit=5000` Redis entry — one of the two heavy
      // 7s alerts fetches becomes a 6ms hit. The operator's severity floor is
      // applied client-side (like hazardsOff below), so raising it also filters
      // instantly instead of refetching.
      const alerts = await listAlerts({ activeOnly: true, limit: 5000 });
      // A transient empty/failed FETCH must not blank an on-air overlay; keep the
      // last good features. (A legit filter-to-empty below still clears it.)
      if (cancelled || alerts.length === 0) return;
      // One polygon per event: keep only each cluster's representative (id ===
      // groupId; grouping done server-side), at or above the operator's floor.
      const oncePerEvent = alerts.filter(
        (a) => (!a.groupId || a.id === a.groupId) && a.maxSeverityRank >= severityMin,
      );
      setFeatures(alertsToFeatures(oncePerEvent));
    };
    poll();
    // io-driven: ALERTS_UPDATED (above) refetches the instant alerts change, so
    // this is only a socket-down fallback — long, not the old 60s re-poll of the
    // 5000-row feed (which fired even when nothing changed).
    const iv = setInterval(poll, ALERT_FALLBACK_MS);
    return () => {
      cancelled = true;
      clearInterval(iv);
    };
  }, [armed, severityMin, liveTick]);

  // Key on the joined list, not the array identity — socket state updates hand
  // us a fresh array each render even when the selection hasn't changed.
  const offKey = [...hazardsOff].sort().join(",");
  return useMemo(() => {
    if (!offKey) return features;
    const off = new Set(offKey.split(","));
    return features.filter((f) => !off.has(f.properties.hazard));
  }, [features, offKey]);
}
