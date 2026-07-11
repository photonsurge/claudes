import { renderHook, act } from "@testing-library/react";
import { useSegmentTransition } from "./useSegmentTransition";

describe("useSegmentTransition", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it("is false on first render (no cut on initial mount)", () => {
    const { result } = renderHook(() => useSegmentTransition("quake:a", 900));
    expect(result.current).toBe(false);
  });

  it("goes true when the segment id changes, then false after the cut duration", () => {
    const { result, rerender } = renderHook(
      ({ id }) => useSegmentTransition(id, 900),
      { initialProps: { id: "quake:a" } },
    );
    expect(result.current).toBe(false);

    act(() => rerender({ id: "storm:b" }));
    expect(result.current).toBe(true);

    act(() => jest.advanceTimersByTime(899));
    expect(result.current).toBe(true);

    act(() => jest.advanceTimersByTime(1));
    expect(result.current).toBe(false);
  });

  it("holds a minimum beat for a manual fly (cutTransitionMs = 0)", () => {
    const { result, rerender } = renderHook(
      ({ id }) => useSegmentTransition(id, 0),
      { initialProps: { id: "a" } },
    );
    act(() => rerender({ id: "b" }));
    expect(result.current).toBe(true);
    act(() => jest.advanceTimersByTime(350));
    expect(result.current).toBe(false);
  });

  it("does not re-trigger when only the duration changes", () => {
    const { result, rerender } = renderHook(
      ({ id, ms }) => useSegmentTransition(id, ms),
      { initialProps: { id: "a", ms: 900 } },
    );
    act(() => rerender({ id: "a", ms: 1200 }));
    expect(result.current).toBe(false);
  });
});
