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
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { focusSubjectOf, type Segment, type SegmentKind } from "@photonsurge/shared/director";
import type { iRegionModel } from "@photonsurge/shared/db/region-model";

import { hasRealLocation } from "../../components/broadcast/kinds";
import { buildFocusKey } from "./focusKey";
import type { FocusBundle, FocusDetail, FocusNearbyCity, FocusRegionCountry, FocusRequest, FocusTarget, TopCitiesBasis } from "./types";
import type { Quake } from "../tracks/types";
import type { AlertTimelineBeat } from "@photonsurge/shared/alerts/timeline";
import type { AlertNarrative } from "@photonsurge/shared/alerts/narrative";
import type { iAlertSeries } from "@photonsurge/shared/db/alert-series-model";
import type { iAlertResource } from "@photonsurge/shared/db/alert-resource-model";
import type { AlertSnapshotMeta } from "@photonsurge/shared/db/alert-snapshot-repo";
import type { iWatchedEvent } from "@photonsurge/shared/db/watched-event-model";
import type { EventTimelineBeat } from "@photonsurge/shared/events/event-timeline";
import type { iEventResource } from "@photonsurge/shared/db/event-resource-model";
import type { EventSnapshotMeta } from "@photonsurge/shared/db/event-snapshot-repo";
import type { VolcanoMedia } from "@photonsurge/shared/volcanoes/media";
import type { iEventSeries } from "@photonsurge/shared/db/event-series-model";
import type { LocalZone } from "@photonsurge/shared/time/local-zone";

import { usePointHistory, useAreaHistory, useClimateYear } from "../history-client";
import { usePointForecast, useAreaForecast } from "../forecast-client";
import { useSeismoGauge, type SeismoGauge } from "../seismo-gauge";
import { useTideGauge, type TideGauge } from "../tide-gauge";
import { useCountryAt, type CountryAt } from "../countries";
import { useRegion } from "../regions";
import { useLatestPlaceRoundup, type PlaceRoundup } from "../placeRoundups";
import { listCities, type City } from "../cities";
import type { HistorySeries, AreaHistorySeries } from "../weather-history";
import type { ForecastDay, AreaForecastDay, ForecastStep } from "../weather-forecast";
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
  /**
   * True while the `/api/focus` call for the CURRENT focus key is still in flight
   * (enabled, this key's fetch hasn't settled, and no bundle covers it yet).
   * Selectors suppress their standalone fallback while this holds so a cut/page-
   * load waits for the one consolidated call instead of racing the full per-panel
   * fan-out. Cleared the instant the focus fetch settles — so a genuine
   * miss/failure still falls back. Race-free: keyed on a settled-key, not the
   * lagging `loading` flag, so it's already true on the enable-flip render.
   */
  awaitingFocus: boolean;
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
  awaitingFocus: false,
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

// ── Client-side bundle cache ────────────────────────────────────────────────
// Hold the current + pre-warmed upcoming bundles in BROWSER memory so a director
// cut is an instant covers() (zero network, zero flash), and so the first shot's
// data is already resident before the globe finishes decoding. Bounded LRU (runs
// 24/7): a few entries, oldest evicted. A stale entry still paints immediately
// while a background refetch replaces it — never a blank cut.
const BUNDLE_CACHE_MAX = 6;
/** Under the server focus-cache TTL — a client hit fresher than this skips the
 *  network entirely; older still paints instantly, then refetches to refresh. */
const BUNDLE_FRESH_MS = 45_000;
const bundleCache = new Map<string, FocusBundle>();

function cacheGet(key: string): FocusBundle | undefined {
  const b = bundleCache.get(key);
  if (b) {
    bundleCache.delete(key); // LRU bump to most-recent
    bundleCache.set(key, b);
  }
  return b;
}

function cachePut(b: FocusBundle): void {
  bundleCache.delete(b.key);
  bundleCache.set(b.key, b);
  while (bundleCache.size > BUNDLE_CACHE_MAX) {
    const oldest = bundleCache.keys().next().value;
    if (oldest === undefined) break;
    bundleCache.delete(oldest);
  }
}

