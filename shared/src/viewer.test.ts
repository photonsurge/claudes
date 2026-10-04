import {
  activePicks,
  clearViewerState,
  emptyViewerState,
  grantRequest,
  nextViewerExpiry,
  sweepViewerState,
  type ViewerRequest,
} from "./viewer";

const T = 1_000_000;
const req = (over: Partial<ViewerRequest> = {}): Omit<ViewerRequest, "until"> => ({
  slot: "audioMode",
  value: "deep",
  label: "Deep",
  by: { author: "ann", platform: "sim" },
  requestedAt: T,
  holdMs: 60_000,
  ...over,
});

describe("grantRequest", () => {
  it("puts a request on air when its slot is free", () => {
    const { state, outcome } = grantRequest(emptyViewerState("s"), req(), 10, T);
    expect(outcome).toBe("active");
    expect(state.active.audioMode).toMatchObject({ value: "deep", until: T + 60_000 });
    expect(state.updatedAt).toBe(T);
  });

  it("queues behind a busy slot, but not behind another slot", () => {
    const one = grantRequest(emptyViewerState("s"), req(), 10, T).state;
    const two = grantRequest(one, req({ value: "chill" }), 10, T);
    expect(two.outcome).toBe("queued");
    expect(two.position).toBe(1);
    expect(two.state.queue[0]).toMatchObject({ value: "chill", until: 0 });
    const theme = grantRequest(two.state, req({ slot: "theme", value: "storm" }), 10, T);
    expect(theme.outcome).toBe("active");
  });

  it("refuses past the queue cap, and 0 means no cap", () => {
    let s = grantRequest(emptyViewerState("s"), req(), 1, T).state;
    s = grantRequest(s, req({ value: "chill" }), 1, T).state;
    expect(grantRequest(s, req({ value: "lounge" }), 1, T).outcome).toBe("full");
    expect(grantRequest(s, req({ value: "lounge" }), 0, T).outcome).toBe("queued");
  });

  it("frees a lapsed slot before deciding", () => {
    const s = grantRequest(emptyViewerState("s"), req(), 10, T).state;
    expect(grantRequest(s, req({ value: "chill" }), 10, T + 60_000).outcome).toBe("active");
  });
});

describe("sweepViewerState", () => {
  it("returns the same object when nothing changed", () => {
    const s = grantRequest(emptyViewerState("s"), req(), 10, T).state;
    expect(sweepViewerState(s, T + 1)).toBe(s);
  });

  it("lapses an expired pick and promotes the next one, starting its hold now", () => {
    let s = grantRequest(emptyViewerState("s"), req(), 10, T).state;
    s = grantRequest(s, req({ value: "chill", holdMs: 30_000 }), 10, T).state;
    const out = sweepViewerState(s, T + 61_000);
    expect(out.active.audioMode).toMatchObject({ value: "chill", until: T + 61_000 + 30_000 });
    expect(out.queue).toEqual([]);
  });

  it("just clears an expired pick with nothing waiting", () => {
    const s = grantRequest(emptyViewerState("s"), req(), 10, T).state;
    expect(sweepViewerState(s, T + 60_000).active).toEqual({});
  });
});

describe("activePicks / nextViewerExpiry / clearViewerState", () => {
  it("lists only unexpired picks and the earliest end", () => {
    let s = grantRequest(emptyViewerState("s"), req(), 10, T).state;
    s = grantRequest(s, req({ slot: "theme", value: "storm", holdMs: 10_000 }), 10, T).state;
    expect(Object.keys(activePicks(s, T))).toEqual(["audioMode", "theme"]);
    expect(Object.keys(activePicks(s, T + 20_000))).toEqual(["audioMode"]);
    expect(nextViewerExpiry(s, T)).toBe(T + 10_000);
    expect(nextViewerExpiry(null, T)).toBeNull();
    expect(activePicks(null, T)).toEqual({});
  });

  it("clears everything", () => {
    let s = grantRequest(emptyViewerState("s"), req(), 10, T).state;
    s = grantRequest(s, req({ value: "chill" }), 10, T).state;
    expect(clearViewerState(s, T + 5)).toMatchObject({ active: {}, queue: [], updatedAt: T + 5 });
  });
});
