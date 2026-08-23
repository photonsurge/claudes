/**
 * Idle camera motion — the per-channel "keep the camera slightly moving" drift
 * for shots parked on a location. The math must start perfectly still, breathe
 * IN only (never wider than the operator's framing), stay inside the on-screen
 * orbit cap, and yield to every other deterministic camera motion.
 */
import { DEFAULT_CONTROL_STATE } from "@photonsurge/shared/control";
import { orbitAmpCap } from "./orbit-frame";
import {
  idleBreatheActive,
  idleBreatheZoom,
  idleMotionActive,
  idleMotionOffsets,
  idleOrbitActive,
} from "./idle-motion";

const on = {
  ...DEFAULT_CONTROL_STATE,
  idleMotion: true,
  idleOrbit: 3,
  idleBreathe: 0.25,
  idlePeriodS: 60,
};

describe("idleMotionActive", () => {
  it("is on only when the channel opts in and something is set to move", () => {
    expect(idleMotionActive(on)).toBe(true);
    expect(idleMotionActive({ ...on, idleMotion: false })).toBe(false);
    expect(idleMotionActive({ ...on, idleOrbit: 0, idleBreathe: 0 })).toBe(false);
    // Orbit-only and breathe-only are both valid configurations.
    expect(idleMotionActive({ ...on, idleOrbit: 0 })).toBe(true);
    expect(idleMotionActive({ ...on, idleBreathe: 0 })).toBe(true);
  });

  it("composes with a director push-in: orbit rides along, breathe yields", () => {
    // A settled detail shot (zoomDrift push-in, no orbit) must keep circling
    // its subject — the push-in saturates ~30s into the hold and the shot
    // would otherwise go dead still. The zoom stays the push-in's alone.
    const pushing = { ...on, zoomDrift: 0.045 };
    expect(idleOrbitActive(pushing)).toBe(true);
    expect(idleBreatheActive(pushing)).toBe(false);
    expect(idleMotionActive(pushing)).toBe(true);
    // A breathe-only channel has nothing left to add under a push-in.
    expect(idleMotionActive({ ...pushing, idleOrbit: 0 })).toBe(false);
  });

  it("yields entirely to the world spin and the director's own orbit", () => {
    for (const other of [{ autoSpin: true }, { orbitDrift: 5 }]) {
      const s = { ...on, ...other };
      expect(idleOrbitActive(s)).toBe(false);
      expect(idleBreatheActive(s)).toBe(false);
      expect(idleMotionActive(s)).toBe(false);
    }
  });
});

describe("idleBreatheZoom", () => {
  it("starts at rest, peaks at half-cycle, and returns to the anchor", () => {
    expect(idleBreatheZoom(0.25, 60, 0)).toBe(0);
    expect(idleBreatheZoom(0.25, 60, 30)).toBeCloseTo(0.25, 10);
    expect(idleBreatheZoom(0.25, 60, 60)).toBeCloseTo(0, 10);
  });

  it("never zooms wider than the anchor framing (offset is always ≥ 0)", () => {
    for (let ot = 0; ot <= 120; ot += 1) {
      expect(idleBreatheZoom(0.25, 60, ot)).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("idleMotionOffsets", () => {
  const anchor = { zoom: 4.5, lat: 40 };

  it("is exactly the anchor at ot = 0 (the hold begins still)", () => {
    expect(idleMotionOffsets(on, 0, anchor)).toEqual({ dLng: 0, dLat: 0, dZoom: 0 });
  });

  it("eases the orbit out from the anchor instead of popping sideways", () => {
    const early = idleMotionOffsets(on, 0.5, anchor);
    const late = idleMotionOffsets(on, 200.25, anchor); // ease long since saturated
    expect(Math.hypot(early.dLng, early.dLat)).toBeLessThan(0.3);
    expect(Math.hypot(late.dLng, late.dLat)).toBeGreaterThan(Math.hypot(early.dLng, early.dLat));
  });

  it("keeps the orbit pan inside the on-screen cap at the LIVE (breathed) zoom", () => {
    const tight = { ...on, idleOrbit: 30 }; // ask for far more than fits
    for (let ot = 1; ot < 240; ot += 7) {
      const o = idleMotionOffsets(tight, ot, anchor);
      // dLat carries the raw amplitude (dLng is stretched by 1/cos(lat)).
      expect(Math.abs(o.dLat)).toBeLessThanOrEqual(orbitAmpCap(anchor.zoom) + 1e-9);
    }
  });

  it("stretches the lng leg at high latitude so the circle reads round", () => {
    // Same phase, higher latitude → bigger dLng for the same amplitude.
    const mid = idleMotionOffsets(on, 60, { zoom: 4.5, lat: 0 });
    const high = idleMotionOffsets(on, 60, { zoom: 4.5, lat: 65 });
    expect(Math.abs(high.dLng)).toBeGreaterThan(Math.abs(mid.dLng));
  });

  it("breathes without orbiting when the orbit amount is zero", () => {
    const o = idleMotionOffsets({ ...on, idleOrbit: 0 }, 30, anchor);
    expect(o.dLng).toBe(0);
    expect(o.dLat).toBe(0);
    expect(o.dZoom).toBeCloseTo(0.25, 10);
  });
});
