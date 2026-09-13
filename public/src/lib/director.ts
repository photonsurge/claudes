/**
 * Client-side auto-director helpers.
 *
 * Two flows:
 *  - Config (operator, /control): GET/PATCH /api/director/:scene/config. The
 *    worker re-reads the persisted config each tick, so a PATCH takes effect
 *    within ~1s — no operator→worker socket plumbing needed.
 *  - Live state (/watch + /control readout): the worker emits DIRECTOR_STATE on
 *    every cut + heartbeat; useDirector subscribes and returns the current shot
 *    for this scene.
 */
"use client";

import { useEffect, useMemo, useState } from "react";
import type { ControlState } from "@photonsurge/shared/control";
import { TRACKS_UPDATED } from "@photonsurge/shared/control";
import type { WeatherManifest } from "@photonsurge/shared/manifest";
import {
  DIRECTOR_STATE,
  DEFAULT_DIRECTOR_CONFIG,
  mergeDirectorConfig,
  type DirectorConfig,
  type DirectorState,
  type Segment,
  type SegmentKind,
  type SegmentSummaryStop,
} from "@photonsurge/shared/director";
import { globalMapTour, type MapTypeNeed } from "@photonsurge/shared/director-rois";
import { countryShot, countryContaining } from "@photonsurge/shared/director-countries";
import { hazardMapPlan } from "@photonsurge/shared/alerts/hazard-director";
import { severityLabel } from "./alerts";
import { bboxForCamera } from "./history-client";
import { useSocket } from "./socket-provider";

/**
 * While a shot holds, rotate the map over time so the same view is read through
 * several looks. Two flavours share one epoch clock (derived from the cut's
 * spinEpoch + a fixed period, so /control and /watch switch in lockstep — the same
 * deterministic trick as the spin/push-in, with no extra socket traffic):
 *
 *  - GLOBAL world spins (intro/global/ocean) tour full "MAP TYPES" — a scalar field OR an
 *    overlay look (aurora, live satellite imagery) — and relabel the on-air card
 *    per type. The tour tables live in shared/director-rois (globalMapTour), and
 *    each type is gated on live data being available so a spin never lands blank.
 *  - REGION shots (country) sweep the valid land fields; `storm` reads the
 *    per-hazard plan (hazardMapPlan) so a heat warning shows humidity→temp and a
 *    tornado CAPE→radar→gust. `quake` tours terrain looks (contours → relief →
 *    satellite) under a fixed headline card — no weather field, and the card
 *    keeps the magnitude/place label rather than relabelling per look.
 */
const VAR_CYCLE: Partial<Record<SegmentKind, string[]>> = {
  country: ["temp", "humidity", "rain", "gust", "cloud", "visibility"],
  // A region ("area") spotlight tours the same ambient field cycle as a country.
  region: ["temp", "humidity", "rain", "gust", "cloud", "visibility"],
};
const VAR_CYCLE_MS = 5500;
/** Per-map dwell for the global map-type tour — a touch longer, each look is a beat. */
const GLOBAL_MAP_CYCLE_MS = 6000;
/**
 * The "just show the maps off" world spins. They ONLY tour MAP TYPES (the
 * globalMapTour cycle) — they never fly the camera round hotspot stops and never
 * glow a country. The go-round-a-place tour (camera fly-to + hold + caption +
 * country glow) is the Areas (region) camera model instead; a spin that happens
 * to carry a round-up narrative still shows it as static on-air graphics, but the
 * camera keeps spinning the globe. See cutSteps / activeCountryIso below.
 */
const SPIN_KINDS = new Set<SegmentKind>(["intro", "global", "ocean"]);

/** The go-round-a-place camera stops for a cut (an Areas/region tour), or
 *  undefined. Region shots carry them on `tourStops` (worker-populated from the
 *  area's biggest cities). SPIN_KINDS never tour — a `global` round-up's own
 *  `summary.stops` are deliberately NOT flown; the spin just shows maps off. */
function tourStopsOf(cut: Segment): SegmentSummaryStop[] | undefined {
  if (SPIN_KINDS.has(cut.kind)) return undefined;
  return cut.tourStops?.length ? cut.tourStops : undefined;
}
/**
 * Ocean monitoring-region shots (`Segment.depthCycle`, see
 * `worker/src/director/candidates.ts`) flip through the sea-temp-at-depth
 * chapters instead of the normal ocean field tour — the editorial point IS
 * the thermocline (El Niño/ENSO, Atlantic MDR, North Sea, Med, IOD).
 */