function cacheFresh(b: FocusBundle | undefined): b is FocusBundle {
  return b != null && Date.now() - b.generatedAt < BUNDLE_FRESH_MS;
}

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

/** An upcoming director shot carrying enough to pre-warm its bundle. */
export interface UpcomingFocus {
  kind: SegmentKind;
  center?: Center;
  zoom?: number;
  subject?: string | null;
}

interface FocusProviderProps {
  onAirSegment: Segment | null;
  /** live operator camera — fallback centre/zoom + the moving round-up stop */
  camera: { center: Center; zoom: number };
  /** false until globe textures decode; no fetch / no fallback fires while false */
  enabled: boolean;
  /** The director's next queued shots — the immediate next is pre-warmed into
   *  Redis so its /api/focus fetch is a hit when it airs (zero-flash). */
  upcoming?: UpcomingFocus[];
  detail?: FocusDetail;
  children: ReactNode;
}

export function FocusProvider({ onAirSegment, camera, enabled, upcoming, detail = "broadcast", children }: FocusProviderProps) {
  const kind: SegmentKind = onAirSegment?.kind ?? "global";
  // The subject is everything after the kind — a storm's "<source>:<identifier>"
  // and a volcano's "gvp:NNN" carry colons of their own, so never split on all.
  const subject = onAirSegment ? focusSubjectOf(onAirSegment.id) : null;
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

  // Seed from the client cache so a cut to an already-warmed shot covers() on the
  // very first render (no loading tick, no fetch).
  const [bundle, setBundle] = useState<FocusBundle | null>(() => cacheGet(focusKey) ?? null);
  const [loading, setLoading] = useState(false);
  // The focus key whose /api/focus call has SETTLED (resolved or failed). Starts
  // null so `awaitingFocus` is already true on the render the provider first
  // enables — no one-render window for the fallback fan-out to escape.
  const [settledKey, setSettledKey] = useState<string | null>(null);

  // Fetch as soon as we know the on-air THING — do NOT wait for globe textures to
  // decode (`enabled`/`ready`). The bundle is JSON every panel needs; gating it
  // behind the multi-second texture warmup made /api/focus the LAST request of a
  // page load, so panels sat empty until it finally ran. Firing on a concrete
  // segment (and once ready for the null/global case) overlaps the compose with
  // texture decode, so the bundle usually covers() by the time the globe reveals.
  const canFetch = enabled || onAirSegment != null;

  useEffect(() => {
    if (!canFetch) {
      setLoading(false);
      return;
    }
    // Client-memory hit: paint the cached bundle immediately. If it's still fresh,
    // skip the network entirely; if stale, keep painting it while we refetch.
    const cached = cacheGet(focusKey);
    if (cached) setBundle(cached);
    if (cacheFresh(cached)) {
      setSettledKey(focusKey);
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
          if (b) {
            cachePut(b); // retain in client memory for instant re-cover on cut/reload
            setBundle(b); // keep last bundle on a null/failed response
          }
          setSettledKey(focusKey); // this key's fetch is done — release the fallback gate
          setLoading(false);
        }
      })
      .catch((e) => {
        if (alive && e?.name !== "AbortError") {
          setSettledKey(focusKey); // a failed fetch still releases the gate → live fallback
          setLoading(false);
        }
      });
    return () => {
      alive = false;
      ctrl.abort();
    };
    // primitive deps only — sub-grid drift that rounds to the same key never refetches
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusKey, canFetch]);

  // ── Pre-warm the immediate-next cut ──────────────────────────────────────
  // The (OBS) browser fetches the director's next shot ~one hold before it airs
  // and STORES the bundle in the client cache — so when it airs the cut is an
  // instant covers() with zero network (not just a 6ms server-Redis hit). Fires
  // as soon as the shot is known (canFetch), overlapping the compose with texture
  // decode. O(1) memory: only the next shot, re-warmed when its key changes.
  // Best effort — a miss just falls back to a normal compose on air.
  const next = canFetch ? upcoming?.[0] : undefined;
  const nextKey =
    next?.center && next.zoom != null
      ? buildFocusKey({ kind: next.kind, center: next.center, zoom: next.zoom, detail, subject: next.subject ?? null })
      : null;
  // Serialize against the current compose: two focus composes at once thrash
  // sharp/libvips decode on `public` (memory spike + ~3× wall-clock each — a
  // concurrent pair once took 7.6s vs ~2.6s solo). Hold the pre-warm until THIS
  // cut's bundle has settled, so at most one compose runs at a time.
  const currentSettled = settledKey === focusKey;
  const warmedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!nextKey || nextKey === focusKey || nextKey === warmedRef.current) return;
    if (!currentSettled) return; // current still composing — don't add a second
    if (cacheFresh(cacheGet(nextKey))) return; // already resident + fresh — nothing to warm
    warmedRef.current = nextKey;
    const n = next!; // nextKey non-null ⇒ center + zoom present
    const ctrl = new AbortController();
    const qs = new URLSearchParams({
      kind: n.kind,
      lng: String(n.center![0]),
      lat: String(n.center![1]),
      zoom: String(n.zoom!),
      detail,
    });
    if (n.subject) qs.set("subject", n.subject);
    fetch(`/api/focus?${qs.toString()}`, { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((b: FocusBundle | null) => {
        if (b) cachePut(b); // resident in browser memory before it airs
      })
      .catch(() => {}); // fail-open
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nextKey, currentSettled]);

  const covers = () => bundle != null && bundle.key === focusKey;
  // Hold every panel's standalone fallback while THIS focus key's consolidated
  // call is still outstanding (enabled, not yet settled, not yet covered).
  const awaitingFocus = enabled && !covers() && settledKey !== focusKey;
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
  const liveCountry = useCountryAt(!bundleCountry && enabled && !awaitingFocus ? ledeCenter : null);
  const country = bundleCountry ?? liveCountry;
  const countryId = country?.countryId ?? null;

  const value: FocusContextValue = {
    bundle,
    focusKey,
    enabled,
    loading,
    awaitingFocus,
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
  const { bundle, enabled, awaitingFocus, atFocus } = useFocusContext();
  const wantPoint = !bbox; // point history is suppressed when a bbox is framed
  const cover = wantPoint && atFocus(center);
  const skip = cover || !enabled || awaitingFocus || bbox ? null : center;
  const fb = usePointHistory(skip);
  if (cover) return { series: bundle!.pointHistory, loading: false };
  if (bbox) return fb; // area mode: point history is intentionally empty here
  // Hold the spinner until data is actually present — never drop to an empty
  // not-loading state while the focus call or the fallback is still working.
  return { series: fb.series, loading: awaitingFocus || fb.loading || (enabled && fb.series.length === 0) };
}

