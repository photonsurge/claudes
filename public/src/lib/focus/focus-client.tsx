"use client";

/**
 * FocusProvider + selector hooks — the client half of the consolidated-focus
 * feature. ONE /api/focus fetch per on-air "thing" (keyed by the canonical
 * focusKey), fed to every broadcast panel through context. Each selector wraps
 * the panel's original standalone hook: when the loaded bundle *covers* the
 * requested focus (`bundle.key === focusKey` and the point/bbox matches) it
 * returns the baked payload with zero fetch; otherwise it transparently falls
 * back to the live hook — so panels used OUTSIDE a provider (sandbox, admin)
 * keep working unchanged (default context ⇒ covers()===false ⇒ always fallback).
 *
 * Memory discipline (runs 24/7): the provider fetches on a primitive
 * [focusKey, enabled] dep, aborts the in-flight request on every key change /
 * unmount, keeps the last bundle across cuts (no empty-flash), and fails open.
 */
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Segment, SegmentKind } from "@photonsurge/shared/director";
import type { iRegionModel } from "@photonsurge/shared/db/region-model";

import { hasRealLocation } from "../../components/broadcast/kinds";
import { buildFocusKey } from "./focusKey";
import type { FocusBundle, FocusDetail, FocusNearbyCity, FocusRequest, FocusTarget } from "./types";

import { usePointHistory, useAreaHistory, useClimateYear } from "../history-client";
import { usePointForecast, useAreaForecast } from "../forecast-client";
import { useSeismoGauge, type SeismoGauge } from "../seismo-gauge";
import { useTideGauge, type TideGauge } from "../tide-gauge";
import { useCountryAt, type CountryAt } from "../countries";
import { useRegion } from "../regions";
import { useLatestPlaceRoundup, type PlaceRoundup } from "../placeRoundups";
import { listCities, type City } from "../cities";
import type { HistorySeries, AreaHistorySeries } from "../weather-history";
import type { ForecastDay, AreaForecastDay } from "../weather-forecast";
import type { ClimateBucketedDataset } from "../history-client";
import type { SeismoStationReading } from "../seismo/types";
import type { TideStationReading } from "../tides/types";

type Center = [number, number];
type Bbox = [number, number, number, number];

interface FocusContextValue {
  bundle: FocusBundle | null;
  focusKey: string;
  enabled: boolean;
  loading: boolean;
  // provider-derived, for the arg-less selectors
  regionId: string | null;
  ledeCenter: Center | null;
  country: CountryAt | null;
  countryId: string | null;
  focusCenter: Center | null;
  // coverage helpers
  covers: () => boolean;
  atFocus: (c: Center | null, dp?: number) => boolean;
  framesFocus: (b: Bbox | null) => boolean;
}

/**
 * Default context = "no provider": nothing is ever covered, and `enabled` is
 * true so the fallback hooks fetch exactly as they did standalone. This is what
 * lets the rewired panels run unchanged outside /watch.
 */
const NO_PROVIDER: FocusContextValue = {
  bundle: null,
  focusKey: "",
  enabled: true,
  loading: false,
  regionId: null,
  ledeCenter: null,
  country: null,
  countryId: null,
  focusCenter: null,
  covers: () => false,
  atFocus: () => false,
  framesFocus: () => false,
};

const FocusContext = createContext<FocusContextValue>(NO_PROVIDER);
export const useFocusContext = (): FocusContextValue => useContext(FocusContext);

// ── active-station cycling (the bundle carries only the station list) ─────────
const EMPTY_SEISMO: SeismoStationReading[] = [];
const EMPTY_TIDE: TideStationReading[] = [];
const CYCLE_MS = 8000;

function useCycledActive<T>(stations: T[]): T | null {
  const [idx, setIdx] = useState(0);
  useEffect(() => {
    setIdx(0);
    if (stations.length < 2) return;
    const iv = setInterval(() => setIdx((i) => (i + 1) % stations.length), CYCLE_MS);
    return () => clearInterval(iv);
  }, [stations.length]);
  return stations[idx] ?? null;
}

// ── Provider ──────────────────────────────────────────────────────────────────

interface FocusProviderProps {
  onAirSegment: Segment | null;
  /** live operator camera — fallback centre/zoom + the moving round-up stop */
  camera: { center: Center; zoom: number };
  /** false until globe textures decode; no fetch / no fallback fires while false */
  enabled: boolean;
  detail?: FocusDetail;
  children: ReactNode;
}