const DEPTH_CYCLE_VARS = ["sst", "sst100", "sst500", "sst2000", "sst5000"];
const DEPTH_CYCLE_MS = 2500;
/**
 * Camera dwell per round-up stop, and the zoom it flies to. A round-up parks on
 * each stop long enough to play that country's whole left-column package — the
 * nation card, its forecast, its active alerts, its capital + top cities, the
 * round-up stats (see mode-slides' `summary` branch) — which the SlideDeck
 * rotates through at HOLD_MS (6s) each. So the dwell has to clear a full deck
 * rotation, not just a beat: ~40s covers the ~6-slide package with headroom.
 *
 * Each stop change flies the camera (taking cut.patch.cutTransitionMs, the
 * operator's transition-speed setting); the dwell is ON TOP of that flight, not
 * instead of it. NB the worker must size the segment's holdMs to
 * stops × (flight + dwell) or the tour cuts away mid-package — see
 * `summaryCandidates` in worker/src/director/candidates.ts.
 */
const SUMMARY_STOP_DWELL_MS = 40_000;
const SUMMARY_STOP_ZOOM = 5;

/** One step of a cut's within-shot rotation: the look, plus an optional relabel. */
interface MapStep {
  patch: Partial<ControlState>;
  /** Global tours relabel the on-air card per map type; other cuts keep their title. */
  label?: { title: string; subtitle: string };
  /**
   * When set, `label` is the current tour STOP (a city on an Areas tour) — it is
   * surfaced as the separate `focus` caption for the centre reticle, NOT used to
   * relabel the shot's own title. The shot's title stays the AREA name, so the
   * left-column card keeps naming the area while the reticle names the city.
   */
  focus?: boolean;
}

/**
 * Which map types the client knows have live data right now, so a tour never
 * lands on a blank look. Scalar fields come from the manifest; aurora/satimg bake
 * separately, so they're probed from their cached-frame endpoints.
 */
export interface MapTypeAvailability {
  variables: Set<string>;
  aurora: boolean;
  satimg: boolean;
}

function needMet(need: MapTypeNeed | undefined, a: MapTypeAvailability): boolean {
  if (!need) return true;
  if (need.kind === "aurora") return a.aurora;
  if (need.kind === "satimg") return a.satimg;
  // Variable: allow when the manifest isn't loaded yet (don't over-filter on cold
  // start); once known, require the field to actually be present.
  return a.variables.size === 0 || a.variables.has(need.id);
}

/** Poll interval for the aurora/satimg availability probe (a slow safety net). */
const AVAIL_POLL_MS = 5 * 60 * 1000;

