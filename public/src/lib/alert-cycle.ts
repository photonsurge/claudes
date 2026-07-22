"use client";

/**
 * The on-globe alert cycle: while a shot holds, light ONE hazard type at a time
 * (wind → rain → snow …) instead of drawing every warning at once.
 *
 * Why this exists: the worker dissolves alert blobs per hazard+severity, so a
 * country under four kinds of warning yields four shapes over the SAME ground —
 * and `layers/alerts.ts` paints each in four passes (halo, glow, fill, lit edge).
 * Stacked, sixteen additive passes mix into a grey-purple slab that hides the
 * weather map underneath and tells the viewer nothing about what the warnings
 * actually are. Giving each type its own beat reads cleanly AND says more: the
 * chrome can name and count the type currently lit.
 *
 * The step index is derived deterministically from the cut's `spinEpoch` — the
 * same trick `useMapStep` uses for the map-type tour (see lib/director.ts) — so
 * /watch, /control and every OBS scene switch in lockstep with no extra socket
 * traffic.
 *
 * Deliberately inert (returns null → everything draws lit, exactly as before)
 * when: the operator's kill-switch is off, alerts aren't shown, or fewer than
 * two hazard types are in frame. There's nothing to cycle through with one type,
 * and blinking a lone hazard on and off would be pure noise.
 */

import { useEffect, useMemo, useState } from "react";
import type { Segment } from "@photonsurge/shared/director";
import type { AlertFeature } from "./alerts";
import type { HazardType } from "./hazard";
import { scopeAlertsToBbox } from "./broadcast";
import { bboxForCamera } from "./history-client";

/** Fallback dwell per hazard step when no director config is available (a manual
 *  /control shot). Matches the map-type tour's beat — see GLOBAL_MAP_CYCLE_MS. */
export const ALERT_CYCLE_MS = 6000;

/**
 * Cross-fade at each step boundary: the outgoing type dims to ghost while the
 * incoming one lights up, so nothing pops.
 *
 * QUANTISED on purpose. Every distinct `fade` value re-uploads deck's colour
 * attributes for the whole alert overlay; 6 uploads per 6s step is nothing,
 * where a per-frame ramp would be 60/s over thousands of polygons. Positions
 * never change, so this never re-tessellates.
 */
const FADE_MS = 500;
const FADE_STEPS = 6;

/** How often the step/fade is re-derived. Fine enough to see the fade increments
 *  (~83ms apart); the hook only re-renders when the derived value changes. */
const TICK_MS = 100;

/** What the globe needs to draw the cycle — see `litWeight`. */
export interface AlertFocus {
  /** The hazard type currently lit. */
  hazard: HazardType;
  /** The type it is fading out of, if a boundary cross-fade is in progress. */
  prevHazard: HazardType | null;
  /** 0→1 ramp into `hazard` (1 = settled). */
  fade: number;
  /**
   * A hazard that stays fully lit for the whole shot regardless of the step —
   * the on-air subject of a `storm` cut. The director framed this exact warning;
   * ghosting it mid-shot would hide the thing being talked about.
   */
  pinned: HazardType | null;
}

/** The current step, plus what the chrome needs to name it. */
export interface AlertStep extends AlertFocus {
  index: number;
  total: number;
  /** Drawn shapes of this hazard in frame. */
  count: number;
  /** Summed population under this hazard's shapes in frame (0 when unknown). */
  people: number;
}

/**
 * How lit a hazard is, 0 (ghost) → 1 (full glow). The pinned subject is always
 * 1; the current and outgoing types cross-fade; everything else ghosts.
 * Shared with `layers/alerts.ts` so the map and any chrome agree.
 */
export function litWeight(focus: AlertFocus | null, hazard: HazardType): number {
  if (!focus) return 1;
  if (focus.pinned && hazard === focus.pinned) return 1;
  if (hazard === focus.hazard) return focus.fade;
  if (focus.prevHazard && hazard === focus.prevHazard) return 1 - focus.fade;
  return 0;
}

/** A stable key for deck `updateTriggers` — every field that changes the paint. */
export function alertFocusKey(focus: AlertFocus | null): string {
  return focus ? `${focus.hazard}|${focus.prevHazard ?? ""}|${focus.fade}|${focus.pinned ?? ""}` : "";
}

/**
 * Hazard types present, worst-severity first (then busiest, then id for a stable
 * tie-break) — so the most serious hazard leads both the cycle and the map key.
 * Shared with AlertLegend, which used to compute this inline.
 */
