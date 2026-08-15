// The simple-scene catalog feeds a Mongo seed — a typo here becomes a broken
// 24/7 broadcast, so validate the presets against the real registries.

import { SIMPLE_SCENE_PRESETS } from "./simple-scenes";
import { BASEMAPS } from "./basemaps";
import { DEFAULT_CONTROL_STATE, mergeControlState } from "./control";

describe("SIMPLE_SCENE_PRESETS", () => {
  it("has three distinct scenes with distinct slots", () => {
    expect(SIMPLE_SCENE_PRESETS).toHaveLength(3);
    expect(new Set(SIMPLE_SCENE_PRESETS.map((p) => p.id)).size).toBe(3);
    expect(new Set(SIMPLE_SCENE_PRESETS.map((p) => p.slotId)).size).toBe(3);
  });

  it("only references registered basemaps", () => {
    const known = new Set(BASEMAPS.map((b) => b.id));
    for (const p of SIMPLE_SCENE_PRESETS) {
      expect(known).toContain(p.seed.basemap);
    }
  });

  it("survives the ControlState merge without losing its look", () => {
    // The seed lands via {...DEFAULT_CONTROL_STATE, ...seed} and later travels
    // through mergeControlState — both must preserve what makes each scene ITS look.
    for (const p of SIMPLE_SCENE_PRESETS) {
      const merged = mergeControlState(DEFAULT_CONTROL_STATE, p.seed);
      expect(merged.autoSpin).toBe(true);
      expect(merged.basemap).toBe(p.seed.basemap);
      expect(merged.activeVariable).toBe(p.seed.activeVariable ?? null);
      expect(merged.showBroadcastChrome).toBe(true);
      expect(merged.audio.enabled).toBe(true);
    }
  });

  it("keeps each scene a SINGLE readable subject", () => {
    const byId = Object.fromEntries(SIMPLE_SCENE_PRESETS.map((p) => [p.id, p.seed]));
    // Temperature: scalar on, particles off.
    expect(byId["simple-temp"]).toMatchObject({ activeVariable: "temp", showWind: false });
    // Wind: particles + pressure, no scalar wash underneath.
    expect(byId["simple-wind"]).toMatchObject({ activeVariable: null, showWind: true, showPressure: true });
    // Clouds: imagery + satellite mosaic + day/night, no data layers.
    expect(byId["simple-clouds"]).toMatchObject({ basemap: "satellite", showSatImg: true, showDayNight: true, showWind: false });
  });
});
