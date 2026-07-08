"use client";

import { useEffect, useState } from "react";
import { useSocket } from "./socket-provider";
import { TRACKS_UPDATED } from "@photonsurge/shared/control";
import type { iRegionModel } from "@photonsurge/shared/db/region-model";
import type { iAreaWeatherReportModel } from "@photonsurge/shared/db/area-weather-report-model";

export interface RegionWithWeather extends iRegionModel {
  weather: iAreaWeatherReportModel | null;
}

const EMPTY: RegionWithWeather[] = [];

/** Plain fetch of the worker-seeded region catalog, each with its latest area-weather report inlined. */
export async function listRegions(): Promise<RegionWithWeather[]> {
  const res = await fetch("/api/regions", { cache: "no-store" });
  const body = await res.json().catch(() => null);
  return body?.regions ?? [];
}

/** Poll the Region catalog for the admin table. Mirrors `useCountries`. */
export function useRegions(enabled = true): RegionWithWeather[] {
  const [regions, setRegions] = useState<RegionWithWeather[]>(EMPTY);
  const { socket } = useSocket();
  const [liveTick, setLiveTick] = useState(0);

  useEffect(() => {
    if (!socket) return;
    const onUpdated = (p?: { kind?: string }) => {
      if (p?.kind === "regions") setLiveTick((n) => n + 1);
    };
    socket.on(TRACKS_UPDATED, onUpdated);
    return () => {
      socket.off(TRACKS_UPDATED, onUpdated);
    };
  }, [socket]);

  useEffect(() => {
    if (!enabled) {
      setRegions(EMPTY);
      return;
    }
    let cancelled = false;
    const poll = async () => {
      try {
        const rs = await listRegions();
        if (!cancelled) setRegions(rs);
      } catch {
        /* leave previous data in place on a transient fetch error */
      }
    };
    poll();
    const iv = setInterval(poll, 120000);
    return () => {
      cancelled = true;
      clearInterval(iv);
    };
  }, [enabled, liveTick]);

  return regions;
}
