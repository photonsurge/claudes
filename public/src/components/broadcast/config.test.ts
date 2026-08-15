import { accentBorder, getBroadcastTheme, BROADCAST_THEMES } from "./config";

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