export function FocusProvider({ onAirSegment, camera, enabled, detail = "broadcast", children }: FocusProviderProps) {
  const kind: SegmentKind = onAirSegment?.kind ?? "global";
  const subject = onAirSegment?.id.split(":")[1] ?? null; // BARE subject id
  const focusCenter: Center = onAirSegment?.camera.center ?? camera.center;
  const focusZoom = onAirSegment?.camera.zoom ?? camera.zoom;
  const segmentHasLocation = onAirSegment ? hasRealLocation(onAirSegment.kind) : true;

  const request: FocusRequest = { kind, center: focusCenter, zoom: focusZoom, detail, subject };
  const focusKey = buildFocusKey(request);

  const regionId = onAirSegment?.kind === "region" ? subject : null;

  // ledeCenter — exact BroadcastFrame ternary (round-up spins track the live stop)
  const ledeCenter: Center | null = !onAirSegment
    ? null
    : onAirSegment.summary
      ? camera.center
      : segmentHasLocation
        ? (onAirSegment.camera.center ?? camera.center ?? null)
        : null;

  const [bundle, setBundle] = useState<FocusBundle | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    const ctrl = new AbortController();
    let alive = true;
    setLoading(true);
    const qs = new URLSearchParams({
      kind,
      lng: String(focusCenter[0]),
      lat: String(focusCenter[1]),
      zoom: String(focusZoom),
      detail,
    });
    if (subject) qs.set("subject", subject);
    fetch(`/api/focus?${qs.toString()}`, { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((b: FocusBundle | null) => {
        if (alive) {
          if (b) setBundle(b); // keep last bundle on a null/failed response
          setLoading(false);
        }
      })
      .catch((e) => {
        if (alive && e?.name !== "AbortError") setLoading(false);
      });
    return () => {
      alive = false;
      ctrl.abort();
    };
    // primitive deps only — sub-grid drift that rounds to the same key never refetches
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusKey, enabled]);

  const covers = () => bundle != null && bundle.key === focusKey;
  const atFocus = (c: Center | null, dp = 2) =>
    covers() &&
    c != null &&
    c[0].toFixed(dp) === focusCenter[0].toFixed(dp) &&
    c[1].toFixed(dp) === focusCenter[1].toFixed(dp);
  const framesFocus = (b: Bbox | null) =>
    covers() &&
    b != null &&
    bundle != null &&
    b.map((v) => v.toFixed(1)).join(",") === bundle.bbox.map((v) => v.toFixed(1)).join(",");

  // Country resolution owned by the provider so the arg-less roundups have an id
  // and useCountryAt runs at most once (here).
  const bundleCountry = covers() ? bundle!.country : null;
  const liveCountry = useCountryAt(!bundleCountry && enabled ? ledeCenter : null);
  const country = bundleCountry ?? liveCountry;
  const countryId = country?.countryId ?? null;

  const value: FocusContextValue = {
    bundle,
    focusKey,
    enabled,
    loading,
    regionId,
    ledeCenter,
    country,
    countryId,
    focusCenter,
    covers,
    atFocus,
    framesFocus,
  };

  return <FocusContext.Provider value={value}>{children}</FocusContext.Provider>;
}

// ── Selectors ─────────────────────────────────────────────────────────────────
// Each ALWAYS calls its underlying hook (same order every render), passing the
// hook's null skip sentinel when the bundle covers the request or !enabled.

export function usePointHistorySeries(
  center: Center | null,
  bbox?: Bbox | null,
): { series: HistorySeries[]; loading: boolean } {
  const { bundle, enabled, atFocus } = useFocusContext();
  const wantPoint = !bbox; // point history is suppressed when a bbox is framed
  const cover = wantPoint && atFocus(center);
  const skip = cover || !enabled || bbox ? null : center;
  const fb = usePointHistory(skip);
  return cover ? { series: bundle!.pointHistory, loading: false } : fb;
}

export function useAreaHistorySeries(bbox: Bbox | null): { series: AreaHistorySeries[]; loading: boolean } {
  const { bundle, enabled, framesFocus } = useFocusContext();
  const cover = framesFocus(bbox);
  const fb = useAreaHistory(cover || !enabled ? null : bbox);
  return cover ? { series: bundle!.areaHistory, loading: false } : fb;
}

export function usePointForecastDays(center: Center | null): { days: ForecastDay[]; loading: boolean } {
  const { bundle, enabled, atFocus } = useFocusContext();
  const cover = atFocus(center);
  const fb = usePointForecast(cover || !enabled ? null : center);
  return cover ? { days: bundle!.pointForecast, loading: false } : fb;
}

export function useAreaForecastDays(bbox: Bbox | null): { days: AreaForecastDay[]; loading: boolean } {
  const { bundle, enabled, framesFocus } = useFocusContext();
  const cover = framesFocus(bbox);
  const fb = useAreaForecast(cover || !enabled ? null : bbox);
  return cover ? { days: bundle!.areaForecast, loading: false } : fb;
}

