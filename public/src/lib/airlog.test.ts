import { fmtDuration, kindColor, runCountsLine, runDurationMs, runIsLive, type AirRun } from "./airlog";

const NOW = new Date("2026-07-08T12:00:00Z").getTime();

const run = (over: Partial<AirRun> = {}): AirRun => ({
  id: "r1",
  sceneId: "default",
  startedAt: "2026-07-08T11:00:00Z",
  cuts: 10,
  kindCounts: { quake: 4 },
  ...over,
});

describe("runIsLive", () => {
  it("is live while cuts keep landing and no end mark is set", () => {
    expect(runIsLive(run({ lastCutAt: "2026-07-08T11:59:30Z" }), NOW)).toBe(true);
  });

  it("is not live once endedAt is set, however recent the last cut", () => {
    expect(runIsLive(run({ endedAt: "2026-07-08T11:59:59Z", lastCutAt: "2026-07-08T11:59:30Z" }), NOW)).toBe(false);
  });

  it("presumes an open run dead after 15 minutes without a cut (worker died)", () => {
    expect(runIsLive(run({ lastCutAt: "2026-07-08T11:40:00Z" }), NOW)).toBe(false);
  });

  it("falls back to startedAt when no cut has landed yet", () => {
    expect(runIsLive(run({ startedAt: "2026-07-08T11:59:00Z" }), NOW)).toBe(true);
  });
});

describe("runDurationMs", () => {
  it("measures ended runs start→end", () => {
    expect(runDurationMs(run({ endedAt: "2026-07-08T11:30:00Z" }), NOW)).toBe(30 * 60 * 1000);
  });

  it("measures open runs up to now", () => {
    expect(runDurationMs(run(), NOW)).toBe(60 * 60 * 1000);
  });
});

describe("fmtDuration", () => {
  it.each([
    [45_000, "45s"],
    [125_000, "2m 05s"],
    [3_845_000, "1h 04m"],
  ])("formats %d ms as %s", (ms, expected) => {
    expect(fmtDuration(ms)).toBe(expected);
  });
});

describe("kindColor", () => {
  it("gives every known kind its own colour and unknown kinds the fallback", () => {
    expect(kindColor("quake")).not.toBe(kindColor("storm"));
    expect(kindColor("not-a-kind")).toBe("#8b95a7");
  });
});

describe("runCountsLine", () => {
  it("names only the counts a run has", () => {
    expect(runCountsLine({ cuts: 1 })).toBe("1 cut");
    expect(runCountsLine({ cuts: 47, breakIns: 6, grouped: 1, commands: 5, viewerRequests: 3, queueDropped: 2 })).toBe(
      "47 cuts · 6 break-ins · 1 grouped · 2 operator cuts · 3 viewer requests · 2 breaking not aired",
    );
  });
});
