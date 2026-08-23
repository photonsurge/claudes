/**
 * Per-channel IDLE camera motion — the slight drift that keeps a camera parked
 * on a location alive: a slow orbit round the anchor and/or a gentle zoom
 * "breathe" in and back out (never wider than the anchor framing).
 *
 * Pure math, deterministic in `ot` (seconds since the anchor's spinEpoch, minus
 * any cut-flight time) exactly like the director's spin/orbit/push-in, so
 * /control and /watch trace the same path with zero per-frame traffic. Globe.tsx
 * applies the full offsets in its motion loop; ViewingOverlay reuses the zoom
 * part for its readout.
 */
import type { ControlState } from "@photonsurge/shared/control";
import { orbitAmpCap } from "./orbit-frame";

/** Seconds over which the idle orbit amplitude eases out from the anchor, so
 *  toggling it on (or landing a flight) never pops the camera sideways. */
export const IDLE_EASE_S = 8;

/** The state slice the idle-motion decision + math read. */
export type IdleMotionState = Pick<
  ControlState,
  "idleMotion" | "idleOrbit" | "idleBreathe" | "idlePeriodS" | "autoSpin" | "zoomDrift" | "orbitDrift"
>;

/**
 * The two idle movements gate independently so the drift COMPOSES with a
 * director hold instead of dying under it (a detail cut's push-in saturates at
 * MAX_PUSH_IN ~30s in, and the shot would sit dead still for the rest of the
 * hold):
 *
 *  - ORBIT runs whenever nothing else moves the camera laterally — only the
 *    world spin and the director's own orbit suppress it, a push-in does not,
 *    so a settled detail shot keeps circling its subject.
 *  - BREATHE runs only when nothing else owns the zoom — a push-in is already
 *    the zoom motion, and layering a second one would fight it.
 */
export function idleOrbitActive(state: IdleMotionState): boolean {
  return !!state.idleMotion && !state.autoSpin && !state.orbitDrift && state.idleOrbit > 0;
}

export function idleBreatheActive(state: IdleMotionState): boolean {
  return (
    !!state.idleMotion &&
    !state.autoSpin &&
    !state.zoomDrift &&
    !state.orbitDrift &&
    state.idleBreathe > 0
  );
}

/** True when idle motion contributes ANY movement (either gate open). */
export function idleMotionActive(state: IdleMotionState): boolean {
  return idleOrbitActive(state) || idleBreatheActive(state);
}

/**
 * Zoom offset of the breathe at `ot` seconds into the hold: eases IN by up to
 * `breathe` levels at half-cycle and back out to the anchor, ≥ 0 always — it
 * never zooms wider than the framing the operator chose. The raised-cosine
 * starts with zero slope, so the hold begins perfectly still and drifts awake.
 */
export function idleBreatheZoom(breathe: number, periodS: number, ot: number): number {
  if (breathe <= 0 || ot <= 0) return 0;
  return breathe * 0.5 * (1 - Math.cos((2 * Math.PI * ot) / periodS));
}

/**
 * The full idle offsets to add to the anchor at `ot` seconds into the hold.
 * The orbit reuses the director-orbit rules: pan radius capped by what stays on
 * screen at the LIVE zoom (orbitAmpCap of the breathed zoom), amplitude eased
 * out from the anchor, and the lng leg divided by cos(lat) so the circle looks
 * round at high latitude (clamped like the Globe loop's own lngScale).
 */
export function idleMotionOffsets(
  state: Pick<IdleMotionState, "idleOrbit" | "idleBreathe" | "idlePeriodS">,
  ot: number,
  anchor: { zoom: number; lat: number },
): { dLng: number; dLat: number; dZoom: number } {
  const periodS = state.idlePeriodS > 0 ? state.idlePeriodS : 60;
  const dZoom = idleBreatheZoom(state.idleBreathe, periodS, ot);
  if (state.idleOrbit <= 0 || ot <= 0) return { dLng: 0, dLat: 0, dZoom };
  const amp =
    Math.min(state.idleOrbit, orbitAmpCap(anchor.zoom + dZoom)) *
    (1 - Math.exp(-ot / IDLE_EASE_S));
  const theta = (2 * Math.PI * ot) / periodS;
  const lngScale = Math.max(Math.cos((anchor.lat * Math.PI) / 180), 0.35);
  return {
    dLng: (amp * Math.cos(theta)) / lngScale,
    dLat: amp * Math.sin(theta),
    dZoom,
  };
}
