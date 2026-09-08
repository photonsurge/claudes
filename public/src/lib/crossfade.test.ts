import { act, renderHook } from "@testing-library/react";
import { clampProgress, useCrossfadeVariable } from "./crossfade";

describe("clampProgress", () => {
  it("is 0 at the start and 1 once elapsed reaches fadeMs", () => {
    expect(clampProgress(0, 700)).toBe(0);
    expect(clampProgress(350, 700)).toBeCloseTo(0.5);
    expect(clampProgress(700, 700)).toBe(1);
  });

  it("clamps beyond the fade window and treats a non-positive fadeMs as instant", () => {
    expect(clampProgress(5000, 700)).toBe(1);
    expect(clampProgress(-10, 700)).toBe(0);
    expect(clampProgress(0, 0)).toBe(1);
  });
});

describe("useCrossfadeVariable", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it("starts settled on the initial value with no fade", () => {
    const { result } = renderHook(() => useCrossfadeVariable("sst", 700));
    expect(result.current).toEqual({ from: null, to: "sst", startedAt: 0, fadeMs: 700 });
  });

  it("records the fade's start for the GPU ramp, then clears `from` once fadeMs has elapsed", () => {
    const { result, rerender } = renderHook(({ v }: { v: string }) => useCrossfadeVariable(v, 700), {
      initialProps: { v: "sst" },
    });
    const before = Date.now();
    rerender({ v: "sst100" });
    expect(result.current.from).toBe("sst");
    expect(result.current.to).toBe("sst100");
    expect(result.current.startedAt).toBeGreaterThanOrEqual(before);
    expect(result.current.fadeMs).toBe(700);
    // No ticking: the state is unchanged until the fade is over …
    act(() => {
      jest.advanceTimersByTime(699);
    });
    expect(result.current.from).toBe("sst");
    // … then `from` drops out exactly once.
    act(() => {
      jest.advanceTimersByTime(1);
    });
    expect(result.current.from).toBeNull();
    expect(result.current.to).toBe("sst100");
  });

  it("is a no-op when the value doesn't change", () => {
    const { result, rerender } = renderHook(({ v }: { v: string }) => useCrossfadeVariable(v, 700), {
      initialProps: { v: "sst" },
    });
    const first = result.current;
    rerender({ v: "sst" });
    expect(result.current).toBe(first);
  });
});
