import { renderHook, act } from "@testing-library/react";
import { clampProgress, useCrossfadeVariable } from "./crossfade";

describe("clampProgress", () => {
  it("is 0 at the start and 1 once elapsed reaches fadeMs", () => {
    expect(clampProgress(0, 700)).toBe(0);
    expect(clampProgress(700, 700)).toBe(1);
    expect(clampProgress(350, 700)).toBeCloseTo(0.5, 5);
  });

  it("clamps beyond the fade window and treats a non-positive fadeMs as instant", () => {
    expect(clampProgress(10_000, 700)).toBe(1);
    expect(clampProgress(0, 0)).toBe(1);
  });
});

describe("useCrossfadeVariable", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it("starts settled on the initial value with no fade", () => {
    const { result } = renderHook(({ v }) => useCrossfadeVariable(v), { initialProps: { v: "sst" } });
    expect(result.current).toEqual({ from: null, to: "sst", progress: 1 });
  });

  it("fades from the previous value to the new one, then settles", () => {
    const { result, rerender } = renderHook(({ v }) => useCrossfadeVariable(v, 700), {
      initialProps: { v: "sst" },
    });
    rerender({ v: "sst100" });
    expect(result.current).toEqual({ from: "sst", to: "sst100", progress: 0 });

    act(() => {
      jest.advanceTimersByTime(350);
    });
    expect(result.current.from).toBe("sst");
    expect(result.current.to).toBe("sst100");
    expect(result.current.progress).toBeGreaterThan(0);
    expect(result.current.progress).toBeLessThan(1);

    act(() => {
      jest.advanceTimersByTime(1000);
    });
    expect(result.current).toEqual({ from: null, to: "sst100", progress: 1 });
  });

  it("is a no-op when the value doesn't change", () => {
    const { result, rerender } = renderHook(({ v }) => useCrossfadeVariable(v, 700), {
      initialProps: { v: "sst" },
    });
    rerender({ v: "sst" });
    expect(result.current).toEqual({ from: null, to: "sst", progress: 1 });
  });
});
