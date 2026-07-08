// lib/forecast-client.ts
// Client-side access to the /api/weather/forecast endpoints for the broadcast
// forecast-strip panel: one fetch (not history-client's per-variable fan-out —
// the forecast API already assembles the day cards server-side from a small
// fixed variable list, so there's nothing to stream progressively).

import { useEffect, useState } from "react";
import type { ForecastDay, AreaForecastDay } from "./weather-forecast";

export type { ForecastDay, AreaForecastDay };

function useForecastFetch<T>(key: string, urlFor: () => string): { data: T | null; loading: boolean } {
  const [state, setState] = useState<{ key: string; data: T | null; loading: boolean }>({
    key: "",
    data: null,
    loading: false,
  });

  useEffect(() => {
    if (!key) {
      setState({ key: "", data: null, loading: false });
      return;
    }
    let cancelled = false;
    setState({ key, data: null, loading: true });
    if (typeof globalThis.fetch !== "function") {
      setState({ key, data: null, loading: false });
      return;
    }
    globalThis.fetch(urlFor())
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null)
      .then((data: T | null) => {
        if (cancelled) return;
        setState({ key, data, loading: false });
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- url is derived from key
  }, [key]);

  return { data: state.data, loading: state.loading };
}

/** 3-day-ahead forecast at a point; null center disables. Rounded to ~1km. */
export function usePointForecast(center: [number, number] | null): {
  days: ForecastDay[];
  loading: boolean;
} {
  const lat = center ? center[1].toFixed(2) : null;
  const lng = center ? center[0].toFixed(2) : null;
  const key = lat != null && lng != null ? `pt|${lat}|${lng}` : "";
  const { data, loading } = useForecastFetch<{ days: ForecastDay[] }>(key, () =>
    `/api/weather/forecast/point?${new URLSearchParams({ lat: lat!, lng: lng! })}`,
  );
  return { days: data?.days ?? [], loading };
}

/** 3-day-ahead forecast over a bbox (area mode); null disables. */
export function useAreaForecast(bbox: [number, number, number, number] | null): {
  days: AreaForecastDay[];
  loading: boolean;
} {
  const rounded = bbox ? bbox.map((v) => v.toFixed(1)) : null;
  const key = rounded ? `area|${rounded.join(",")}` : "";
  const { data, loading } = useForecastFetch<{ days: AreaForecastDay[] }>(key, () =>
    `/api/weather/forecast/area?${new URLSearchParams({
      west: rounded![0],
      south: rounded![1],
      east: rounded![2],
      north: rounded![3],
    })}`,
  );
  return { days: data?.days ?? [], loading };
}
