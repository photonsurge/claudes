import { DIRECTOR_PRESETS } from "./director-presets";
import { DEFAULT_DIRECTOR_CONFIG, mergeDirectorConfig, SEGMENT_KINDS } from "./director";
import { COUNTRY_SHOTS } from "./director-countries";
import { REGION_SHOTS } from "./director-regions";

describe("DIRECTOR_PRESETS", () => {
  const countryIds = new Set(COUNTRY_SHOTS.map((c) => c.id));
  const regionIds = new Set(REGION_SHOTS.map((r) => r.id));

  it("every preset references only real catalog ids — nothing silently dropped by the merge", () => {
    for (const p of DIRECTOR_PRESETS) {
      for (const id of p.patch.countries ?? []) expect(countryIds.has(id)).toBe(true);
      for (const id of p.patch.regions ?? []) expect(regionIds.has(id)).toBe(true);
    }
  });

  it("presets touch content fields only — never mode, holds or looks", () => {
    const allowed = new Set(["kinds", "kindWeights", "countries", "regions"]);
    for (const p of DIRECTOR_PRESETS) {
      for (const key of Object.keys(p.patch)) expect(allowed.has(key)).toBe(true);
    }
  });

  it("every preset states a COMPLETE kinds record (full replace, never a layered partial)", () => {
    for (const p of DIRECTOR_PRESETS) {
      for (const k of SEGMENT_KINDS) expect(typeof p.patch.kinds?.[k]).toBe("boolean");
      // The intro opener stays on, the sandbox-only point kind stays off.
      expect(p.patch.kinds?.intro).toBe(true);
      expect(p.patch.kinds?.point).toBe(false);
    }
  });

  it("every preset survives mergeDirectorConfig unchanged (already-sanitized values)", () => {
    for (const p of DIRECTOR_PRESETS) {
      const merged = mergeDirectorConfig(DEFAULT_DIRECTOR_CONFIG, p.patch);
      if (p.patch.countries) expect(merged.countries).toEqual(p.patch.countries);
      if (p.patch.regions) expect(merged.regions).toEqual(p.patch.regions);
      if (p.patch.kindWeights) expect(merged.kindWeights).toEqual(p.patch.kindWeights);
    }
  });
});
