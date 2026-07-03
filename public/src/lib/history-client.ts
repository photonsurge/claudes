// lib/history-client.ts
// Client-side access to the /api/weather/history endpoints for the broadcast
// point/area-history panel: discover which variables the archive holds, then
// fetch the recent series for each at the on-air focus (a point for targeted
// events, a camera-derived bbox for wide shots). Results stream into state per
// variable as they arrive (the first charts paint while slower variables are
// still sampling server-side). The past-year climate datasets (ERA5 via
// /climate) load as one request.

import { useEffect, useState } from "react";
import type { AreaHistorySeries, HistoryPoint, HistorySeries } from "./weather-history";
import type { ClimateBucket, ClimateDataset } from "@photonsurge/shared/climate/types";

export type { AreaHistorySeries, HistoryPoint, HistorySeries };

/** Hours of history the broadcast panel shows. */
export const HISTORY_WINDOW_HOURS = 72;

/** Static datasets that make a meaningless "history" graph. */
const EXCLUDED_VARIABLES = new Set(["elevation"]);

/** Fixed display order (identity stays put as archives grow); rest alphabetical. */
export const HISTORY_VARIABLE_ORDER = [
  "temp",
  "humidity",
  "wind",
  "gust",
  "rain",
  "storm",
  "pressure",
  "cloud",
  "snow",
  "sst",
  "current",
  "salinity",
  "wave",
  "radar",
];

/** Order archive variables for display: known ones first, leftovers A→Z. */
export function orderHistoryVariables(variables: string[]): string[] {
  const known = HISTORY_VARIABLE_ORDER.filter((v) => variables.includes(v));
  const rest = variables
    .filter((v) => !HISTORY_VARIABLE_ORDER.includes(v) && !EXCLUDED_VARIABLES.has(v))
    .sort();
  return [...known.filter((v) => !EXCLUDED_VARIABLES.has(v)), ...rest];
}

/**
 * The area a camera roughly frames at a zoom, as [west,south,east,north]. A
 * heuristic for stats, not a projection: the visible longitude span halves
 * per zoom level, clamped so a tight shot still covers a sensible region and
 * a whole-globe shot doesn't average both hemispheres into mush.
 */
export function bboxForCamera(center: [number, number], zoom: number): [number, number, number, number] {
  const lngSpan = Math.min(120, Math.max(6, 360 / Math.pow(2, zoom)));
  const latSpan = lngSpan / 2;
  const [lng, lat] = center;
  const wrap = (l: number) => ((l + 540) % 360) - 180;
  return [
    wrap(lng - lngSpan / 2),
    Math.max(-85, lat - latSpan / 2),
    wrap(lng + lngSpan / 2),
    Math.min(85, lat + latSpan / 2),
  ];
}

/**
 * Shared progressive fetcher: list the archive's variables, hit `urlFor` for
 * each, and fold every usable response into state as it lands. `key` names the
 * focus — a key change resets and refetches; empty key disables.
 */