export function useAreaHistorySeries(bbox: Bbox | null): { series: AreaHistorySeries[]; loading: boolean } {
  const { bundle, enabled, awaitingFocus, framesFocus } = useFocusContext();
  const cover = framesFocus(bbox);
  const fb = useAreaHistory(cover || !enabled || awaitingFocus ? null : bbox);
  if (cover) return { series: bundle!.areaHistory, loading: false };
  return { series: fb.series, loading: awaitingFocus || fb.loading || (enabled && fb.series.length === 0) };
}

export function usePointForecastDays(center: Center | null): { days: ForecastDay[]; loading: boolean } {
  const { bundle, enabled, awaitingFocus, atFocus } = useFocusContext();
  const cover = atFocus(center);
  const fb = usePointForecast(cover || !enabled || awaitingFocus ? null : center);
  if (cover) return { days: bundle!.pointForecast, loading: false };
  return { days: fb.days, loading: awaitingFocus || fb.loading || (enabled && fb.days.length === 0) };
}

export function useAreaForecastDays(bbox: Bbox | null): { days: AreaForecastDay[]; loading: boolean } {
  const { bundle, enabled, awaitingFocus, framesFocus } = useFocusContext();
  const cover = framesFocus(bbox);
  const fb = useAreaForecast(cover || !enabled || awaitingFocus ? null : bbox);
  if (cover) return { days: bundle!.areaForecast, loading: false };
  return { days: fb.days, loading: awaitingFocus || fb.loading || (enabled && fb.days.length === 0) };
}

