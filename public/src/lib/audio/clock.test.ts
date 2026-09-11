import { LATE_SLACK_S, resyncGrid, startTicker } from "./clock";

const STEP = 60 / 121 / 4;

describe("resyncGrid", () => {
  it("leaves a future step alone", () => {
    expect(resyncGrid({ step: 7, time: 10.5 }, 10.0, STEP)).toEqual({ step: 7, time: 10.5, dropped: 0 });
  });

  it("tolerates being a hair late (inside the slack)", () => {
    const r = resyncGrid({ step: 7, time: 10.0 }, 10.0 + LATE_SLACK_S * 0.5, STEP);
    expect(r.dropped).toBe(0);
    expect(r.step).toBe(7);
  });

  it("skips the steps a stall swallowed and lands on the grid", () => {
    const now = 10.0 + 0.4; // a 400 ms director-cut stall
    const r = resyncGrid({ step: 7, time: 10.0 }, now, STEP);
    expect(r.dropped).toBeGreaterThan(0);
    expect(r.time).toBeGreaterThanOrEqual(now + LATE_SLACK_S);
    expect(r.time - 10.0).toBeCloseTo(r.dropped * STEP, 9); // still on the 16th grid
    expect(r.step).toBe(7 + r.dropped);
  });
});

describe("startTicker", () => {
  it("falls back to setInterval without Worker support and stops cleanly", () => {
    jest.useFakeTimers();
    try {
      const tick = jest.fn();
      const stop = startTicker(tick, 10);
      jest.advanceTimersByTime(35);
      expect(tick).toHaveBeenCalledTimes(3);
      stop();
      jest.advanceTimersByTime(50);
      expect(tick).toHaveBeenCalledTimes(3);
    } finally {
      jest.useRealTimers();
    }
  });
});
