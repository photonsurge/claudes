import { renderHook, act } from "@testing-library/react";
import { mergeJobLog, pushJobLog, useJobLog, type JobLogLine } from "./queue-log-store";

const line = (seq: number, text = `line ${seq}`): JobLogLine => ({ seq, ts: 1000 + seq, level: "info", line: text });

describe("queue-log-store", () => {
  it("returns a stable empty reference for an unknown job", () => {
    const { result } = renderHook(() => useJobLog("nope"));
    expect(result.current).toEqual([]);
  });

  it("accumulates live lines in seq order", () => {
    const { result } = renderHook(() => useJobLog("a"));
    act(() => pushJobLog("a", line(1)));
    act(() => pushJobLog("a", line(2)));
    expect(result.current.map((l) => l.seq)).toEqual([1, 2]);
  });

  it("dedupes by seq when history and live overlap, keeping order", () => {
    const { result } = renderHook(() => useJobLog("b"));
    // live delivers 2 and 3
    act(() => pushJobLog("b", line(2)));
    act(() => pushJobLog("b", line(3)));
    // backfill brings 1,2,3 — only 1 is new, no dup of 2/3, sorted
    act(() => mergeJobLog("b", [line(1), line(2), line(3)]));
    expect(result.current.map((l) => l.seq)).toEqual([1, 2, 3]);
  });

  it("does not re-render (keeps the same reference) when nothing is new", () => {
    const { result } = renderHook(() => useJobLog("c"));
    act(() => pushJobLog("c", line(5)));
    const first = result.current;
    act(() => mergeJobLog("c", [line(5)])); // already present
    expect(result.current).toBe(first);
  });

  it("isolates jobs from each other", () => {
    const a = renderHook(() => useJobLog("j1"));
    const b = renderHook(() => useJobLog("j2"));
    act(() => pushJobLog("j1", line(1, "hello")));
    expect(a.result.current).toHaveLength(1);
    expect(b.result.current).toHaveLength(0);
  });
});