export function useClimateFor(
  center: Center | null,
  granularity: "weekly" | "monthly" = "monthly",
): { datasets: ClimateBucketedDataset[]; loading: boolean } {
  const { bundle, enabled, awaitingFocus, atFocus, covers } = useFocusContext();
  // bundle climate (focus point + baked cities) is MONTHLY only
  const focusHit = granularity === "monthly" && atFocus(center, 1);
  // baked city climate only from the CURRENT bundle (covers()) — a city sits off
  // the focus centre, so atFocus doesn't apply; match by its own 1dp coord.
  const cityHit =
    granularity === "monthly" && !focusHit && covers() && bundle && center
      ? findCityClimate(bundle, center)
      : null;
  const cover = focusHit || cityHit != null;
  const fb = useClimateYear(cover || !enabled || awaitingFocus ? null : center, granularity);
  if (focusHit) return { datasets: bundle!.climate, loading: false };
  if (cityHit) return { datasets: cityHit, loading: false };
  // Climate is legitimately empty at remote points (no cached climate within
  // range), so don't spin forever on empty — only while focus/fallback is working.
  return { datasets: fb.datasets, loading: awaitingFocus || fb.loading };
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
  const { bundle, enabled, awaitingFocus, atFocus } = useFocusContext();
  const cover = atFocus(center);
  const fb = useSeismoGauge(cover || !enabled || awaitingFocus ? null : center, enabled && !cover && !awaitingFocus);
  const bundleActive = useCycledActive(cover ? bundle!.seismoStations : EMPTY_SEISMO);
  return cover ? { stations: bundle!.seismoStations, active: bundleActive } : fb;
}

export function useTideStations(center: Center | null): TideGauge {
  const { bundle, enabled, awaitingFocus, atFocus } = useFocusContext();
  const cover = atFocus(center);
  const fb = useTideGauge(cover || !enabled || awaitingFocus ? null : center, enabled && !cover && !awaitingFocus);
  const bundleActive = useCycledActive(cover ? bundle!.tideStations : EMPTY_TIDE);
  return cover ? { stations: bundle!.tideStations, active: bundleActive } : fb;
}

export function useFocusCountry(center: Center | null): CountryAt | null {
  const { country, ledeCenter, enabled, awaitingFocus } = useFocusContext();
  // areaInfo passes exactly ledeCenter → reuse the provider-resolved country.
  const sameAsLede =
    center != null &&
    ledeCenter != null &&
    center[0].toFixed(0) === ledeCenter[0].toFixed(0) &&
    center[1].toFixed(0) === ledeCenter[1].toFixed(0);
  const fb = useCountryAt(sameAsLede || !enabled || awaitingFocus ? null : center);
  return sameAsLede ? country : fb;
}

export function useFocusRegion(): iRegionModel | null {
  const { bundle, enabled, awaitingFocus, regionId, covers } = useFocusContext();
  const fb = useRegion(covers() || !enabled || awaitingFocus ? null : regionId);
  return covers() ? bundle!.region : fb;
}

export function useCountryRoundup(): PlaceRoundup | null {
  const { bundle, enabled, awaitingFocus, countryId, covers } = useFocusContext();
  const fb = useLatestPlaceRoundup("country", covers() || !enabled || awaitingFocus ? null : countryId);
  return covers() ? bundle!.countryRoundup : fb;
}

export function useRegionRoundup(): PlaceRoundup | null {
  const { bundle, enabled, awaitingFocus, regionId, covers } = useFocusContext();
  const fb = useLatestPlaceRoundup("region", covers() || !enabled || awaitingFocus ? null : regionId);
  return covers() ? bundle!.regionRoundup : fb;
}

const EMPTY_REGION_COUNTRIES: FocusRegionCountry[] = [];
const EMPTY_STEPS: ForecastStep[] = [];

/** The region spotlight's per-country forecasts (biggest member countries, each
 *  with its own 72h track). Bundle-only — composed server-side, so it's [] until
 *  the region bundle covers this cut. */
export function useRegionCountries(): FocusRegionCountry[] {
  const { bundle, covers } = useFocusContext();
  return covers() ? bundle!.regionCountries : EMPTY_REGION_COUNTRIES;
}

