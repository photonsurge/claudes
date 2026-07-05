"use client";

/**
 * Layers extra, zoom-appropriate cities on top of a fixed base set (the
 * always-on "biggest + capital cities" list from a plain `listCities()` call)
 * once the camera has pushed in on a specific region — so a country/city
 * spotlight reveals real local detail without the globe ever holding every
 * city in the DB at once (thousands of always-on dots + DOM name labels tanks
 * frame rate — see GlobeLabels).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { listCities, regionHalfExtentDeg, regionMinPop, type City } from "./cities";

/** Below this zoom the base set already covers the view; no region fetch. */
const REGION_MIN_ZOOM = 3.2;
const REGION_DEBOUNCE_MS = 500;
/** Skip refetching for camera jitter smaller than this (spin/inertia frames). */
const MOVE_THRESHOLD_DEG = 1.5;
const ZOOM_THRESHOLD = 0.3;

export function useRegionCities(
  base: City[],
  center: [number, number],
  zoom: number,
): City[] {
  const [region, setRegion] = useState<City[]>([]);
  const lastRef = useRef<{ lng: number; lat: number; zoom: number } | null>(null);
  const [lng, lat] = center;

  useEffect(() => {
    if (zoom < REGION_MIN_ZOOM) {
      lastRef.current = null;
      setRegion((prev) => (prev.length ? [] : prev));
      return;
    }
    const last = lastRef.current;
    if (
      last &&
      Math.abs(last.lng - lng) < MOVE_THRESHOLD_DEG &&
      Math.abs(last.lat - lat) < MOVE_THRESHOLD_DEG &&
      Math.abs(last.zoom - zoom) < ZOOM_THRESHOLD
    ) {
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      lastRef.current = { lng, lat, zoom };
      const r = regionHalfExtentDeg(zoom);
      let w = lng - r;
      let e = lng + r;
      if (w < -180) w += 360;
      if (e > 180) e -= 360;
      const bbox: [number, number, number, number] = [w, Math.max(lat - r, -90), e, Math.min(lat + r, 90)];
      listCities({ bbox, minPop: regionMinPop(zoom) }).then((c) => {
        if (!cancelled) setRegion(c);
      });
    }, REGION_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [lng, lat, zoom]);

  return useMemo(() => {
    if (!region.length) return base;
    const seen = new Set(base.map((c) => c.id));
    const merged = base.slice();
    for (const c of region) if (!seen.has(c.id)) merged.push(c);
    return merged;
  }, [base, region]);
}