/** Track which "map type" feeds (aurora, satellite imagery) currently have a baked frame. */
function useMapTypeAvailability(manifest: WeatherManifest | null): MapTypeAvailability {
  const { socket } = useSocket();
  const [feeds, setFeeds] = useState({ aurora: false, satimg: false });
  const [liveTick, setLiveTick] = useState(0);

  // Nudge a refetch when the worker re-bakes either feed.
  useEffect(() => {
    if (!socket) return;
    const onUpdated = (p?: { kind?: string }) => {
      if (p?.kind === "aurora" || p?.kind === "satimg") setLiveTick((n) => n + 1);
    };
    socket.on(TRACKS_UPDATED, onUpdated);
    return () => {
      socket.off(TRACKS_UPDATED, onUpdated);
    };
  }, [socket]);

  useEffect(() => {
    let cancelled = false;
    const probe = async () => {
      const [a, s] = await Promise.all([
        fetch("/api/aurora", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
        fetch("/api/satimg", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
      ]);
      if (cancelled) return;
      setFeeds({ aurora: Boolean(a?.aurora), satimg: Array.isArray(s?.frames) && s.frames.length > 0 });
    };
    probe();
    const t = setInterval(probe, AVAIL_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [liveTick]);

  const variables = useMemo(() => new Set(manifest ? Object.keys(manifest.variables) : []), [manifest]);
  return useMemo(
    () => ({ variables, aurora: feeds.aurora, satimg: feeds.satimg }),
    [variables, feeds.aurora, feeds.satimg],
  );
}

/** The step sequence + cadence for a cut. `anchored` opens on step 0 (the hero look). */
export function cutSteps(
  cut: Segment,
  avail: MapTypeAvailability,
  mapTypeIds?: string[],
): { steps: MapStep[]; periodMs: number; anchored: boolean } {
  if (cut.kind === "ocean" && cut.depthCycle) {
    return {
      steps: DEPTH_CYCLE_VARS.map((v) => ({ patch: { activeVariable: v } })),
      periodMs: DEPTH_CYCLE_MS,
      anchored: false,
    };
  }
  // The go-round-a-place tour: when a cut carries geocoded stops, fly to each
  // in turn and relabel the on-air card with its place, instead of a map-type
  // cycle. This is the AREAS (region) camera model — SPIN_KINDS (intro/global/
  // ocean) never tour (tourStopsOf returns undefined for them) so a world spin
  // only ever shows maps off (it falls through to globalMapTour below); a
  // round-up riding a spin still shows its narrative as graphics, but the globe
  // keeps spinning rather than touring the stops.
  const stops = tourStopsOf(cut);
  if (stops?.length) {
    const steps = stops.map(
      (s): MapStep => ({
        // A stop FRAMES a specific hotspot, so hold it like a country spotlight —
        // override the global spin's autoSpin. Spinning a framed, zoomed-in stop
        // just drifts it off-screen (the "framed shots HOLD" rule in director-rois).
        // A stop may carry its own zoom (a country tour's wide establishing
        // "middle" stop) — otherwise the default per-stop zoom.
        patch: { camera: { center: [s.lng, s.lat], zoom: s.zoom ?? SUMMARY_STOP_ZOOM }, autoSpin: false, spinSpeed: 0 },
        // The stop caption (city + its country, or an event stop's severity) rides
        // the centre reticle as `focus`, NOT the shot title — the card keeps naming
        // the AREA while the reticle names the current place. See useDirectorCut.
        label: { title: s.label, subtitle: [s.severity != null ? severityLabel(s.severity) : undefined, s.subtitle].filter(Boolean).join(" · ") },
        focus: true,
      }),
    );
    const flightMs = cut.patch.cutTransitionMs ?? 4000;
    return { steps, periodMs: flightMs + SUMMARY_STOP_DWELL_MS, anchored: true };
  }
  const tour = globalMapTour(cut.kind, mapTypeIds);
  if (tour) {
    // Global spins ARE the map type, so they relabel the on-air card per look. An
    // event shot (quake) keeps its headline card (magnitude/place) and only swaps
    // the map underneath — so don't attach a per-type label for those.
    const relabel = cut.kind === "intro" || cut.kind === "global" || cut.kind === "ocean";
    const steps = tour
      .filter((t) => needMet(t.needs, avail))
      .map((t): MapStep => ({
        patch: t.patch,
        label: relabel ? { title: t.title, subtitle: t.subtitle } : undefined,
      }));
    return { steps, periodMs: GLOBAL_MAP_CYCLE_MS, anchored: true };
  }
  if (cut.kind === "storm") {
    const plan = hazardMapPlan(cut.hazard);
    return { steps: plan.cycle.map((v) => ({ patch: { activeVariable: v } })), periodMs: plan.cycleMs, anchored: true };
  }
  const cyc = VAR_CYCLE[cut.kind] ?? [];
  return { steps: cyc.map((v) => ({ patch: { activeVariable: v } })), periodMs: VAR_CYCLE_MS, anchored: false };
}

/**
 * The current map step for a cut, or null to leave the cut's own look untouched.
 * Updates on a slow timer (not per frame); the index is derived deterministically
 * from spinEpoch so every client agrees.
 */
function useMapStep(cut: Segment | null, avail: MapTypeAvailability, mapTypeIds?: string[]): MapStep | null {
  const [step, setStep] = useState<MapStep | null>(null);
  const resolved = useMemo(() => (cut ? cutSteps(cut, avail, mapTypeIds) : null), [cut, avail, mapTypeIds]);
  const epoch = cut?.patch.spinEpoch ?? 0;

  useEffect(() => {
    if (!resolved || resolved.steps.length === 0) {
      setStep(null);
      return;
    }
    const { steps, periodMs, anchored } = resolved;
    // Anchored tours (global spins / events) open on step 0 — the hero look /
    // headline field. Ambient filler starts each airing on a varied, epoch-derived
    // offset (still agreed across clients) so the sequence isn't identical each time.
    const offset = anchored ? 0 : Math.floor(epoch / 1000);
    const pick = () => {
      const elapsed = Math.max(0, Date.now() - epoch);
      setStep(steps[(Math.floor(elapsed / periodMs) + offset) % steps.length]);
    };
    pick();
    const t = setInterval(pick, 500);
    return () => clearInterval(t);
  }, [resolved, epoch]);

  return step;
}

/** Event kinds worth pulse-highlighting on the globe (a fixed point of interest). */
const PULSE_KINDS = new Set<SegmentKind>(["storm", "quake", "volcano"]);

/** The [lng,lat] to pulse-highlight for the current shot, or null. */
export function eventPulse(director: DirectorState | null): [number, number] | null {
  if (!director?.active || !director.segment) return null;
  return PULSE_KINDS.has(director.segment.kind) ? director.segment.camera.center : null;
}

/** ISO-3166 alpha-2 of the on-air country spotlight to glow-highlight on the
 *  globe, or null. Segment ids are "kind:subject" (e.g. "country:portugal"),
 *  so the CountryShot catalog lookup needs the bare subject — see
 *  shared/director-countries.
 *
 *  An Areas (region) tour flies a fresh stop every few seconds by patching the
 *  *live* camera rather than moving `segment.camera`, so callers pass that live
 *  centre in as `liveCenter` (e.g. /watch's `shown.camera.center`); when the
 *  current stop lands inside a curated country this glows it exactly like a real
 *  country spotlight. SPIN_KINDS are excluded — a world spin just shows maps. */
export function activeCountryIso(
  director: DirectorState | null,
  liveCenter?: [number, number],
): string | null {
  if (!director?.active || !director.segment) return null;
  if (director.segment.kind === "country") {
    const subject = director.segment.id.split(":")[1] ?? "";
    return countryShot(subject)?.iso2 ?? null;
  }
  // An Areas tour flies a fresh stop every few seconds by patching the *live*
  // camera. Prefer the stop's own ISO (worker-tagged from the framed country, so
  // even countries outside the curated catalog glow); fall back to the curated
  // point lookup for stops with no ISO (e.g. a round-up hotspot). SPIN_KINDS never
  // tour, so they never glow a country — a world spin just shows maps off.
  const stops = tourStopsOf(director.segment);
  if (stops?.length && liveCenter) {
    const hit = stops.find((s) => s.lng === liveCenter[0] && s.lat === liveCenter[1]);
    if (hit?.iso2) return hit.iso2;
    return countryContaining(liveCenter[0], liveCenter[1])?.iso2 ?? null;
  }
  return null;
}

/** The framed [west,south,east,north] box of a wide on-air shot with no single
 *  spotlighted subject, or null — the globe glows every country boundary that
 *  falls inside it instead of a single spotlighted one.
 *
 *  A round-up stop gets this "whole area" treatment off its live camera
 *  (see `activeCountryIso` above) whenever the stop *isn't* inside a curated
 *  country — country glow takes priority there instead. */
export function activeRegionBbox(
  director: DirectorState | null,
  liveCamera?: { center: [number, number]; zoom: number },
): [number, number, number, number] | null {
  if (!director?.active || !director.segment) return null;
  const stops = tourStopsOf(director.segment);
  if (stops?.length && liveCamera) {
    // A stop the country glow already owns (its own ISO, or a curated country
    // under it) doesn't also get the whole-frame boundary glow.
    const hit = stops.find((s) => s.lng === liveCamera.center[0] && s.lat === liveCamera.center[1]);
    if (hit?.iso2) return null;
    if (countryContaining(liveCamera.center[0], liveCamera.center[1])) return null;
    return bboxForCamera(liveCamera.center, liveCamera.zoom);
  }
  return null;
}

/**
 * The effective look for the current cut: its baseline `patch` with the current
 * within-shot map step folded in (the cycled field, or a full map-type look for a
 * global spin), plus the `segment` relabelled to the current map type (global
 * tours only — other cuts keep their title). Pages merge `patch` over their own
 * state to render, and pass `segment` to the on-air chrome. Both null when idle.
 */
export function useDirectorCut(
  cut: Segment | null,
  manifest: WeatherManifest | null,
  /** Operator-enabled map-type ids for the cut's kind (DirectorConfig.mapTypes[kind]). */
  mapTypeIds?: string[],
): {
  patch: Partial<ControlState> | null;
  segment: Segment | null;
  /** The current Areas tour stop's caption (city + country) for the centre
   *  reticle — null on every non-tour step. Kept separate from `segment` so the
   *  card keeps the area title while the reticle names the place. */
  focus: { title: string; subtitle: string } | null;
} {
  const avail = useMapTypeAvailability(manifest);
  const step = useMapStep(cut, avail, mapTypeIds);
  return useMemo(() => {
    if (!cut) return { patch: null, segment: null, focus: null };
    const patch = step ? { ...cut.patch, ...step.patch } : cut.patch;
    // A tour step (`focus`) captions the reticle, not the shot title; a global
    // map-type step relabels the card as it always has.
    const focus = step?.focus && step.label ? step.label : null;
    const segment =
      step?.label && !step.focus
        ? { ...cut, title: step.label.title, subtitle: step.label.subtitle }
        : cut;
    return { patch, segment, focus };
  }, [cut, step]);
}

/** Cold-start a scene's director config from the API. */
export async function fetchDirectorConfig(sceneId: string): Promise<DirectorConfig> {
  try {
    const res = await fetch(`/api/director/${encodeURIComponent(sceneId)}/config`, { cache: "no-store" });
    if (!res.ok) return DEFAULT_DIRECTOR_CONFIG;
    // Normalise against defaults so a config persisted before a kind existed
    // (e.g. "ocean") still has every kind — avoids undefined checkbox values.
    return mergeDirectorConfig(DEFAULT_DIRECTOR_CONFIG, (await res.json()) as Partial<DirectorConfig>);
  } catch {
    return DEFAULT_DIRECTOR_CONFIG;
  }
}

/**
 * Persist a director-config patch for a scene; returns the merged config.
 *
 * THROWS on a rejected write. It used to return the error body, which callers
 * then stored as if it were a config — the settings page's Save needs a real
 * failure to report, and the optimistic callers below keep their last-known
 * config instead of adopting `{ error }`.
 */
export async function patchDirectorConfig(
  sceneId: string,
  patch: Partial<DirectorConfig>,
): Promise<DirectorConfig> {
  const res = await fetch(`/api/director/${encodeURIComponent(sceneId)}/config`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error || `director config write failed (${res.status})`);
  }
  return (await res.json()) as DirectorConfig;
}

/**
 * Operator "cut to the next shot now" for a scene — the same mechanism as
 * /control's Skip ⏭: bump the persisted `skipNonce`, which the worker's director
 * loop compares against the nonce it last acted on and cuts within a tick (~1s).
 *
 * Read-then-bump rather than a client-side counter so any surface can fire it
 * without holding the config; both calls are checked so a failed hop surfaces to
 * the caller instead of silently doing nothing (a swallowed GET would fall back
 * to nonce 0 and the worker would ignore the bump).
 */
export async function skipToNextShot(sceneId: string): Promise<void> {
  const url = `/api/director/${encodeURIComponent(sceneId)}/config`;
  const read = await fetch(url, { cache: "no-store" });
  if (!read.ok) throw new Error(`director config read failed (${read.status})`);
  const cfg = (await read.json()) as DirectorConfig;
  const write = await fetch(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ skipNonce: (cfg.skipNonce ?? 0) + 1 }),
  });
  if (!write.ok) throw new Error(`director skip failed (${write.status})`);
}

