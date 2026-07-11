import { buildFocusKey, normalizeFocus } from "./focusKey";
import type { FocusRequest } from "./types";

const base: FocusRequest = {
  kind: "quake",
  center: [12.3456, 56.7891],
  zoom: 4.55,
  detail: "broadcast",
  subject: "us7000abcd",
};

describe("focusKey", () => {
  it("rounds lng/lat to 2dp and zoom to 1dp", () => {
    const n = normalizeFocus(base);
    expect(n.center).toEqual([12.35, 56.79]);
    expect(n.zoom).toBe(4.6);
  });

  it("is stable — same input yields the same key", () => {
    expect(buildFocusKey(base)).toBe(buildFocusKey({ ...base }));
  });

  it("collapses sub-grid drift onto one key", () => {
    // interior drift that still rounds to the same cell (12.35 / 56.79 / 4.6)
    const drifted: FocusRequest = { ...base, center: [12.3510, 56.7870], zoom: 4.62 };
    expect(buildFocusKey(drifted)).toBe(buildFocusKey(base));
  });

  it("namespaces under focus:v1 and folds in detail/kind/subject", () => {
    expect(buildFocusKey(base)).toBe("focus:v1:broadcast:quake:us7000abcd:12.35:56.79:4.6");
  });

  it("distinguishes different subjects at the same point", () => {
    expect(buildFocusKey(base)).not.toBe(buildFocusKey({ ...base, subject: "us7000zzzz" }));
  });

  it("uses '-' for a missing subject", () => {
    const key = buildFocusKey({ ...base, kind: "global", subject: null });
    expect(key).toBe("focus:v1:broadcast:global:-:12.35:56.79:4.6");
  });

  it("normalises -0 so sign never splits the key", () => {
    const a = buildFocusKey({ ...base, center: [-0.0001, 0.0001] });
    const b = buildFocusKey({ ...base, center: [0, 0] });
    expect(a).toBe(b);
  });
});
