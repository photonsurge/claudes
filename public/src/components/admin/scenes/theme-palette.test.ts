import { generateScenePalette, isHexColour, mixHex } from "./theme-palette";

describe("theme palette generator", () => {
  it("mixes colours deterministically", () => {
    expect(mixHex("#000000", "#ffffff", 0.5)).toBe("#808080");
    expect(mixHex("#123456", "#ffffff", 0)).toBe("#123456");
  });

  it("generates coordinated UI, panel, map, and locator values from two seeds", () => {
    const generated = generateScenePalette("#FF6600", "#101820");
    expect(generated).not.toBeNull();
    expect(generated?.themeOverrides).toMatchObject({
      accent: "#ff6600",
      liveColor: "#ff6600",
      mapHighlightColor: "#ff6600",
      mapCapitalColor: "#ff6600",
      minimapAccentColor: "#ff6600",
      panelBorder: expect.stringMatching(/^1px solid #[0-9a-f]{6}$/),
    });
    expect(generated?.basemapColors).toEqual({
      ocean: "#0a0f14",
      land: "#40281a",
      border: "#e7bda1",
    });
  });

  it("rejects values the native two-colour generator cannot safely derive", () => {
    expect(isHexColour("#123456")).toBe(true);
    expect(isHexColour("red")).toBe(false);
    expect(generateScenePalette("red", "#101820")).toBeNull();
  });
});