/**
 * Deep-merge a director-config patch over a base, spreading the map-shaped
 * fields so a single-slider patch (e.g. `{ quakeHoldSeconds: { great: 40 } }`)
 * doesn't wipe its siblings. Top-level scalars and wholesale-replaced maps
 * (mapTypes/kindLooks/… — always patched as full objects by their editors)
 * fall through the plain spread.
 */
export function mergeConfig(prev: DirectorConfig, patch: Partial<DirectorConfig>): DirectorConfig {
  return {
    ...prev,
    ...patch,
    kinds: { ...prev.kinds, ...(patch.kinds ?? {}) },
    kindHoldSeconds: { ...prev.kindHoldSeconds, ...(patch.kindHoldSeconds ?? {}) },
    quakeHoldSeconds: { ...prev.quakeHoldSeconds, ...(patch.quakeHoldSeconds ?? {}) },
    stormHoldSeconds: { ...prev.stormHoldSeconds, ...(patch.stormHoldSeconds ?? {}) },
    volcanoHoldSeconds: { ...prev.volcanoHoldSeconds, ...(patch.volcanoHoldSeconds ?? {}) },
  };
}

/**
 * Operator hook: load + edit a scene's director config as a click-to-save form.
 *
 * Two states are held: `config` is the SAVED server truth (what the worker reads
 * and what the /watch pages + /control live preview render), and `draft` is the
 * editable working copy the setup form mutates. Form fields call `edit` (local
 * only, flags `dirty`); one `save()` PATCHes the whole draft. `applyNow` is the
 * escape hatch for the always-visible controls that must take effect instantly
 * (Auto on/off, Skip) — it PATCHes immediately and keeps both states in sync
 * without disturbing pending draft edits. `update` is kept as an alias of
 * `applyNow` for read-only consumers that never edit.
 */