export function useClimateFor(
  center: Center | null,
  granularity: "weekly" | "monthly" = "monthly",
): { datasets: ClimateBucketedDataset[]; loading: boolean } {
  const { bundle, enabled, atFocus, covers } = useFocusContext();
  // bundle climate (focus point + baked cities) is MONTHLY only
  const focusHit = granularity === "monthly" && atFocus(center, 1);
  // baked city climate only from the CURRENT bundle (covers()) — a city sits off
  // the focus centre, so atFocus doesn't apply; match by its own 1dp coord.
  const cityHit =
    granularity === "monthly" && !focusHit && covers() && bundle && center
      ? findCityClimate(bundle, center)
      : null;
  const cover = focusHit || cityHit != null;
  const fb = useClimateYear(cover || !enabled ? null : center, granularity);
  if (focusHit) return { datasets: bundle!.climate, loading: false };
  if (cityHit) return { datasets: cityHit, loading: false };
  return fb;
}

function findCityClimate(bundle: FocusBundle, c: Center): ClimateBucketedDataset[] | null {
  const lat = c[1].toFixed(1);
  const lng = c[0].toFixed(1);
  const inTop = bundle.topCities.find((t) => t.city.lat.toFixed(1) === lat && t.city.lng.toFixed(1) === lng);
  if (inTop) return inTop.climate;
  const inNear = bundle.nearbyCities.find((t) => t.city.lat.toFixed(1) === lat && t.city.lng.toFixed(1) === lng);
  return inNear ? inNear.climate : null;
}

export function useSeismoStations(center: Center | null): SeismoGauge {
  const { bundle, enabled, atFocus } = useFocusContext();
  const cover = atFocus(center);
  const fb = useSeismoGauge(cover || !enabled ? null : center, enabled && !cover);
  const bundleActive = useCycledActive(cover ? bundle!.seismoStations : EMPTY_SEISMO);
  return cover ? { stations: bundle!.seismoStations, active: bundleActive } : fb;
}

export function useTideStations(center: Center | null): TideGauge {
  const { bundle, enabled, atFocus } = useFocusContext();
  const cover = atFocus(center);
  const fb = useTideGauge(cover || !enabled ? null : center, enabled && !cover);
  const bundleActive = useCycledActive(cover ? bundle!.tideStations : EMPTY_TIDE);
  return cover ? { stations: bundle!.tideStations, active: bundleActive } : fb;
}

export function useFocusCountry(center: Center | null): CountryAt | null {
  const { country, ledeCenter, enabled } = useFocusContext();
  // areaInfo passes exactly ledeCenter → reuse the provider-resolved country.
  const sameAsLede =
    center != null &&
    ledeCenter != null &&
    center[0].toFixed(0) === ledeCenter[0].toFixed(0) &&
    center[1].toFixed(0) === ledeCenter[1].toFixed(0);
  const fb = useCountryAt(sameAsLede || !enabled ? null : center);
  return sameAsLede ? country : fb;
}

export function useFocusRegion(): iRegionModel | null {
  const { bundle, enabled, regionId, covers } = useFocusContext();
  const fb = useRegion(covers() || !enabled ? null : regionId);
  return covers() ? bundle!.region : fb;
}

export function useCountryRoundup(): PlaceRoundup | null {
  const { bundle, enabled, countryId, covers } = useFocusContext();
  const fb = useLatestPlaceRoundup("country", covers() || !enabled ? null : countryId);
  return covers() ? bundle!.countryRoundup : fb;
}

export function useRegionRoundup(): PlaceRoundup | null {
  const { bundle, enabled, regionId, covers } = useFocusContext();
  const fb = useLatestPlaceRoundup("region", covers() || !enabled ? null : regionId);
  return covers() ? bundle!.regionRoundup : fb;
}

const TOP_CITY_LIMIT = 8;

/** Bbox cities fallback — replicates TopCitiesPanel's rounded-dedup + limit. */
function useListCitiesInBbox(bbox: Bbox | null): City[] {
  const [cities, setCities] = useState<City[]>([]);
  const key = bbox ? bbox.map((v) => v.toFixed(1)).join(",") : "";
  useEffect(() => {
    if (!bbox) {
      setCities([]);
      return;
    }
    let cancelled = false;
    listCities({ bbox, limit: TOP_CITY_LIMIT }).then((r) => {
      if (!cancelled) setCities(r);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return cities;
}

export function useTopCities(bbox: Bbox | null): City[] {
  const { bundle, enabled, framesFocus } = useFocusContext();
  const cover = framesFocus(bbox);
  const fb = useListCitiesInBbox(cover || !enabled ? null : bbox);
  return cover ? bundle!.topCities.map((c) => c.city) : fb;
}

// ── Bundle-only selectors (no live fallback needed) ───────────────────────────
export function useNearbyCities(center: Center | null): FocusNearbyCity[] {
  const { bundle, atFocus } = useFocusContext();
  return atFocus(center) ? bundle!.nearbyCities : [];
}

export function useFocusTarget(): FocusTarget {
  const { bundle, covers } = useFocusContext();
  return covers() ? bundle!.target : null;
}
