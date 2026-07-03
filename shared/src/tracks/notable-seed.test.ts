import { NOTABLE_SEED } from "./notable-seed";
import { vehicleId } from "../db/vehicle-model";

describe("NOTABLE_SEED", () => {
  it("every entry has a label, a valid kind and a wikiTitle to enrich from", () => {
    for (const s of NOTABLE_SEED) {
      expect(s.label.trim().length).toBeGreaterThan(0);
      expect(["aircraft", "ship"]).toContain(s.kind);
      expect(s.wikiTitle && s.wikiTitle.trim().length).toBeTruthy();
      expect(s.code.trim().length).toBeGreaterThan(0);
    }
  });

  it("has no duplicate catalog keys", () => {
    const keys = NOTABLE_SEED.map((s) => vehicleId(s.kind, s.code));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("uses MMSI-shaped codes for ships and 6-hex codes for aircraft", () => {
    for (const s of NOTABLE_SEED) {
      if (s.kind === "ship") expect(s.code).toMatch(/^\d{7,9}$/);
      else expect(s.code.toLowerCase()).toMatch(/^[0-9a-f]{6}$/);
    }
  });

  it("ships unverified aircraft hexes disabled so a wrong hex can't mislabel a plane", () => {
    // Ships broadcast a stable MMSI (enabled); military aircraft hexes are
    // unreliable, so aircraft seed entries stay disabled until confirmed.
    for (const s of NOTABLE_SEED) {
      if (s.kind === "aircraft") expect(s.enabled).toBe(false);
    }
  });
});