/** The region spotlight's NEXT 24H near-term forecast track (at the region's
 *  biggest city). Bundle-only, like useRegionCountries. */
export function useRegionNearTerm(): ForecastStep[] {
  const { bundle, covers } = useFocusContext();
  return covers() ? bundle!.regionNearTerm : EMPTY_STEPS;
}

const TOP_CITY_LIMIT = 8;

/** Bbox cities fallback — replicates TopCitiesPanel's rounded-dedup + limit. */
function useListCitiesInBbox(bbox: Bbox | null, cc?: string): City[] {
  const [state, setState] = useState<{ key: string; cities: City[] }>({ key: "", cities: [] });
  const country = cc?.toLowerCase();
  const key = bbox ? `${country ?? ""}|${bbox.map((v) => v.toFixed(1)).join(",")}` : "";
  useEffect(() => {
    if (!bbox) return;
    let cancelled = false;
    // Country membership, rather than camera bounds, defines a country list.
    listCities({ ...(country ? { cc: country } : { bbox }), limit: TOP_CITY_LIMIT }).then((cities) => {
      if (!cancelled) setState({ key, cities });
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- request scope is encoded in key
  }, [key]);
  return key && state.key === key ? state.cities : [];
}

/**
 * The CITY GUIDE's cities. Off the bundle when it frames `bbox`; else the live
 * bbox list — unless `bundleOnly`, for a targeted event whose guide follows the
 * EVENT (footprint / nearest — see target-cities.ts) and has no bbox-shaped
 * fallback: the biggest cities in the camera box are exactly the wrong list.
 */
export function useTopCities(bbox: Bbox | null, cc?: string, opts?: { bundleOnly?: boolean }): City[] {
  const { bundle, enabled, awaitingFocus, framesFocus } = useFocusContext();
  const cover = framesFocus(bbox);
  const fb = useListCitiesInBbox(cover || !enabled || awaitingFocus || opts?.bundleOnly ? null : bbox, cc);
  const cities = cover ? bundle!.topCities.map((c) => c.city) : fb;
  return cc ? cities.filter((city) => city.cc?.toLowerCase() === cc.toLowerCase()) : cities;
}

/** How the bundle picked the CITY GUIDE (heading copy); null off-bundle. */
export function useTopCitiesBasis(bbox: Bbox | null): TopCitiesBasis | null {
  const { bundle, framesFocus } = useFocusContext();
  return framesFocus(bbox) ? (bundle!.topCitiesBasis ?? null) : null;
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

/** Stable empty list so a bundle-less render doesn't churn memo dependencies. */
const NO_QUAKES: Quake[] = [];

/**
 * The quakes around the on-air shot, straight off the bundle. Deliberately NOT
 * age-windowed (unlike the global overlay feed): the bundle is scoped by the
 * cut's bbox, so an older headline event keeps its epicentre and its local
 * aftershock swarm on screen while the rest of the globe stays inside the live
 * 48h window. See QUAKE_LIVE_WINDOW_HOURS and mergeOnAirQuakes.
 */
export function useFocusAreaQuakes(): Quake[] {
  const { bundle, covers } = useFocusContext();
  return covers() ? bundle!.areaQuakes : NO_QUAKES;
}

/**
 * The local clock at the on-air point — an IANA zone off the nearest catalogued
 * city, else a longitude estimate. Null on wide shots (nothing to be local to)
 * and before the bundle lands; there is deliberately NO per-cut fallback fetch,
 * because a clock is worth exactly zero extra requests.
 */
export function useLocalZone(): LocalZone | null {
  const { bundle, covers } = useFocusContext();
  return covers() ? bundle!.localZone : null;
}

/** What the on-air storm's warning SAYS — description, instruction, areas, with
 *  the translation preferred. Null off a storm cut or before the bundle lands;
 *  bundle-only, because the text is the CAP message's and there is no cheap
 *  per-cut fetch that would beat waiting for it. */
export function useAlertNarrative(): AlertNarrative | null {
  const { bundle, covers } = useFocusContext();
  return covers() ? (bundle!.alertNarrative ?? null) : null;
}

/** The on-air storm's change timeline (empty off a storm cut or before a bundle). */
export function useAlertTimeline(): AlertTimelineBeat[] {
  const { bundle, covers } = useFocusContext();
  return covers() ? bundle!.alertTimeline : [];
}

/** The on-air storm's metric series (GDACS score/severity/population). */
export function useAlertSeries(): iAlertSeries[] {
  const { bundle, covers } = useFocusContext();
  return covers() ? bundle!.alertSeries : [];
}

/** The on-air storm's harvested official resource links. */
export function useAlertResources(): iAlertResource[] {
  const { bundle, covers } = useFocusContext();
  return covers() ? bundle!.alertResources : [];
}

/** The on-air storm's captured snapshot metadata (bytes via /api/alerts/snapshot/:id). */
export function useAlertSnapshots(): AlertSnapshotMeta[] {
  const { bundle, covers } = useFocusContext();
  return covers() ? bundle!.alertSnapshots : [];
}

/** The unified WatchedEvent the on-air storm was promoted to (null when not promoted). */
export function useWatchedEvent(): iWatchedEvent | null {
  const { bundle, covers } = useFocusContext();
  return covers() ? bundle!.watchedEvent : null;
}

/** The unified (cross-source) event timeline — superset of the alert timeline. */
export function useEventTimeline(): EventTimelineBeat[] {
  const { bundle, covers } = useFocusContext();
  return covers() ? bundle!.eventTimeline : [];
}

/** Official resources harvested across every contributing source. */
export function useEventResources(): iEventResource[] {
  const { bundle, covers } = useFocusContext();
  return covers() ? bundle!.eventResources : [];
}

/** Unified-event snapshot metadata (bytes via /api/events/snapshot/:id). */
export function useEventSnapshots(): EventSnapshotMeta[] {
  const { bundle, covers } = useFocusContext();
  return covers() ? bundle!.eventSnapshots : [];
}

/** Cross-source metric series for the event (deep-GDACS score/severity/population…). */
export function useEventSeries(): iEventSeries[] {
  const { bundle, covers } = useFocusContext();
  return covers() ? bundle!.eventSeries : [];
}

/** Cameras for the on-air thing (a volcano's official monitoring cameras) — from
 *  the one focus call, never a per-cut fetch. Empty when the cut has no cameras. */
export function useNearbyCams(): FocusBundle["nearbyCams"] {
  const { bundle, covers } = useFocusContext();
  return covers() ? bundle!.nearbyCams : [];
}

/** Latest internally stored volcano imagery, delivered by the same focus request. */
export function useVolcanoMedia(): VolcanoMedia[] {
  const { bundle, covers } = useFocusContext();
  return covers() ? (bundle!.volcanoMedia ?? []) : [];
}

/**
 * The on-air volcano's ACTIVE cameras, each already joined to OUR stored copy of
 * its latest frame (`localImageUrl`). Composed server-side on the one focus call —
 * no join, no per-cut fetch, and no hot-linking the provider from air.
 */
export function useVolcanoCams(): FocusBundle["volcanoCams"] {
  const { bundle, covers } = useFocusContext();
  return covers() ? (bundle!.volcanoCams ?? []) : [];
}

/** The on-air volcano's full GVP eruption history (newest first) — a catalog fact,
 *  so it's present even for a dormant volcano that was never promoted. */
export function useVolcanoEruptions(): FocusBundle["volcanoEruptions"] {
  const { bundle, covers } = useFocusContext();
  return covers() ? (bundle!.volcanoEruptions ?? []) : [];
}

/** Largest cities belonging to the current country/region; never reuse an old bundle. */
export function useReportCities(kind?: string) {
  const { bundle, covers } = useFocusContext();
  if (!bundle || !covers()) return [];
  const cities = kind === "region"
    ? bundle.region?.topCities ?? []
    : kind === "country" ? bundle.topCities.map((entry) => entry.city) : [];
  return [...cities].sort((a, b) => (b.population ?? 0) - (a.population ?? 0)).slice(0, 5)
    .map((city) => ({ label: city.name, lat: city.lat, lng: city.lng }));
}
