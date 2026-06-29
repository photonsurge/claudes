"use client";

import { useEffect, useState } from "react";
import { listQuakes } from "./tracks/client";
import type { Quake } from "./tracks/types";

/**
 * Poll worker-cached USGS earthquakes for the globe overlay. Quakes are
 * point-in-time events (no dead reckoning), so a slow refresh is enough — the
 * worker re-polls USGS every few minutes anyway.
 */
export function useQuakes(enabled: boolean, minMag: number): Quake[] {
  const [quakes, setQuakes] = useState<Quake[]>([]);

  useEffect(() => {
    if (!enabled) {
      setQuakes([]);
      return;
    }
    let cancelled = false;
    const poll = async () => {
      const r = await listQuakes(undefined, minMag);
      if (!cancelled) setQuakes(r.quakes);
    };
    poll();
    const iv = setInterval(poll, 120000);
    return () => {
      cancelled = true;
      clearInterval(iv);
    };
  }, [enabled, minMag]);

  return quakes;
}
