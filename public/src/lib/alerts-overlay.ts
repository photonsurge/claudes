"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { AlertFeature } from "./alerts";
import { useSocket } from "./socket-provider";
import { ALERTS_UPDATED } from "@photonsurge/shared/control";

/**
 * The globe overlay's warning shapes: the worker's DISSOLVED blobs, where every
 * touching area of the same hazard+severity has already been fused into one.
 *
 * It used to draw `/api/alerts` — one polygon per alert area — and MeteoAlarm
 * issues ONE ALERT PER COUNTY, so the globe showed hundreds of little squares
 * where a viewer should read one weather system. That feed also simplifies each
 * area INDEPENDENTLY (~0.05°, to keep the payload off public's heap), which walks
 * two neighbours' shared border apart and leaves a white seam between provinces
 * that genuinely touch. Dissolving first removes the internal borders, so there
 * is nothing left to mismatch.
 *
 * Cheaper too: this reads ~550 finished shapes instead of parsing a 5,000-row
 * alert feed (~3s of JSON even on a cache hit) and throwing most of it away.
 * World Watch still reads `/api/alerts` — it counts WARNINGS, which is a
 * different question from what to draw.
 *
 * The worker emits ALERTS_UPDATED after each ingest, so we refetch the instant
 * things change (the interval is a socket-down fallback).
 *
 * `enabled` only *arms* the fetch — once shapes have been wanted, polling stays
 * on and the last features are kept, even when `enabled` flips back to false.
 * The auto-director toggles showAlerts on every cut; if we cleared + refetched
 * each time, the overlay would blank out and re-tessellate on every shot.
 * Instead the data stays warm and the globe toggles layer *visibility* (see
 * alertsLayer's `visible`).
 *
 * `severityMin` / `hazardsOff` (operator's toggles) are applied AFTER the fetch,
 * so a chip filters instantly from warm data — and, just as importantly, every
 * caller shares ONE canonical Redis entry instead of fragmenting the cache per
 * filter combination.
 */

/** Socket-down fallback re-poll cadence — the ALERTS_UPDATED beat is the primary
 *  trigger, so this stays long (alerts ingest minutes apart); NOT the old 60s. */
const ALERT_FALLBACK_MS = 10 * 60 * 1000;

async function fetchBlobFeatures(): Promise<AlertFeature[]> {
  const res = await fetch("/api/alerts/blobs", { cache: "no-store" });
  const body = (await res.json().catch(() => null)) as { features?: AlertFeature[] } | null;
  return Array.isArray(body?.features) ? body.features : [];
}

/** Coordinate count of any GeoJSON geometry — a cheap shape fingerprint. */
function coordCount(c: unknown): number {
  if (!Array.isArray(c)) return 0;
  if (typeof c[0] === "number") return 1;
  let n = 0;
  for (const x of c) n += coordCount(x);
  return n;
}

/**
 * A cheap identity for a fetched feature set: every shape's representative id
 * + issue time + member count + vertex count. Two polls that fingerprint the
 * same are the same picture, so the hook keeps the PREVIOUS array — handing
 * deck a fresh array makes all four alert passes re-tessellate every dissolved
 * polygon on the main thread (a ~1–2 s freeze on air), even when nothing moved.
 * Exported for tests.
 */
export function featureSetFingerprint(features: AlertFeature[]): string {
  const parts: string[] = [String(features.length)];
  for (const f of features) {
    const p = f.properties as unknown as Record<string, unknown>;
    parts.push(
      `${p.id ?? ""}@${p.sent ?? ""}@${p.memberCount ?? ""}@${p.severityRank ?? ""}@${coordCount(
        (f.geometry as { coordinates?: unknown } | null)?.coordinates,
      )}`,
    );
  }
  return parts.join("|");
}

export function useAlertFeatures(
  enabled: boolean,
  severityMin: number,
  hazardsOff: readonly string[] = [],
): AlertFeature[] {
  const [features, setFeatures] = useState<AlertFeature[]>([]);
  const fingerprintRef = useRef<string>("");
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
      const next = await fetchBlobFeatures().catch(() => [] as AlertFeature[]);
      // A transient empty/failed FETCH must not blank an on-air overlay; keep the
      // last good features. (A legit filter-to-empty below still clears it.)
      if (cancelled || next.length === 0) return;
      // Same picture as last time → keep the array identity (no re-tessellation).
      const fp = featureSetFingerprint(next);
      if (fp === fingerprintRef.current) return;
      fingerprintRef.current = fp;
      setFeatures(next);
    };
    poll();
    // io-driven: ALERTS_UPDATED (above) refetches the instant alerts change, so
    // this is only a socket-down fallback.
    const iv = setInterval(poll, ALERT_FALLBACK_MS);
    return () => {
      cancelled = true;
      clearInterval(iv);
    };
  }, [armed, liveTick]);

  // Key on the joined list, not the array identity — socket state updates hand
  // us a fresh array each render even when the selection hasn't changed.
  const offKey = [...hazardsOff].sort().join(",");
  return useMemo(() => {
    const off = offKey ? new Set(offKey.split(",")) : null;
    if (!off && !severityMin) return features;
    return features.filter(
      (f) =>
        f.properties.severityRank >= severityMin && !(off && off.has(f.properties.hazard)),
    );
  }, [features, offKey, severityMin]);
}
