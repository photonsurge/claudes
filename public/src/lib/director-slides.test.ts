import { slideFromLive, controlPatchFromSlide, slideIsLive } from "./director-slides";
import { DEFAULT_CONTROL_STATE } from "@photonsurge/shared/control";
import { OVERLAY_KEYS } from "@photonsurge/shared/director-rois";
import type { ControlState } from "@photonsurge/shared/control";
import type { KindSlide } from "@photonsurge/shared/director";

const slideOf = (look: KindSlide["look"], overlays: KindSlide["overlays"] = {}): KindSlide => ({
  id: "s1",
  name: "Slide",
  look,
  overlays,
});

describe("slideFromLive", () => {
  it("snapshots the live look plus every toggleable overlay", () => {
    const live: ControlState = {
      ...DEFAULT_CONTROL_STATE,
      basemap: "satellite",
      showSatImg: true,
      activeVariable: "rain",
    };
    const snap = slideFromLive(live);

    expect(snap.look.basemap).toBe("satellite");
    expect(snap.look.showSatImg).toBe(true);
    expect(snap.look.activeVariable).toBe("rain");
    // Captures the FULL overlay set (on and off), not just what's currently on.
    expect(Object.keys(snap.overlays).sort()).toEqual([...OVERLAY_KEYS].sort());
    for (const k of OVERLAY_KEYS) expect(typeof snap.overlays[k]).toBe("boolean");
  });

  it("deep-copies wind so later live edits don't mutate the saved slide", () => {
    const live: ControlState = { ...DEFAULT_CONTROL_STATE };
    const snap = slideFromLive(live);
    expect(snap.look.wind).toEqual(live.wind);
    expect(snap.look.wind).not.toBe(live.wind); // distinct reference
  });
});

describe("controlPatchFromSlide", () => {
  it("only patches the fields the look actually sets (undefined = not touched)", () => {
    const live: ControlState = { ...DEFAULT_CONTROL_STATE };
    const patch = controlPatchFromSlide(slideOf({ basemap: "satellite" }), live);
    expect(patch.basemap).toBe("satellite");
    expect(patch.activeVariable).toBeUndefined();
    expect(patch.wind).toBeUndefined();
  });

  it("merges the slide's wind over the live wind rather than replacing it", () => {
    const live: ControlState = { ...DEFAULT_CONTROL_STATE };
    const patch = controlPatchFromSlide(slideOf({ wind: { opacity: 0.15 } }), live);
    expect(patch.wind).toEqual({ ...live.wind, opacity: 0.15 });
  });
});

describe("slideIsLive", () => {
  it("is true for a slide snapshotted straight from the live state", () => {
    const live: ControlState = { ...DEFAULT_CONTROL_STATE, basemap: "dark", activeVariable: "temp" };
    const slide: KindSlide = { id: "s", name: "n", ...slideFromLive(live) };
    expect(slideIsLive(slide, live)).toBe(true);
  });

  it("turns false once the live look drifts from the slide", () => {
    const live: ControlState = { ...DEFAULT_CONTROL_STATE, basemap: "dark" };
    const slide: KindSlide = { id: "s", name: "n", ...slideFromLive(live) };
    expect(slideIsLive(slide, { ...live, basemap: "satellite" })).toBe(false);
  });

  it("turns false when an overlay is toggled after the snapshot", () => {
    const overlayKey = OVERLAY_KEYS[0] as keyof ControlState;
    const live = { ...DEFAULT_CONTROL_STATE, [overlayKey]: false } as ControlState;
    const slide: KindSlide = { id: "s", name: "n", ...slideFromLive(live) };
    const drifted = { ...live, [overlayKey]: true } as ControlState;
    expect(slideIsLive(slide, drifted)).toBe(false);
  });
});
