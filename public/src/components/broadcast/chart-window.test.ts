import { chartWindow, chartWindowAcross } from "./chart-window";

const HOUR = 3_600_000;
const NOW = Date.parse("2026-09-13T12:00:00Z");

/** A series of `count` 3-hourly readings starting `startH` hours from NOW. */
const track = (startH: number, count: number, value: number | null = 10) =>
  Array.from({ length: count }, (_, i) => ({
    t: new Date(NOW + (startH + i * 3) * HOUR).toISOString(),
    value,
  }));

describe("chartWindow", () => {
  it("names a forward-looking series for the hours it actually reaches", () => {
    // 0 → +72h, so the chart may honestly claim the next 72 hours.
    expect(chartWindow(track(0, 25), NOW)).toMatchObject({
      tag: "NEXT 72H",
      title: "Next 72 Hours",
      forward: true,
      hours: 72,
    });
  });

  it("claims only what a SHORT forecast covers, not the nominal horizon", () => {
    // The store only held 8 steps — 21 hours, not 72.
    expect(chartWindow(track(0, 8), NOW)?.tag).toBe("NEXT 21H");
  });

  it("reads LAST when the run has already elapsed", () => {
    // Frames from a run whose steps all ran out before now.
    expect(chartWindow(track(-30, 9), NOW)).toMatchObject({
      tag: "LAST 30H",
      title: "Last 30 Hours",
      forward: false,
      hours: 30,
    });
  });

  it("names a straddling series for the side it reaches further into", () => {
    // A stale leading hour on an otherwise forward track stays NEXT…
    expect(chartWindow(track(-6, 25), NOW)?.tag).toBe("NEXT 66H");
    // …but a track that is mostly behind us flips to LAST.
    expect(chartWindow(track(-66, 25), NOW)?.tag).toBe("LAST 66H");
  });

  it("singularises a one-hour window and never claims zero hours", () => {
    const pts = [
      { t: new Date(NOW + 10 * 60_000).toISOString(), value: 1 },
      { t: new Date(NOW + 40 * 60_000).toISOString(), value: 2 },
    ];
    expect(chartWindow(pts, NOW)).toMatchObject({ tag: "NEXT 1H", title: "Next 1 Hour" });
  });

  it("measures the DRAWN trace, ignoring gaps the chart never plots", () => {
    // Trailing nulls stretch the array but not the line, so they must not
    // inflate the claimed window (sparkPoints skips them too).
    const pts = [...track(0, 5), ...track(72, 3, null)];
    expect(chartWindow(pts, NOW)?.tag).toBe("NEXT 12H");
  });

  it("returns null when there is no trace to label", () => {
    expect(chartWindow([], NOW)).toBeNull();
    expect(chartWindow(track(0, 1), NOW)).toBeNull();
    expect(chartWindow(track(0, 5, null), NOW)).toBeNull();
  });

  it("skips unparseable timestamps rather than labelling NaN hours", () => {
    const pts = [{ t: "not-a-date", value: 1 }, ...track(0, 3)];
    expect(chartWindow(pts, NOW)?.tag).toBe("NEXT 6H");
  });
});

describe("chartWindowAcross", () => {
  it("spans every series, so the heading covers the widest of them", () => {
    const shortOne = track(0, 3); // +6h
    const longOne = track(0, 25); // +72h
    expect(chartWindowAcross([shortOne, longOne], NOW)?.tag).toBe("NEXT 72H");
  });

  it("ignores series with nothing plottable", () => {
    expect(chartWindowAcross([track(0, 9, null), track(0, 9)], NOW)?.tag).toBe("NEXT 24H");
  });

  it("returns null when no series has a trace", () => {
    expect(chartWindowAcross([[], track(0, 1)], NOW)).toBeNull();
  });
});

describe("chartWindow (long windows)", () => {
  it("spells a window past the 3-day horizon in days, not a wall of hours", () => {
    // A stale archive once tagged a card "LAST 1797 H"; days read as a duration.
    expect(chartWindow(track(-24 * 75, 2), NOW)).toMatchObject({
      tag: "LAST 75D",
      title: "Last 75 Days",
      hours: 1800,
    });
    // One day past the horizon is still a day, not "96H".
    expect(chartWindow(track(-96, 2), NOW)?.tag).toBe("LAST 4D");
    // …and the horizon itself stays in hours.
    expect(chartWindow(track(-72, 2), NOW)?.tag).toBe("LAST 72H");
  });
});
