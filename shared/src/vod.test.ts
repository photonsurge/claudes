import {
  buildAsRunTimeline,
  buildChapters,
  chapterBudget,
  composeDescription,
  fmtOffset,
  runsOverlapping,
  videoStartOnOurClock,
  videoTimeBase,
  vodArchiveAtRisk,
  vodOffsetMs,
  vodSeekUrl,
  type AsRunItem,
} from "./vod";

const T = (s: number) => 1_700_000_000_000 + s * 1000;

describe("videoTimeBase", () => {
  it("prefers YouTube's actualStartTime over the worker's go-live stamp", () => {
    expect(videoTimeBase({ startAt: T(0), platforms: { youtube: { actualStartTime: T(3) } } })).toEqual({
      baseMs: T(3),
      source: "youtube",
    });
  });
  it("falls back to startAt, and to null when the run never went live", () => {
    expect(videoTimeBase({ startAt: T(0), platforms: { youtube: {} } })).toEqual({ baseMs: T(0), source: "run" });
    expect(videoTimeBase({ startAt: null, platforms: {} })).toBeNull();
    expect(videoTimeBase({ platforms: { youtube: { actualStartTime: null } } })).toBeNull();
  });
});

describe("offsets", () => {
  it("subtracts the base, adds the pipeline lead (cuts land later in the VOD), never negative", () => {
    expect(vodOffsetMs(T(65), T(5))).toBe(60_000);
    expect(vodOffsetMs(T(65), T(5), 10_000)).toBe(70_000);
    expect(vodOffsetMs(T(2), T(5))).toBe(0);
    expect(videoStartOnOurClock(T(5), 10_000)).toBe(T(-5));
    expect(vodOffsetMs(videoStartOnOurClock(T(5), 10_000), T(5), 10_000)).toBe(0);
  });
  it("formats YouTube-style", () => {
    expect(fmtOffset(0)).toBe("0:00");
    expect(fmtOffset(5_400)).toBe("0:05");
    expect(fmtOffset(187_000)).toBe("3:07");
    expect(fmtOffset(5_025_000)).toBe("1:23:45");
    expect(fmtOffset(-3_000)).toBe("0:00");
  });
  it("builds a seek URL on either URL shape", () => {
    expect(vodSeekUrl("https://youtu.be/abc", 187_900)).toBe("https://youtu.be/abc?t=187s");
    expect(vodSeekUrl("https://www.youtube.com/watch?v=abc", 5_000)).toBe("https://www.youtube.com/watch?v=abc&t=5s");
  });
});

