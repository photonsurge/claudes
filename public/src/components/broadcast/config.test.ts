import { THEME_OVERRIDE_KEYS } from "@photonsurge/shared/control";
import { accentBorder, broadcastThemeCssVars, getBroadcastTheme, BASE_LOOK, BROADCAST_THEMES } from "./config";

describe("getBroadcastTheme", () => {
  it("resolves a preset id, falling back to the default", () => {
    expect(getBroadcastTheme("storm").name).toBe(BROADCAST_THEMES.storm.name);
    expect(getBroadcastTheme("nope")).toEqual(getBroadcastTheme("command"));
  });

  it("layers non-empty overrides over the base preset", () => {
    const t = getBroadcastTheme("command", { name: "ATLANTIC WIND", accent: "#00d0ff" });
    expect(t.name).toBe("ATLANTIC WIND");
    expect(t.accent).toBe("#00d0ff");
    // Untouched fields still come from the base preset.
    expect(t.tickerTitle).toBe(BROADCAST_THEMES.command.tickerTitle);
  });

  it("treats empty/whitespace override fields as 'use the preset'", () => {
    const t = getBroadcastTheme("command", { name: "", tagline: "   " });
    expect(t.name).toBe(BROADCAST_THEMES.command.name);
    expect(t.tagline).toBe(BROADCAST_THEMES.command.tagline);
  });

  it("layers the ink tokens like any other field", () => {
    const t = getBroadcastTheme("command", {
      titleColor: "#ffffff",
      tickerBg: "red",
      godsPanelMidColor: "#123456",
      tileColor: "#112233",
      mapHighlightColor: "#abcdef",
      minimapLandColor: "#abcdef",
    });
    expect(t.titleColor).toBe("#ffffff");
    expect(t.tickerBg).toBe("red");
    expect(t.godsPanelMidColor).toBe("#123456");
    expect(t.tileColor).toBe("#112233");
    expect(t.mapHighlightColor).toBe("#abcdef");
    expect(t.minimapLandColor).toBe("#abcdef");
    // An untouched token still comes from the preset's BASE_LOOK.
    expect(t.liveColor).toBe(BASE_LOOK.liveColor);
  });

  it("every preset carries every overridable token (BASE_LOOK spread not forgotten)", () => {
    for (const theme of Object.values(BROADCAST_THEMES)) {
      for (const key of THEME_OVERRIDE_KEYS) {
        if (key === "strapline") continue; // the one optional identity field
        expect(typeof theme[key]).toBe("string");
      }
    }
  });
});

describe("broadcastThemeCssVars", () => {
  it("publishes the resolved panel, tile, and ink palette for nested chrome", () => {
    const theme = getBroadcastTheme("command", { textColor: "#010203", tileColor: "#112233" });
    expect(broadcastThemeCssVars(theme)).toMatchObject({
      "--gods-text": "#010203",
      "--gods-tile": "#112233",
      "--gods-border": theme.godsBorderColor,
    });
  });
});

describe("accentBorder", () => {
  it("expands to per-side props with the accent stripe on the left", () => {
    expect(accentBorder("1px solid #333", "3px solid #f00")).toEqual({
      borderTop: "1px solid #333",
      borderRight: "1px solid #333",
      borderBottom: "1px solid #333",
      borderLeft: "3px solid #f00",
    });
  });

  it("never emits the `border` shorthand (React forbids mixing it with borderLeft)", () => {
    expect(Object.keys(accentBorder("a", "b"))).not.toContain("border");
  });
});
