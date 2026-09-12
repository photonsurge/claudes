/**
 * A pointer gesture must beat a deterministic camera motion — the /sandbox
 * "globe won't move" bug. See camera-grab.ts.
 */
import { DEFAULT_CONTROL_STATE, type ControlState } from "@photonsurge/shared/control";
import {
  cameraMotionActive,
  isUserGesture,
  releaseCameraMotion,
  type CameraMotionState,
} from "./camera-grab";

const motion = (over: Partial<CameraMotionState> = {}): CameraMotionState => ({
  autoSpin: false,
  zoomDrift: 0,
  orbitDrift: 0,
  idleMotion: false,
  idleOrbit: 3,
  idleBreathe: 0.25,
  idlePeriodS: 60,
  ...over,
});

const control = (over: Partial<ControlState> = {}): ControlState => ({
  ...DEFAULT_CONTROL_STATE,
  ...over,
});

describe("cameraMotionActive", () => {
  it("is false for a parked camera", () => {
    expect(cameraMotionActive(motion())).toBe(false);
  });

  it("catches each way the camera can be driven", () => {
    expect(cameraMotionActive(motion({ autoSpin: true }))).toBe(true);
    expect(cameraMotionActive(motion({ zoomDrift: 0.045 }))).toBe(true);
    expect(cameraMotionActive(motion({ orbitDrift: 5 }))).toBe(true);
    expect(cameraMotionActive(motion({ idleMotion: true }))).toBe(true);
  });

  it("ignores idle motion whose amounts are both zero", () => {
    expect(cameraMotionActive(motion({ idleMotion: true, idleOrbit: 0, idleBreathe: 0 }))).toBe(false);
  });
});

describe("isUserGesture", () => {
  it("is true for a drag, a pan, a zoom and a rotate", () => {
    expect(isUserGesture({ isDragging: true })).toBe(true);
    expect(isUserGesture({ isPanning: true })).toBe(true);
    expect(isUserGesture({ isZooming: true })).toBe(true);
    expect(isUserGesture({ isRotating: true })).toBe(true);
  });

  it("is false for the motion loop's own echo (no interaction state)", () => {
    expect(isUserGesture(undefined)).toBe(false);
    expect(isUserGesture(null)).toBe(false);
    expect(isUserGesture({})).toBe(false);
  });

  it("is false mid-flight, so a director cut's fly-in never cancels its own spin", () => {
    expect(isUserGesture({ inTransition: true, isPanning: true })).toBe(false);
  });
});

describe("releaseCameraMotion", () => {
  it("clears every motion field so the loop cannot overwrite the drag", () => {
    const next = releaseCameraMotion(
      control({ autoSpin: true, zoomDrift: 0.045, orbitDrift: 5, idleMotion: true }),
    );
    expect(cameraMotionActive(next)).toBe(false);
    expect(next.autoSpin).toBe(false);
    expect(next.zoomDrift).toBe(0);
    expect(next.orbitDrift).toBe(0);
    expect(next.idleMotion).toBe(false);
  });

  it("keeps the channel's configured idle amounts for when it is switched back on", () => {
    const next = releaseCameraMotion(control({ idleMotion: true, idleOrbit: 7, idleBreathe: 0.5 }));
    expect(next.idleOrbit).toBe(7);
    expect(next.idleBreathe).toBe(0.5);
  });

  it("returns the same object when nothing was armed, so React skips the re-render", () => {
    const parked = control();
    expect(releaseCameraMotion(parked)).toBe(parked);
  });

  it("leaves the rest of the control state untouched", () => {
    const before = control({ autoSpin: true, showAlerts: true, activeVariable: "temp" });
    const after = releaseCameraMotion(before);
    expect(after.showAlerts).toBe(true);
    expect(after.activeVariable).toBe("temp");
  });
});
