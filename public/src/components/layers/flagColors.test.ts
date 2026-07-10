import { COUNTRY_SHOTS } from "@photonsurge/shared/director-countries";
import { FLAG_COLORS, flagPaletteFor } from "./flagColors";

describe("flagPaletteFor", () => {
  it("returns rgb tuples for a known ISO2", () => {
    const gb = flagPaletteFor("GB");
    expect(gb).toEqual([
      [200, 16, 46],
      [255, 255, 255],
      [1, 33, 105],
    ]);
  });

  it("is case-insensitive", () => {
    expect(flagPaletteFor("jp")).toEqual(flagPaletteFor("JP"));
  });

  it("is null for an ISO2 we have no palette for", () => {
    expect(flagPaletteFor("ZZ")).toBeNull();
    expect(flagPaletteFor(null)).toBeNull();
    expect(flagPaletteFor(undefined)).toBeNull();
  });

  it("covers every country in the director spotlight catalog", () => {
    // A catalog country with no palette would silently fall back to white on
    // air — assert we never drop one.
    const missing = COUNTRY_SHOTS.filter((c) => !FLAG_COLORS[c.iso2]);
    expect(missing.map((c) => `${c.name} (${c.iso2})`)).toEqual([]);
  });

  it("only lists valid #rrggbb colours", () => {
    for (const hexes of Object.values(FLAG_COLORS)) {
      expect(hexes.length).toBeGreaterThan(0);
      for (const h of hexes) expect(h).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
  });
});
