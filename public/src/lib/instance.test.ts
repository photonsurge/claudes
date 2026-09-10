/**
 * The instance badge — worth pinning because the whole point is that the SAME
 * image behaves differently on two boxes. The zero-config path (TAG alone) is
 * the one that actually runs in production, so it gets the most attention: if
 * it ever regressed to "everything is live", the tint would stop being a
 * warning and start being wallpaper.
 */
import {
  BASE_PAGE,
  INSTANCE_COLOR,
  INSTANCE_LABEL,
  instanceFromTag,
  instanceVars,
  mixHex,
  normalizeHex,
  resolveInstance,
} from "./instance";

describe("instanceFromTag", () => {
  it("calls an untagged stack local — nobody deployed this", () => {
    expect(instanceFromTag(undefined)).toBe("local");
    expect(instanceFromTag("")).toBe("local");
    expect(instanceFromTag("   ")).toBe("local");
  });

  it("maps the test box's tag", () => {
    expect(instanceFromTag("test")).toBe("test");
    expect(instanceFromTag(" TEST ")).toBe("test");
  });

  it("treats :latest AND a pinned version tag as a real deployment", () => {
    // ./deployLive TAG=1.4.2 rolls live to a version tag — still live.
    expect(instanceFromTag("latest")).toBe("live");
    expect(instanceFromTag("1.4.2")).toBe("live");
  });
});

describe("resolveInstance", () => {
  it("derives the three deployments from TAG with no other config", () => {
    expect(resolveInstance({})).toMatchObject({ id: "local", label: "LOCAL", color: INSTANCE_COLOR.local });
    expect(resolveInstance({ TAG: "test" })).toMatchObject({ id: "test", label: "TEST" });
    expect(resolveInstance({ TAG: "latest" })).toMatchObject({ id: "live", label: "LIVE" });
  });

  it("gives each deployment its own colour", () => {
    const colors = ["", "test", "latest"].map((TAG) => resolveInstance({ TAG })!.color);
    expect(new Set(colors).size).toBe(3);
  });

  it("lets the host env override the guess", () => {
    expect(resolveInstance({ TAG: "latest", INSTANCE_ID: "test" })!.id).toBe("test");
    expect(resolveInstance({ INSTANCE_LABEL: "STAGING" })!.label).toBe("STAGING");
    expect(resolveInstance({ INSTANCE_COLOR: "#0f0" })!.color).toBe("#00ff00");
  });

  it("ignores an unknown INSTANCE_ID and falls back to TAG", () => {
    expect(resolveInstance({ TAG: "test", INSTANCE_ID: "banana" })!.id).toBe("test");
  });

  it("ignores a malformed colour rather than emitting it into a style attribute", () => {
    expect(resolveInstance({ INSTANCE_COLOR: "red; background: url(x)" })!.color).toBe(INSTANCE_COLOR.local);
  });

  it("switches the chrome off on request", () => {
    expect(resolveInstance({ INSTANCE_ID: "off" })).toBeNull();
    expect(resolveInstance({ INSTANCE_ID: "none", TAG: "latest" })).toBeNull();
  });

  it("bounds a label so it can't stretch the chrome", () => {
    expect(resolveInstance({ INSTANCE_LABEL: "x".repeat(80) })!.label).toHaveLength(16);
  });

  it("defaults the label per id", () => {
    expect(resolveInstance({ TAG: "test", INSTANCE_LABEL: "  " })!.label).toBe(INSTANCE_LABEL.test);
  });
});

describe("normalizeHex", () => {
  it("expands shorthand and lowercases", () => {
    expect(normalizeHex("#ABC")).toBe("#aabbcc");
    expect(normalizeHex(" #A1B2C3 ")).toBe("#a1b2c3");
  });

  it("rejects anything that isn't a plain hex colour", () => {
    for (const bad of ["", "abc", "#12", "rgb(1,2,3)", "#12345g", null, undefined]) {
      expect(normalizeHex(bad)).toBeNull();
    }
  });
});

describe("mixHex", () => {
  it("returns the ends of the blend untouched", () => {
    expect(mixHex("#000000", "#ffffff", 0)).toBe("#000000");
    expect(mixHex("#000000", "#ffffff", 100)).toBe("#ffffff");
  });

  it("blends per channel", () => {
    expect(mixHex("#000000", "#ffffff", 50)).toBe("#808080");
    expect(mixHex("#204060", "#ffffff", 50)).toBe("#90a0b0");
  });

  it("clamps out-of-range percentages", () => {
    expect(mixHex("#000000", "#ffffff", -20)).toBe("#000000");
    expect(mixHex("#000000", "#ffffff", 400)).toBe("#ffffff");
  });

  it("passes the base through when either side isn't a colour", () => {
    expect(mixHex("#0a0e16", "not-a-colour", 50)).toBe("#0a0e16");
  });
});

describe("instanceVars", () => {
  it("emits nothing when the chrome is off, so call-site fallbacks win", () => {
    expect(instanceVars(null)).toEqual({});
  });

  it("tints the page away from the untinted ground", () => {
    const vars = instanceVars({ id: "live", label: "LIVE", color: INSTANCE_COLOR.live })!;
    expect(vars["--inst-color"]).toBe(INSTANCE_COLOR.live);
    expect(vars["--inst-page"]).not.toBe(BASE_PAGE);
    // Still a dark ground — the console has to stay readable.
    const r = parseInt(vars["--inst-page"].slice(1, 3), 16);
    expect(r).toBeLessThan(0x50);
  });

  it("gives the three deployments visibly different page grounds", () => {
    const pages = (["local", "test", "live"] as const).map(
      (id) => instanceVars({ id, label: id, color: INSTANCE_COLOR[id] })["--inst-page"],
    );
    expect(new Set(pages).size).toBe(3);
  });
});
