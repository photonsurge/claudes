import { quakeSegmentContent } from "./segments";

/** 2026-07-02T12:00:00Z as epoch ms — a fixed "now" so "Ago" is deterministic. */
const NOW = Date.UTC(2026, 6, 2, 12, 0, 0);
const row = (c: ReturnType<typeof quakeSegmentContent>, label: string) =>
  c.details.find((d) => d.label === label)?.value;

describe("quakeSegmentContent — time ago", () => {
  it("adds an elapsed 'Ago' row alongside the absolute 'Occurred' time", () => {
    const c = quakeSegmentContent({
      mag: 5.4,
      depthKm: 12,
      timeMs: NOW - (3 * 60 + 12) * 60_000, // 3h 12m earlier
      nowMs: NOW,
    });
    expect(row(c, "Ago")).toBe("3h 12m ago");
    expect(row(c, "Occurred")).toBe("2026-07-02 08:48 UTC");
  });

  it("reads 'just now' for a quake under a minute old", () => {
    const c = quakeSegmentContent({ mag: 4, depthKm: 5, timeMs: NOW - 30_000, nowMs: NOW });
    expect(row(c, "Ago")).toBe("just now");
  });

  it("rolls into days for old events", () => {
    const c = quakeSegmentContent({ mag: 6, depthKm: 30, timeMs: NOW - (2 * 24 * 60 + 4 * 60) * 60_000, nowMs: NOW });
    expect(row(c, "Ago")).toBe("2d 4h ago");
  });

  it("omits both time rows when no timestamp is given", () => {
    const c = quakeSegmentContent({ mag: 5, depthKm: 10 });
    expect(row(c, "Ago")).toBeUndefined();
    expect(row(c, "Occurred")).toBeUndefined();
  });
});
