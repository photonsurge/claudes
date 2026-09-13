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
import { RunPacingContext, type RunPacing } from "./run-pacing";

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

/** Run frames every second of wall clock from `from` to `to` — the loop makes
 *  at most one phase transition per frame, so a whole pass has to be stepped. */
function runFrames(from: number, to: number, stepMs = 1000) {
  for (let t = from; t <= to; t += stepMs) frame(t);
}

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

  /** Mount a body inside a deck that is counting `runs` runs through it. */
  function inDeck(runs: number, boxH: number, contentH: number, chars: number) {
    roCallback = null;
    frames = [];
    const done = jest.fn();
    const pacing: RunPacing = { runs, claim: () => () => {}, done };
    const { container } = render(
      <ReadPaceContext.Provider value={15}>
        <RunPacingContext.Provider value={pacing}>
          <AutoScroll pause={1000} paceDeck style={{ height: boxH }}>
            <div>{"A".repeat(chars)}</div>
          </AutoScroll>
        </RunPacingContext.Provider>
      </ReadPaceContext.Provider>,
    );
    const el = container.firstElementChild as HTMLElement;
    const inner = el.firstElementChild as HTMLElement;
    act(() => {
      roCallback?.([
        { target: el, contentRect: { height: boxH } },
        { target: inner, contentRect: { height: contentH } },
      ]);
    });
    return { container, done };
  }

  it("reports a run once an overflowing body has been shown end to end", () => {
    // 2 000 chars over 600px at 15 cps ≈ 4.5 px/s; 480px of overflow ≈ 107 s of
    // travel, with a 1 s hold either side.
    const { container, done } = inDeck(1, 120, 600, 2000);
    frame(100);
    frame(1200); // top hold done, travel starts
    frame(60_000);
    expect(done).not.toHaveBeenCalled(); // still mid-scroll — the deck must not cut it
    frame(120_000); // past the bottom
    frame(122_000); // bottom hold elapses
    expect(done).toHaveBeenCalledTimes(1);
    // Parked at the bottom rather than gliding back: that return only sets up
    // the next run, and under the deck's cross-fade it reads as a glitch.
    const parked = offset(container);
    frame(140_000);
    expect(offset(container)).toBeCloseTo(parked, 0);
    expect(parked).toBeCloseTo(480, 0);
  });

  it("takes two passes to report when the channel asks for two runs", () => {
    // One phase transition per frame, so the pass is stepped out here.
    // ~107 s down + 1 s hold + ~63 s back up + 1 s hold, twice over.
    const { done } = inDeck(2, 120, 600, 2000);
    runFrames(100, 175_000);
    expect(done).not.toHaveBeenCalled(); // first pass done, second still running
    runFrames(176_000, 360_000);
    expect(done).toHaveBeenCalledTimes(1);
  });

  it("counts a body that fits as one run of its own read time", () => {
    // 300 characters at 15 cps = 20 s to read; nothing scrolls.
    const { container, done } = inDeck(1, 120, 60, 300);
    frame(100);
    frame(10_000);
    expect(done).not.toHaveBeenCalled();
    frame(21_000);
    expect(done).toHaveBeenCalledTimes(1);
    expect(offset(container)).toBe(0);
  });

  it("never reports before it has been measured, so a slide can't advance on mount", () => {
    // No ResizeObserver delivery: an off-air slide under content-visibility
    // measures as zero, and calling that "fits" would turn the page instantly.
    roCallback = null;
    frames = [];
    const done = jest.fn();
    render(
      <RunPacingContext.Provider value={{ runs: 1, claim: () => () => {}, done }}>
        <AutoScroll pause={1000} paceDeck style={{ height: 120 }}>
          <div>short</div>
        </AutoScroll>
      </RunPacingContext.Provider>,
    );
    frame(100);
    frame(90_000);
    expect(done).not.toHaveBeenCalled();
  });

  it("loops forever off-deck, reporting nothing", () => {
    const { done } = inDeck(1, 120, 600, 2000);
    cleanup();
    roCallback = null;
    frames = [];
    const offDeck = jest.fn();
    const { container } = render(
      <RunPacingContext.Provider value={{ runs: 1, claim: () => () => {}, done: offDeck }}>
        {/* no paceDeck — the top-right advice window just loops */}
        <AutoScroll pause={1000} style={{ height: 120 }}>
          <div>{"A".repeat(2000)}</div>
        </AutoScroll>
      </RunPacingContext.Provider>,
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
    frame(300_000);
    expect(offDeck).not.toHaveBeenCalled();
    expect(done).not.toHaveBeenCalled();
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
