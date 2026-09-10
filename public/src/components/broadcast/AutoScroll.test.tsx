/**
 * AutoScroll paces itself from its own content: the text passes the window at
 * the channel's reading pace (ReadPaceContext → shared/reading-pace), so a
 * denser body creeps and a faster channel moves on. Driven here with a fake
 * ResizeObserver + rAF so the sizes and the clock are exact.
 */
import { cleanup, render } from "@testing-library/react";
import { act } from "react";
import { scrollPxPerSec } from "@photonsurge/shared/reading-pace";
import AutoScroll from "./AutoScroll";
import { ReadPaceContext } from "./pace-context";

type RoEntry = { target: Element; contentRect: { height: number } };
let roCallback: ((entries: RoEntry[]) => void) | null = null;
let frames: FrameRequestCallback[] = [];

class FakeResizeObserver {
  constructor(cb: (entries: RoEntry[]) => void) {
    roCallback = cb;
  }
  observe() {}
  disconnect() {}
}

beforeEach(() => {
  roCallback = null;
  frames = [];
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = FakeResizeObserver;
  globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
    frames.push(cb);
    return frames.length;
  }) as typeof requestAnimationFrame;
  globalThis.cancelAnimationFrame = (() => {}) as typeof cancelAnimationFrame;
});

/** Run the pending frame at `t` (each step schedules the next). */
function frame(t: number) {
  const pending = frames;
  frames = [];
  act(() => {
    for (const cb of pending) cb(t);
  });
}

/** How far the inner track has been moved up, px. */
function offset(container: HTMLElement): number {
  const inner = container.firstElementChild?.firstElementChild as HTMLElement;
  const m = /translate3d\(0, (-?[\d.]+)px, 0\)/.exec(inner.style.transform);
  return m ? -Number(m[1]) : 0;
}

/** Mount a 2 000-character body in a 120px window over 600px of content, then
 *  run: first frame, the top hold, then two seconds of travel. Returns how far
 *  it moved. Timestamps are non-zero — the loop treats t=0 as "no clock yet". */
function travelPx(cps: number): number {
  roCallback = null;
  frames = [];
  const body = "A".repeat(2000);
  const { container } = render(
    <ReadPaceContext.Provider value={cps}>
      <AutoScroll pause={1000} style={{ height: 120 }}>
        <div>{body}</div>
      </AutoScroll>
    </ReadPaceContext.Provider>,
  );
  const el = container.firstElementChild as HTMLElement;
  const inner = el.firstElementChild as HTMLElement;
  act(() => {
    roCallback?.([
      { target: el, contentRect: { height: 120 } },
      { target: inner, contentRect: { height: 600 } },
    ]);
  });
  frame(100);
  frame(1200); // the 1 000 ms top hold elapses
  frame(3200); // two seconds of travel
  return offset(container);
}

describe("AutoScroll", () => {
  it("scrolls at the channel's reading pace over its own content length", () => {
    // 2 000 characters over 600px at 15 cps ≈ 4.5 px/s.
    const expected = scrollPxPerSec(600, 2000, 15);
    expect(expected).toBeCloseTo(4.5, 1);
    expect(travelPx(15)).toBeCloseTo(expected * 2, 0);
  });

  it("moves further in the same time on a faster channel", () => {
    const slow = travelPx(12);
    cleanup();
    const fast = travelPx(24);
    expect(fast).toBeGreaterThan(slow);
    expect(slow).toBeCloseTo(scrollPxPerSec(600, 2000, 12) * 2, 0);
    expect(fast).toBeCloseTo(scrollPxPerSec(600, 2000, 24) * 2, 0);
  });

  it("sits still when the content fits the window", () => {
    roCallback = null;
    frames = [];
    const { container } = render(
      <AutoScroll pause={1000} style={{ height: 120 }}>
        <div>short</div>
      </AutoScroll>,
    );
    const el = container.firstElementChild as HTMLElement;
    const inner = el.firstElementChild as HTMLElement;
    act(() => {
      roCallback?.([
        { target: el, contentRect: { height: 120 } },
        { target: inner, contentRect: { height: 60 } },
      ]);
    });
    frame(100);
    frame(4000);
    expect(offset(container)).toBe(0);
  });
});
