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
} from "@photonsurge/shared/director";
import { globalMapTour, type MapTypeNeed } from "@photonsurge/shared/director-rois";
import { hazardMapPlan } from "@photonsurge/shared/alerts/hazard-director";
import { useSocket } from "./socket-provider";

/**
 * While a shot holds, rotate the map over time so the same view is read through
 * several looks. Two flavours share one epoch clock (derived from the cut's
 * spinEpoch + a fixed period, so /control and /watch switch in lockstep — the same
 * deterministic trick as the spin/push-in, with no extra socket traffic):
 *
 *  - GLOBAL world spins (intro/ocean) tour full "MAP TYPES" — a scalar field OR an
 *    overlay look (aurora, live satellite imagery) — and relabel the on-air card
 *    per type. The tour tables live in shared/director-rois (globalMapTour), and
 *    each type is gated on live data being available so a spin never lands blank.
 *  - REGION shots (tour/weather) sweep the valid land fields; `storm` reads the
 *    per-hazard plan (hazardMapPlan) so a heat warning shows humidity→temp and a
 *    tornado CAPE→radar→gust. `quake` tours terrain looks (contours → relief →
 *    satellite) under a fixed headline card — no weather field, and the card
 *    keeps the magnitude/place label rather than relabelling per look.
 */
const VAR_CYCLE: Partial<Record<SegmentKind, string[]>> = {
  tour: ["temp", "humidity", "rain", "gust", "cloud"],
  country: ["temp", "humidity", "rain", "gust", "cloud"],
  weather: ["temp", "humidity", "rain", "gust", "cloud"],
};
const VAR_CYCLE_MS = 5500;
/** Per-map dwell for the global map-type tour — a touch longer, each look is a beat. */
const GLOBAL_MAP_CYCLE_MS = 6000;

/** One step of a cut's within-shot rotation: the look, plus an optional relabel. */
interface MapStep {
  patch: Partial<ControlState>;
  /** Global tours relabel the on-air card per map type; other cuts keep their title. */
  label?: { title: string; subtitle: string };
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
function cutSteps(
  cut: Segment,
  avail: MapTypeAvailability,
  mapTypeIds?: string[],
): { steps: MapStep[]; periodMs: number; anchored: boolean } {
  const tour = globalMapTour(cut.kind, mapTypeIds);
  if (tour) {
    // Global spins ARE the map type, so they relabel the on-air card per look. An
    // event shot (quake) keeps its headline card (magnitude/place) and only swaps
    // the map underneath — so don't attach a per-type label for those.
    const relabel = cut.kind === "intro" || cut.kind === "ocean";
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
const PULSE_KINDS = new Set<SegmentKind>(["storm", "quake"]);

/** The [lng,lat] to pulse-highlight for the current shot, or null. */
export function eventPulse(director: DirectorState | null): [number, number] | null {
  if (!director?.active || !director.segment) return null;
  return PULSE_KINDS.has(director.segment.kind) ? director.segment.camera.center : null;
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
): { patch: Partial<ControlState> | null; segment: Segment | null } {
  const avail = useMapTypeAvailability(manifest);
  const step = useMapStep(cut, avail, mapTypeIds);
  return useMemo(() => {
    if (!cut) return { patch: null, segment: null };
    const patch = step ? { ...cut.patch, ...step.patch } : cut.patch;
    const segment = step?.label
      ? { ...cut, title: step.label.title, subtitle: step.label.subtitle }
      : cut;
    return { patch, segment };
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

/** Persist a director-config patch for a scene; returns the merged config. */
export async function patchDirectorConfig(
  sceneId: string,
  patch: Partial<DirectorConfig>,
): Promise<DirectorConfig> {
  const res = await fetch(`/api/director/${encodeURIComponent(sceneId)}/config`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  return (await res.json()) as DirectorConfig;
}

/**
 * Operator hook: load + edit a scene's director config. `update` PATCHes the
 * server and optimistically updates local state.
 */
export function useDirectorConfig(sceneId: string): {
  config: DirectorConfig;
  ready: boolean;
  update: (patch: Partial<DirectorConfig>) => void;
} {
  const [config, setConfig] = useState<DirectorConfig>(DEFAULT_DIRECTOR_CONFIG);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setReady(false);
    fetchDirectorConfig(sceneId).then((c) => {
      if (cancelled) return;
      setConfig(c);
      setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [sceneId]);

  const update = (patch: Partial<DirectorConfig>) => {
    // Optimistic deep-merge for the map-shaped fields, so a single-slider patch
    // (e.g. { quakeHoldSeconds: { great: 40 } }) doesn't wipe its siblings.
    setConfig((prev) => ({
      ...prev,
      ...patch,
      kinds: { ...prev.kinds, ...(patch.kinds ?? {}) },
      kindHoldSeconds: { ...prev.kindHoldSeconds, ...(patch.kindHoldSeconds ?? {}) },
      quakeHoldSeconds: { ...prev.quakeHoldSeconds, ...(patch.quakeHoldSeconds ?? {}) },
      stormHoldSeconds: { ...prev.stormHoldSeconds, ...(patch.stormHoldSeconds ?? {}) },
    }));
    void patchDirectorConfig(sceneId, patch).then(setConfig);
  };

  return { config, ready, update };
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