describe("buildAsRunTimeline", () => {
  const entry = (id: string, start: number, end: number | null) => ({
    id,
    startedAt: new Date(T(start)),
    endedAt: end == null ? null : new Date(T(end)),
  });

  it("places cuts at video offsets and fills unlogged stretches with gaps", () => {
    // Video 0..600 s; cuts 30..75 (a 30 s hand-driven lead-in), 75..120, then
    // nothing until the end (auto turned off).
    const items = buildAsRunTimeline([entry("a", 30, 75), entry("b", 75, 120)], {
      fromMs: T(0),
      toMs: T(600),
      baseMs: T(0),
    });
    expect(items.map((i) => (i.type === "cut" ? `cut:${i.entry.id}` : `gap:${i.reason}`))).toEqual([
      "gap:before-first-cut",
      "cut:a",
      "cut:b",
      "gap:after-last-cut",
    ]);
    expect(items[0]).toMatchObject({ offsetMs: 0, endOffsetMs: 30_000 });
    expect(items[1]).toMatchObject({ offsetMs: 30_000, endOffsetMs: 75_000, clippedStart: false, clippedEnd: false });
    expect(items[3]).toMatchObject({ offsetMs: 120_000, endOffsetMs: 600_000 });
  });

  it("ignores cut-to-cut rounding but reports real between-cut gaps", () => {
    const items = buildAsRunTimeline([entry("a", 0, 45), entry("b", 46, 90), entry("c", 200, 240)], {
      fromMs: T(0),
      toMs: T(240),
      baseMs: T(0),
    });
    expect(items.map((i) => (i.type === "cut" ? i.entry.id : i.reason))).toEqual(["a", "b", "between-cuts", "c"]);
  });

  it("clips shots straddling the video's edges and applies the time base + lead", () => {
    // Video went live at T(100) on YouTube's clock with a 2 s pipeline lead, so
    // t=0 shows what our screen had at T(98); our cut started at T(90).
    const items = buildAsRunTimeline([entry("a", 90, 130), entry("b", 130, 700)], {
      fromMs: T(98),
      toMs: T(398),
      baseMs: T(100),
      leadMs: 2_000,
    });
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ type: "cut", offsetMs: 0, endOffsetMs: 32_000, clippedStart: true, clippedEnd: false });
    expect(items[1]).toMatchObject({ type: "cut", offsetMs: 32_000, endOffsetMs: 300_000, clippedStart: false, clippedEnd: true });
  });

  it("keeps the on-air shot open on a live run and stops there", () => {
    const items = buildAsRunTimeline([entry("a", 0, 45), entry("b", 45, null)], {
      fromMs: T(0),
      toMs: null,
      baseMs: T(0),
      nowMs: T(600),
    });
    expect(items).toHaveLength(2);
    expect(items[1]).toMatchObject({ type: "cut", offsetMs: 45_000, endOffsetMs: null, clippedEnd: false });
  });

  it("clips a still-open entry at the end of a finished run instead of calling it live", () => {
    const items = buildAsRunTimeline([entry("a", 0, null)], { fromMs: T(0), toMs: T(300), baseMs: T(0) });
    expect(items).toEqual([
      { type: "cut", entry: expect.objectContaining({ id: "a" }), offsetMs: 0, endOffsetMs: 300_000, clippedStart: false, clippedEnd: true },
    ]);
  });

  it("drops entries entirely outside the window and reports an empty video as one gap", () => {
    const items = buildAsRunTimeline([entry("x", -100, -50), entry("y", 900, 950)], {
      fromMs: T(0),
      toMs: T(300),
      baseMs: T(0),
    });
    expect(items).toEqual([{ type: "gap", offsetMs: 0, endOffsetMs: 300_000, reason: "before-first-cut" }]);
  });
});

describe("runsOverlapping", () => {
  const r = (id: string, over: Record<string, unknown>) => ({ id, status: "ended", ...over });
  it("keeps runs whose on-air span touches the window, treating live runs as reaching now", () => {
    const runs = [
      r("before", { startAt: T(0), endedAt: T(50) }),
      r("inside", { startAt: T(120), endedAt: T(180) }),
      r("straddle", { startAt: T(50), endedAt: T(150) }),
      r("after", { startAt: T(300), endedAt: T(400) }),
      r("live", { startAt: T(150), endedAt: null, status: "live" }),
      r("never", { startAt: null, endedAt: null, status: "failed" }),
    ];
    expect(runsOverlapping(runs, T(100), T(200), T(500)).map((x) => x.id)).toEqual(["inside", "straddle", "live"]);
  });
});

