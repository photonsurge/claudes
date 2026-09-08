import { pageDotStyle, pageDotsSlack } from "./page-dots";

describe("pageDotStyle (layout-free page indicator)", () => {
  it("stretches the active square from its left edge and slides the ones after it", () => {
    const st = (i: number) => pageDotStyle(i, 1, 6, 18, "#43d9ff", "#1d4354", 300);
    expect(st(0).transform).toBe("none");
    expect(st(1).transform).toBe("scaleX(3)");
    expect(st(2).transform).toBe("translateX(12px)");
    expect(st(1).background).toBe("#43d9ff");
    expect(st(2).background).toBe("#1d4354");
    expect(st(1).transformOrigin).toBe("left center");
  });

  it("keeps every layout box at the small size and animates transform, never width", () => {
    const s = pageDotStyle(0, 0, 5, 14, "#fff", "#000", 1200);
    expect(s.width).toBe(5);
    expect(s.height).toBe(5);
    expect(s.transform).toBe("scaleX(2.8)");
    expect(s.transition).toBe("transform 1200ms ease, background 1200ms ease");
    expect(String(s.transition)).not.toContain("width");
  });

  it("slack equals the stretch", () => {
    expect(pageDotsSlack(6, 18)).toBe(12);
    expect(pageDotsSlack(5, 14)).toBe(9);
  });
});