function useArchiveSeries<T extends { series: unknown[] }>(
  key: string,
  urlFor: (variable: string) => string,
): { byVar: Record<string, T>; loading: boolean } {
  const [state, setState] = useState<{ key: string; byVar: Record<string, T>; loading: boolean }>({
    key: "",
    byVar: {},
    loading: false,
  });

  useEffect(() => {
    if (!key) {
      setState({ key: "", byVar: {}, loading: false });
      return;
    }
    let cancelled = false;
    setState({ key, byVar: {}, loading: true });

    (async () => {
      const vres = await fetch("/api/weather/history/variables").then((r) => r.json()).catch(() => null);
      const variables = orderHistoryVariables((vres?.variables as string[]) ?? []);
      if (cancelled || variables.length === 0) {
        if (!cancelled) setState({ key, byVar: {}, loading: false });
        return;
      }

      let pending = variables.length;
      for (const variable of variables) {
        fetch(urlFor(variable))
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null)
          .then((series: T | null) => {
            if (cancelled) return;
            pending -= 1;
            setState((prev) => {
              if (prev.key !== key) return prev;
              const byVar =
                series && series.series.length >= 2 ? { ...prev.byVar, [variable]: series } : prev.byVar;
              return { key, byVar, loading: pending > 0 };
            });
          });
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- urlFor is derived from key
  }, [key]);

  return { byVar: state.byVar, loading: state.loading };
}

const fromParam = (windowHours: number) => String(Date.now() - windowHours * 3600 * 1000);

/**
 * Archived history of every dataset at a point. `center` is [lng, lat] (globe
 * convention); null disables the hook. Rounded to ~1 km so drift doesn't refetch.
 */
export function usePointHistory(
  center: [number, number] | null,
  windowHours: number = HISTORY_WINDOW_HOURS,
): { series: HistorySeries[]; loading: boolean } {
  const lat = center ? center[1].toFixed(2) : null;
  const lng = center ? center[0].toFixed(2) : null;
  const key = lat != null && lng != null ? `pt|${lat}|${lng}|${windowHours}` : "";
  const { byVar, loading } = useArchiveSeries<HistorySeries>(key, (variable) =>
    `/api/weather/history/point?${new URLSearchParams({ lat: lat!, lng: lng!, variable, from: fromParam(windowHours) })}`,
  );
  return { series: orderHistoryVariables(Object.keys(byVar)).map((v) => byVar[v]), loading };
}

/** Archived area statistics for every dataset over a bbox; null disables. */
export function useAreaHistory(
  bbox: [number, number, number, number] | null,
  windowHours: number = HISTORY_WINDOW_HOURS,
): { series: AreaHistorySeries[]; loading: boolean } {
  const rounded = bbox ? bbox.map((v) => v.toFixed(1)) : null;
  const key = rounded ? `area|${rounded.join(",")}|${windowHours}` : "";
  const { byVar, loading } = useArchiveSeries<AreaHistorySeries>(key, (variable) =>
    `/api/weather/history/area?${new URLSearchParams({
      west: rounded![0],
      south: rounded![1],
      east: rounded![2],
      north: rounded![3],
      variable,
      from: fromParam(windowHours),
    })}`,
  );
  return { series: orderHistoryVariables(Object.keys(byVar)).map((v) => byVar[v]), loading };
}

// ── Past-year climate (ERA5 reanalysis via /climate) ───────────────────────

export interface ClimateBucketedDataset {
  variable: ClimateDataset["variable"];
  units: string;
  buckets: Array<ClimateBucket & { value: number }>;
}

/** The past year's weekly/monthly climate datasets at a point; null disables. */
export function useClimateYear(
  center: [number, number] | null,
  granularity: "weekly" | "monthly" = "monthly",
): { datasets: ClimateBucketedDataset[]; loading: boolean } {
  const lat = center ? center[1].toFixed(1) : null;
  const lng = center ? center[0].toFixed(1) : null;
  const key = lat != null && lng != null ? `${lat}|${lng}|${granularity}` : "";
  const [state, setState] = useState<{ key: string; datasets: ClimateBucketedDataset[]; loading: boolean }>({
    key: "",
    datasets: [],
    loading: false,
  });

  useEffect(() => {
    if (!key) {
      setState({ key: "", datasets: [], loading: false });
      return;
    }
    let cancelled = false;
    setState({ key, datasets: [], loading: true });
    const qs = new URLSearchParams({ lat: lat!, lng: lng!, granularity });
    fetch(`/api/weather/history/climate?${qs}`)
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null)
      .then((body) => {
        if (cancelled) return;
        setState({ key, datasets: (body?.datasets as ClimateBucketedDataset[]) ?? [], loading: false });
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- lat/lng folded into key
  }, [key, granularity]);

  return { datasets: state.datasets, loading: state.loading };
}
