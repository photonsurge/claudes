import { accentBorder } from "./config";

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