export function hazardsInView(alerts: AlertFeature[]): HazardType[] {
  const worst = new Map<HazardType, number>();
  const count = new Map<HazardType, number>();
  for (const f of alerts) {
    const h = f.properties.hazard;
    worst.set(h, Math.max(worst.get(h) ?? 0, f.properties.severityRank));
    count.set(h, (count.get(h) ?? 0) + 1);
  }
  return [...worst.keys()].sort(
    (a, b) =>
      (worst.get(b) ?? 0) - (worst.get(a) ?? 0) ||
      (count.get(b) ?? 0) - (count.get(a) ?? 0) ||
      a.localeCompare(b),
  );
}

/** The hazard a cut is *about*, or null — only a storm shot frames one warning. */
function pinnedHazard(cut: Segment | null | undefined): HazardType | null {
  return cut?.kind === "storm" ? cut.hazard ?? null : null;
}

export function useAlertHazardStep({
  alerts,
  enabled,
  camera,
  spinning,
  cut,
  dwellMs = ALERT_CYCLE_MS,
}: {
  /** The features actually drawn (already severity/hazard filtered). */
  alerts: AlertFeature[];
  /** `showAlerts && alertCycle` — the operator's kill-switch. */
  enabled: boolean;
  camera: { center: [number, number]; zoom: number } | null;
  /**
   * True on a spinning shot (`autoSpin`). A drifting camera would reshuffle the
   * in-frame hazard list mid-cycle, so a spin cycles the WHOLE set instead of
   * what happens to be facing us this second.
   */
  spinning: boolean;
  /** The on-air segment — supplies the epoch clock and the pinned subject. */
  cut: Segment | null | undefined;
  dwellMs?: number;
}): AlertStep | null {
  const pinned = pinnedHazard(cut);

  // What's in frame. Framed shots scope by the camera box (the alert feed is
  // global — a country spotlight must not cycle Chile's warnings); spins take
  // the lot. Same bbox helper the "IN VIEW" rollups use, so they agree.
  const inView = useMemo(() => {
    if (!enabled || alerts.length === 0) return [];
    if (spinning || !camera) return alerts;
    return scopeAlertsToBbox(alerts, bboxForCamera(camera.center, camera.zoom));
  }, [enabled, alerts, spinning, camera?.center[0], camera?.center[1], camera?.zoom]);

  const hazards = useMemo(() => hazardsInView(inView), [inView]);
  // Order the pinned subject first: a storm shot opens on its own warning and
  // the other types take turns around it.
  const steps = useMemo(() => {
    if (hazards.length < 2) return [] as HazardType[];
    if (!pinned || !hazards.includes(pinned)) return hazards;
    return [pinned, ...hazards.filter((h) => h !== pinned)];
  }, [hazards, pinned]);

  // Key on the joined list rather than array identity: the alert poll hands us a
  // fresh array every few minutes, and restarting the cycle on that would make
  // the sequence jump for no reason.
  const stepKey = steps.join(",");
  const epoch = cut?.patch.spinEpoch ?? 0;
  const [tick, setTick] = useState(() => ({ index: 0, fade: 1 }));

  useEffect(() => {
    if (!stepKey) return;
    const total = stepKey.split(",").length;
    const pick = () => {
      const elapsed = Math.max(0, Date.now() - epoch);
      const index = Math.floor(elapsed / dwellMs) % total;
      // Quantised ramp — see FADE_STEPS. The OPENING step doesn't cross-fade:
      // there's nothing to fade out of (the whole overlay arrives with the cut),
      // and ramping would light the previous — never-shown — type for half a
      // second at the top of every shot.
      const first = Math.floor(elapsed / dwellMs) === 0;
      const raw = first ? 1 : Math.min(1, (elapsed % dwellMs) / FADE_MS);
      const fade = Math.round(raw * FADE_STEPS) / FADE_STEPS;
      setTick((prev) => (prev.index === index && prev.fade === fade ? prev : { index, fade }));
    };
    pick();
    const t = setInterval(pick, TICK_MS);
    return () => clearInterval(t);
  }, [stepKey, epoch, dwellMs]);

  return useMemo(() => {
    if (!stepKey) return null;
    const list = stepKey.split(",") as HazardType[];
    const index = tick.index % list.length;
    const hazard = list[index];
    if (!hazard) return null;
    const prevHazard = tick.fade >= 1 ? null : list[(index - 1 + list.length) % list.length] ?? null;
    let count = 0;
    let people = 0;
    for (const f of inView) {
      if (f.properties.hazard !== hazard) continue;
      count += 1;
      people += f.properties.population ?? 0;
    }
    return { hazard, prevHazard, fade: tick.fade, pinned, index, total: list.length, count, people };
  }, [stepKey, tick, inView, pinned]);
}
