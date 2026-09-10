"use client";

import { useEffect, useRef, useState } from "react";
import type { Cam } from "./types";
import { useSocket } from "../socket-provider";
import { TRACKS_UPDATED } from "@photonsurge/shared/control";

/** Search radius, km — EventNearbyPanel's CAM_RADIUS_KM, which filters again client-side. */
export const CAMS_NEAR_KM = 400;

/**
 * The fetch key for a centre, to ~100 m. Keyed on this primitive rather than
 * the tuple so camera-object identity churn (a fresh tuple per socket beat)
 * never refetches — only a real move does. "" = no centre.
 */
export const camsFocusKey = (center: [number, number] | null | undefined): string =>
  center && Number.isFinite(center[0]) && Number.isFinite(center[1])
    ? `${center[0].toFixed(3)},${center[1].toFixed(3)}`
    : "";

/**
 * The active webcams near a point — the on-air segment's centre — for the
 * "near this event" broadcast panel. ONE small `/api/cams?lng&lat` read per
 * cut (a server-side $geoNear, a few dozen cams), re-read when the worker
 * announces a catalog refresh (TRACKS_UPDATED kind "cams"). Disabled, or no
 * centre ⇒ []. The public app never calls the upstream webcam providers.
 *
 * It used to load the WHOLE catalog once ("near-static, like cables") and let
 * the panel pick the nearby ones. With the Windy catalog that was a 68 MB
 * JSON download and a ~450 ms main-thread freeze on every /watch page load,
 * then a 70 000-item distance scan on every render (docs/watch-perf-plan.md,
 * round 46).
 */
export function useCams(enabled: boolean, center: [number, number] | null | undefined): Cam[] {
  const [cams, setCams] = useState<Cam[]>([]);
  const { socket } = useSocket();
  const [liveTick, setLiveTick] = useState(0);
  const focusKey = enabled ? camsFocusKey(center) : "";
  const lastKey = useRef("");

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
    // A new place drops the old place's cams at once (a catalog refresh for the
    // SAME place keeps them on screen until the new read lands).
    if (lastKey.current !== focusKey) {
      lastKey.current = focusKey;
      setCams([]);
    }
    if (!focusKey) return;
    const [lng, lat] = focusKey.split(",");
    const ctrl = new AbortController();
    (async () => {
      try {
        const q = new URLSearchParams({ lng, lat, maxKm: String(CAMS_NEAR_KM) });
        const res = await fetch(`/api/cams?${q.toString()}`, { cache: "no-store", signal: ctrl.signal });
        const body = await res.json().catch(() => null);
        if (!ctrl.signal.aborted && res.ok && Array.isArray(body?.cams)) setCams(body.cams as Cam[]);
      } catch {
        /* aborted by a newer centre, or a transient failure: keep what we have */
      }
    })();
    return () => ctrl.abort();
  }, [focusKey, liveTick]);

  return cams;
}
