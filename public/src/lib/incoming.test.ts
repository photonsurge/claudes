import { act, renderHook } from "@testing-library/react";
import type { Segment } from "@photonsurge/shared/director";
import { incomingEndsAt, incomingPhaseAt, useIncomingPhase } from "./incoming";

const T = Date.UTC(2026, 9, 4, 12);
const seg = (over: Partial<Segment> = {}): Segment => ({
  id: "quake:a",
  kind: "quake",
  title: "M6",
  camera: { center: [0, 0], zoom: 4 },
  patch: { spinEpoch: T },
  holdMs: 20_000,
  incomingMs: 4_000,
  ...over,
});

describe("incomingPhaseAt", () => {
  it.each([
    [T - 1, "incoming"],
    [T, "incoming"],
    [T + 3_999, "incoming"],
    [T + 4_000, "locked"],
    [T + 60_000, "locked"],
  ])("at %p is %p", (now, phase) => {
    expect(incomingPhaseAt(seg(), now)).toBe(phase);
  });

  it("is null without a pre-roll or a cut epoch", () => {
    expect(incomingPhaseAt(seg({ incomingMs: undefined }), T)).toBeNull();
    expect(incomingPhaseAt(seg({ incomingMs: 0 }), T)).toBeNull();
    expect(incomingPhaseAt(seg({ patch: {} }), T)).toBeNull();
    expect(incomingPhaseAt(null, T)).toBeNull();
  });

  it("knows when the pre-roll ends", () => {
    expect(incomingEndsAt(seg())).toBe(T + 4_000);
    expect(incomingEndsAt(seg({ incomingMs: 0 }))).toBeNull();
  });
});

describe("useIncomingPhase", () => {
  afterEach(() => jest.useRealTimers());

  it("flips to locked once, at the end of the pre-roll", () => {
    jest.useFakeTimers({ now: T + 1_000 });
    const { result } = renderHook(() => useIncomingPhase(seg()));
    expect(result.current).toBe("incoming");
    act(() => {
      jest.advanceTimersByTime(3_100);
    });
    expect(result.current).toBe("locked");
    expect(jest.getTimerCount()).toBe(0);
  });

  it("schedules nothing for a cut with no pre-roll", () => {
    jest.useFakeTimers({ now: T });
    const { result } = renderHook(() => useIncomingPhase(seg({ incomingMs: undefined })));
    expect(result.current).toBeNull();
    expect(jest.getTimerCount()).toBe(0);
  });
});
