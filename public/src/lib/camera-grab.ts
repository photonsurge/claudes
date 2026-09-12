/**
 * Who owns the camera on an INTERACTIVE globe.
 *
 * Globe.tsx drives two camera sources. A deterministic motion loop (the world
 * spin, a director push-in / orbit, or the channel's idle drift) recomputes the
 * view every frame from `camera.center` + `spinEpoch`, and deck's controller
 * turns pointer gestures into view states. They cannot both win, so while a
 * motion is armed the globe ignores `onViewStateChange` — otherwise every
 * loop-driven frame would feed back into React and re-render/persist at 60 Hz.
 *
 * That gate used to swallow the operator's own drags too: /sandbox cold-starts
 * from the live scene, which normally carries `autoSpin` or the channel's
 * `idleMotion`, so the globe arrived already motion-owned and every drag was
 * discarded — a globe that looks nearly still and refuses to be moved. The
 * ControlPanel exposes Auto-spin and "Keep moving" but nothing for the
 * director's `zoomDrift`/`orbitDrift`, so there wasn't always a way out.
 *
 * The rule here: a real pointer gesture beats a deterministic motion. The page
 * clears the motion fields (`releaseCameraMotion`), which is also what the
 * operator sees — the Auto-spin / Keep moving toggles flip off, exactly as they
 * already do when a search fly-to takes the camera. See [[camera-tick-functional-merge]].
 */
import type { ControlState } from "@photonsurge/shared/control";
import { idleMotionActive, type IdleMotionState } from "./idle-motion";

/** The slice of deck's `interactionState` this module reads. */
export interface DeckInteractionState {
  isDragging?: boolean;
  isPanning?: boolean;
  isZooming?: boolean;
  isRotating?: boolean;
  inTransition?: boolean;
}

/** The ControlState fields that arm a deterministic camera motion. */
export type CameraMotionState = IdleMotionState;

/**
 * True when a deterministic motion owns the camera. The single definition of
 * the condition the motion loop runs on and the view-state gate checks — they
 * disagreed before (the gate treated `autoSpin` as motion even at `spinSpeed`
 * 0, where the loop does nothing, leaving a still globe that refused drags).
 */
export function cameraMotionActive(state: CameraMotionState): boolean {
  return !!state.autoSpin || !!state.zoomDrift || !!state.orbitDrift || idleMotionActive(state);
}

/**
 * True when deck is reporting a live POINTER gesture — a drag/pan, a wheel or
 * pinch zoom, a rotate. Explicitly NOT `inTransition`: a flyTo/fitBounds is the
 * globe moving itself, and treating that as a grab would cancel the very spin a
 * director cut just armed. A frame with no interaction state at all (the motion
 * loop's own `setProps` echo) is not a gesture either.
 */
export function isUserGesture(s: DeckInteractionState | null | undefined): boolean {
  if (!s || s.inTransition) return false;
  return !!(s.isDragging || s.isPanning || s.isZooming || s.isRotating);
}

/**
 * Hand the camera to the operator: every deterministic motion off, so the next
 * frame of the motion loop can't overwrite the drag. Returns the SAME object
 * when nothing was armed, so a page can call this on every gesture and React
 * still bails out of the re-render.
 *
 * `idleOrbit`/`idleBreathe`/`idlePeriodS` are left alone — they are the
 * channel's configured amounts (edited on /admin/scenes/:id), not the switch.
 * Clearing `idleMotion` is enough to park the drift and keeps the amounts for
 * when it's switched back on.
 */
export function releaseCameraMotion<T extends ControlState>(state: T): T {
  if (!cameraMotionActive(state)) return state;
  return { ...state, autoSpin: false, zoomDrift: 0, orbitDrift: 0, idleMotion: false };
}
