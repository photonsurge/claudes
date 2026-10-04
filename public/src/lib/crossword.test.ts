import { renderHook, act } from "@testing-library/react";
import { CROSSWORD_BEAT, CROSSWORD_STATE, type CrosswordPublicState } from "@photonsurge/shared/crossword";
import {
  beatNeedsResync,
  clockOffset,
  fetchCrosswordState,
  formatClock,
  remainingMs,
  surfaceRedirect,
  useCrosswordState,
} from "./crossword";

/** A socket whose handlers the tests fire by hand. */
const socketHandlers = new Map<string, (p?: unknown) => void>();
const fakeSocket = {
  on: (e: string, fn: (p?: unknown) => void) => socketHandlers.set(e, fn),
  off: (e: string) => socketHandlers.delete(e),
};
jest.mock("./socket-provider", () => ({ useSocket: () => ({ socket: fakeSocket, connected: true }) }));
jest.mock("next/navigation", () => ({ useRouter: () => ({ replace: jest.fn() }), useSearchParams: () => null }));

const pub = (p: Partial<CrosswordPublicState> = {}): CrosswordPublicState => ({
  sceneId: "xw",
  seq: 1,
  serverNow: 0,
  phase: "playing",
  phaseEndsAt: 0,
  puzzleNo: 3,
  title: "Space",
  width: 3,
  height: 1,
  rows: ["A.."],
  entries: [],
  spotlight: null,
  scores: [],
  today: [],
  feed: [],
  inputLive: false,
  paused: false,
  ...p,
});

describe("clock helpers", () => {
  it("counts down from the server's clock, not the local one", () => {
    // The encoder's clock is 5 s behind the server's.
    const offset = clockOffset(105_000, 100_000);
    expect(offset).toBe(5_000);
    // Spotlight ends at server 130 s; at local 101 s the server says 106 s.
    expect(remainingMs(130_000, offset, 101_000)).toBe(24_000);
    expect(formatClock(remainingMs(130_000, offset, 101_000))).toBe("0:24");
    expect(remainingMs(130_000, offset, 200_000)).toBe(0);
  });

  it("formats rounding up, minutes and the end", () => {
    expect(formatClock(23_100)).toBe("0:24");
    expect(formatClock(65_000)).toBe("1:05");
    expect(formatClock(0)).toBe("0:00");
    expect(formatClock(-5)).toBe("0:00");
  });

  it("asks for a resync only when a beat's seq differs from the one shown", () => {
    expect(beatNeedsResync(4, { seq: 4 })).toBe(false);
    expect(beatNeedsResync(4, { seq: 6 })).toBe(true);
    expect(beatNeedsResync(null, { seq: 6 })).toBe(false);
  });
});

describe("surfaceRedirect", () => {
  it("sends a globe scene off the crossword route and keeps the query", () => {
    expect(surfaceRedirect({ id: "atlantic" }, "crossword", "token=abc&obs=1")).toBe("/watch/atlantic?token=abc&obs=1");
    expect(surfaceRedirect({ id: "atlantic", surface: "globe" }, "crossword", "")).toBe("/watch/atlantic");
  });

  it("sends a crossword scene off the globe route", () => {
    expect(surfaceRedirect({ id: "xw", surface: "crossword" }, "globe", "token=t")).toBe("/crossword/xw?token=t");
  });

  it("leaves a scene on its own route, and an unknown scene where it is", () => {
    expect(surfaceRedirect({ id: "xw", surface: "crossword" }, "crossword", "token=t")).toBeNull();
    expect(surfaceRedirect({ id: "atlantic" }, "globe", "token=t")).toBeNull();
    expect(surfaceRedirect(undefined, "globe", "token=t")).toBeNull();
  });
});

describe("fetchCrosswordState", () => {
  afterEach(() => jest.restoreAllMocks());
  const reply = (status: number, body: unknown = {}) => {
    global.fetch = jest.fn(async () => ({ ok: status < 300, status, json: async () => body })) as unknown as typeof fetch;
  };

  it("reads the state route with the token", async () => {
    reply(200, pub());
    const r = await fetchCrosswordState("x w", "a b");
    expect(r.kind).toBe("ok");
    expect((global.fetch as jest.Mock).mock.calls[0][0]).toBe("/api/crossword/x%20w/state?token=a%20b");
  });

  it("maps 401, 404 and a 5xx", async () => {
    reply(401);
    expect((await fetchCrosswordState("xw")).kind).toBe("tokenError");
    reply(404);
    expect((await fetchCrosswordState("xw")).kind).toBe("notCrossword");
    reply(503);
    expect((await fetchCrosswordState("xw")).kind).toBe("failed");
  });
});