describe("buildChapters", () => {
  const cutItem = (
    id: string,
    offsetS: number,
    endS: number | null,
    over: Partial<{ segmentId: string; kind: string; title: string; subtitle: string; icon: string; breaking: boolean; timesShown: number }> = {},
  ): AsRunItem<{ segmentId: string; kind: string; title: string; subtitle?: string; icon?: string; breaking?: boolean; timesShown?: number }> => ({
    type: "cut",
    entry: { segmentId: `quake:${id}`, kind: "quake", title: `Quake ${id}`, ...over },
    offsetMs: offsetS * 1000,
    endOffsetMs: endS == null ? null : endS * 1000,
    clippedStart: false,
    clippedEnd: false,
  });
  const gap = (fromS: number, toS: number): AsRunItem<never> => ({ type: "gap", offsetMs: fromS * 1000, endOffsetMs: toS * 1000, reason: "between-cuts" });

  it("opens at 0:00, merges same-subject runs of cuts, drops sub-10 s shots, keeps air order", () => {
    const chapters = buildChapters(
      [
        gap(0, 30),
        cutItem("a", 30, 75, { subtitle: "M6.1 · Fiji", breaking: true }),
        cutItem("a", 75, 120), // same subject, back to back → one chapter
        cutItem("b", 120, 125), // 5 s — below YouTube's floor
        cutItem("c", 125, 200, { icon: "🌀", title: "Hurricane Ida" }),
      ],
      { maxChars: 5000, openingLabel: "Live globe" },
    );
    expect(chapters.map((c) => c.line)).toEqual([
      "0:00 Live globe",
      "0:30 🚨 Quake a · M6.1 · Fiji",
      "2:05 🌀 Hurricane Ida",
    ]);
  });

  it("snaps a first cut that starts within 10 s of t=0 onto 0:00 instead of adding an opener", () => {
    const chapters = buildChapters([cutItem("a", 4, 60), cutItem("b", 60, 120)], { maxChars: 5000, openingLabel: "Live globe" });
    expect(chapters.map((c) => c.line)).toEqual(["0:00 Quake a", "1:00 Quake b"]);
  });

  it("fits the character budget by keeping breaking picks, then first airings, then the longest holds", () => {
    const items = [
      cutItem("short-first", 0, 20, { timesShown: 1 }),
      cutItem("long-repeat", 20, 400, { timesShown: 3 }),
      cutItem("breaking", 400, 415, { breaking: true, timesShown: 2 }),
      cutItem("mid-first", 415, 500, { timesShown: 1 }),
    ];
    const all = buildChapters(items, { maxChars: 5000, openingLabel: "Live globe" });
    expect(all).toHaveLength(4);
    // Budget for exactly two lines (opener is not needed: first cut is at 0:00).
    // Budget for exactly two lines (the first cut is at 0:00, so no opener is added).
    const two = buildChapters(items, { maxChars: "6:40 🚨 Quake breaking".length + 1 + "6:55 Quake mid-first".length + 1, openingLabel: "x" });
    expect(two.map((c) => c.line)).toEqual(["6:40 🚨 Quake breaking", "6:55 Quake mid-first"]);
  });

  it("truncates long labels and collapses whitespace", () => {
    const [c] = buildChapters([cutItem("a", 0, 60, { title: "A  very\n long   title ".repeat(8) })], { maxChars: 5000, openingLabel: "x" });
    expect(c.label.length).toBeLessThanOrEqual(80);
    expect(c.label).not.toMatch(/\s{2,}/);
    expect(c.label.endsWith("…")).toBe(true);
  });

  it("returns just the opener for a video with no usable cuts", () => {
    expect(buildChapters([gap(0, 600)], { maxChars: 5000, openingLabel: "Live globe" }).map((c) => c.line)).toEqual(["0:00 Live globe"]);
  });
});

describe("composeDescription", () => {
  const chapters = [
    { offsetMs: 0, label: "Live globe", line: "0:00 Live globe" },
    { offsetMs: 30_000, label: "Quake", line: "0:30 Quake" },
  ];
  it("keeps the operator's text above our block and replaces a previous block", () => {
    const first = composeDescription("Our live globe.\nEnjoy.", chapters);
    expect(first).toBe("Our live globe.\nEnjoy.\n\n⏱ As aired\n0:00 Live globe\n0:30 Quake");
    const again = composeDescription(first, [chapters[0]], "More: https://x/vod/v");
    expect(again).toBe("Our live globe.\nEnjoy.\n\n⏱ As aired\n0:00 Live globe\n\nMore: https://x/vod/v");
  });
  it("works from an empty description and never exceeds YouTube's cap", () => {
    expect(composeDescription("", chapters)).toBe("⏱ As aired\n0:00 Live globe\n0:30 Quake");
    const out = composeDescription("x".repeat(6000), chapters);
    expect(out.length).toBeLessThanOrEqual(5000);
    expect(out.endsWith("0:30 Quake")).toBe(true);
  });
});

describe("chapterBudget", () => {
  it("leaves room for the operator's text, header and footer, but never below the floor", () => {
    expect(chapterBudget("", undefined)).toBe(5000 - ("⏱ As aired".length + 1));
    expect(chapterBudget("hello", "More: x")).toBe(5000 - ("⏱ As aired".length + 1) - ("More: x".length + 2) - ("hello".length + 2));
    expect(chapterBudget("x".repeat(4900))).toBe(1500);
  });
});

describe("vodArchiveAtRisk", () => {
  it("flags never-recycled slots and cadences of 12 h or more", () => {
    expect(vodArchiveAtRisk(null)).toBe(true);
    expect(vodArchiveAtRisk(0)).toBe(true);
    expect(vodArchiveAtRisk(12 * 3_600_000)).toBe(true);
    expect(vodArchiveAtRisk(24 * 3_600_000)).toBe(true);
    expect(vodArchiveAtRisk(6 * 3_600_000)).toBe(false);
  });
});