export function useDirectorConfig(sceneId: string): {
  config: DirectorConfig;
  draft: DirectorConfig;
  dirty: boolean;
  ready: boolean;
  update: (patch: Partial<DirectorConfig>) => void;
  applyNow: (patch: Partial<DirectorConfig>) => void;
  edit: (patch: Partial<DirectorConfig>) => void;
  save: () => void;
  discard: () => void;
} {
  const [config, setConfig] = useState<DirectorConfig>(DEFAULT_DIRECTOR_CONFIG);
  const [draft, setDraft] = useState<DirectorConfig>(DEFAULT_DIRECTOR_CONFIG);
  const [dirty, setDirty] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setReady(false);
    setDirty(false);
    fetchDirectorConfig(sceneId).then((c) => {
      if (cancelled) return;
      setConfig(c);
      setDraft(c);
      setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [sceneId]);

  // Immediate apply (Auto toggle / Skip): PATCH now and mirror into both states
  // so a just-toggled mode isn't reverted by the untouched draft. Only `patch`
  // is sent, so any pending form edits are left alone.
  const applyNow = (patch: Partial<DirectorConfig>) => {
    setConfig((prev) => mergeConfig(prev, patch));
    setDraft((prev) => mergeConfig(prev, patch));
    // A failed write leaves the optimistic merge above in place; the operator
    // sees the toggle they flipped and the next poll corrects it.
    void patchDirectorConfig(sceneId, patch)
      .then(setConfig)
      .catch(() => {});
  };

  // Form field edit: draft only, no network. Persisted later by save().
  const edit = (patch: Partial<DirectorConfig>) => {
    setDraft((prev) => mergeConfig(prev, patch));
    setDirty(true);
  };

  const save = () => {
    setDirty(false);
    void patchDirectorConfig(sceneId, draft)
      .then((c) => {
        setConfig(c);
        setDraft(c);
      })
      .catch(() => setDirty(true));
  };

  const discard = () => {
    setDraft(config);
    setDirty(false);
  };

  return { config, draft, dirty, ready, update: applyNow, applyNow, edit, save, discard };
}

/**
 * Live director state for a scene, or null when the director isn't driving it.
 * Reads the worker-event envelope's `data` field, filtered by scene id.
 */
export function useDirector(sceneId: string): DirectorState | null {
  const { socket } = useSocket();
  const [state, setState] = useState<DirectorState | null>(null);

  useEffect(() => {
    setState(null); // reset when switching scenes
    if (!socket) return;
    const onDirector = (payload: { data?: DirectorState } & Partial<DirectorState>) => {
      const ds = (payload?.data ?? payload) as DirectorState;
      if (!ds || ds.sceneId !== sceneId) return;
      setState(ds.active ? ds : null);
    };
    socket.on(DIRECTOR_STATE, onDirector);
    return () => {
      socket.off(DIRECTOR_STATE, onDirector);
    };
  }, [socket, sceneId]);

  return state;
}