describe("useCrosswordState", () => {
  const flush = () => act(() => jest.advanceTimersByTimeAsync(0));
  let queue: (number | CrosswordPublicState)[] = [];

  beforeEach(() => {
    jest.useFakeTimers();
    socketHandlers.clear();
    queue = [];
    global.fetch = jest.fn(async () => {
      const next = queue.shift() ?? 500;
      if (typeof next === "number") return { ok: false, status: next, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => next };
    }) as unknown as typeof fetch;
  });
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it("cold starts, then follows CROSSWORD_STATE for its own scene only", async () => {
    queue = [pub({ seq: 1 })];
    const { result } = renderHook(() => useCrosswordState("xw", "tok"));
    await flush();
    expect(result.current.ready).toBe(true);
    expect(result.current.state?.seq).toBe(1);

    act(() => socketHandlers.get(CROSSWORD_STATE)?.(pub({ sceneId: "other", seq: 9 })));
    expect(result.current.state?.seq).toBe(1);
    act(() => socketHandlers.get(CROSSWORD_STATE)?.(pub({ seq: 2, title: "Moons" })));
    expect(result.current.state?.title).toBe("Moons");
  });

  it("unwraps the socket relay's { type, data } envelope", async () => {
    queue = [pub({ seq: 1 })];
    const { result } = renderHook(() => useCrosswordState("xw", "tok"));
    await flush();
    act(() => socketHandlers.get(CROSSWORD_STATE)?.({ type: CROSSWORD_STATE, data: pub({ seq: 3, title: "Relayed" }) }));
    expect(result.current.state?.title).toBe("Relayed");
    queue = [pub({ seq: 8 })];
    act(() => socketHandlers.get(CROSSWORD_BEAT)?.({ type: CROSSWORD_BEAT, data: { sceneId: "xw", seq: 8, serverNow: Date.now() } }));
    await flush();
    expect(result.current.state?.seq).toBe(8);
  });

  it("refetches the route when a beat's seq is not the one on screen, and not otherwise", async () => {
    queue = [pub({ seq: 1 })];
    const { result } = renderHook(() => useCrosswordState("xw", "tok"));
    await flush();
    expect(global.fetch).toHaveBeenCalledTimes(1);

    act(() => socketHandlers.get(CROSSWORD_BEAT)?.({ sceneId: "xw", seq: 1, serverNow: Date.now() }));
    await flush();
    expect(global.fetch).toHaveBeenCalledTimes(1);

    queue = [pub({ seq: 5, title: "Resynced" })];
    act(() => socketHandlers.get(CROSSWORD_BEAT)?.({ sceneId: "xw", seq: 5, serverNow: Date.now() }));
    await flush();
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(result.current.state?.seq).toBe(5);
    expect(result.current.state?.title).toBe("Resynced");
  });

  it("keeps the board on a failed resync", async () => {
    queue = [pub({ seq: 1 }), 503];
    const { result } = renderHook(() => useCrosswordState("xw", "tok"));
    await flush();
    act(() => socketHandlers.get(CROSSWORD_BEAT)?.({ sceneId: "xw", seq: 3, serverNow: Date.now() }));
    await flush();
    expect(result.current.state?.seq).toBe(1);
  });

  it("takes the clock offset from serverNow", async () => {
    queue = [pub({ seq: 1, serverNow: Date.now() + 7_000 })];
    const { result } = renderHook(() => useCrosswordState("xw", "tok"));
    await flush();
    expect(Math.round(result.current.offset / 1000)).toBe(7);
    act(() => socketHandlers.get(CROSSWORD_BEAT)?.({ sceneId: "xw", seq: 1, serverNow: Date.now() - 3_000 }));
    expect(Math.round(result.current.offset / 1000)).toBe(-3);
  });

  it("reports a bad token and stops", async () => {
    queue = [401];
    const { result } = renderHook(() => useCrosswordState("xw", "bad"));
    await flush();
    expect(result.current.tokenError).toBe(true);
    expect(result.current.state).toBeNull();
  });
});
