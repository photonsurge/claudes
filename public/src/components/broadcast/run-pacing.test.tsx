/**
 * The rotation clock both decks share: a slide's moving part claims the clock
 * and reports its finished runs, and the deck turns the page then — never before
 * the floor, never after the ceiling. A page nothing claims falls back to the
 * floor, which is exactly the blind dwell both decks used to run on.
 */
import { act, render } from "@testing-library/react";
import { useEffect } from "react";
import { RunPacingContext, useRunClock, useRunClaim, type RunPacing } from "./run-pacing";

/** A deck of one page whose key the test controls, reporting advances. */
function Deck({
  pageKey,
  floorMs,
  ceilingMs,
  onAdvance,
  children,
}: {
  pageKey: string;
  floorMs: number;
  ceilingMs: number;
  onAdvance: () => void;
  children?: (pacing: RunPacing) => React.ReactNode;
}) {
  const pacing = useRunClock({ key: pageKey, floorMs, ceilingMs, runs: 1, onAdvance });
  return <RunPacingContext.Provider value={pacing}>{children?.(pacing)}</RunPacingContext.Provider>;
}

/** A slide body that claims the clock and reports when the test says so. */
function Claimer({ report }: { report: { fn?: () => void } }) {
  const { done } = useRunClaim(true);
  useEffect(() => {
    report.fn = done;
  }, [done, report]);
  return <div>claimed</div>;
}

describe("useRunClock", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it("turns the page on the floor when nothing claims the clock", () => {
    const onAdvance = jest.fn();
    render(<Deck pageKey="p0" floorMs={5000} ceilingMs={40000} onAdvance={onAdvance} />);
    act(() => void jest.advanceTimersByTime(4999));
    expect(onAdvance).not.toHaveBeenCalled();
    act(() => void jest.advanceTimersByTime(2));
    expect(onAdvance).toHaveBeenCalledTimes(1);
  });

  it("waits past the floor for a claimed page, and turns on its report", () => {
    const onAdvance = jest.fn();
    const report: { fn?: () => void } = {};
    render(
      <Deck pageKey="p0" floorMs={5000} ceilingMs={40000} onAdvance={onAdvance}>
        {() => <Claimer report={report} />}
      </Deck>,
    );
    act(() => void jest.advanceTimersByTime(20000));
    expect(onAdvance).not.toHaveBeenCalled(); // the body is still showing itself
    act(() => report.fn?.());
    expect(onAdvance).toHaveBeenCalledTimes(1);
  });

  it("serves out the floor when a claimed page finishes early", () => {
    const onAdvance = jest.fn();
    const report: { fn?: () => void } = {};
    render(
      <Deck pageKey="p0" floorMs={5000} ceilingMs={40000} onAdvance={onAdvance}>
        {() => <Claimer report={report} />}
      </Deck>,
    );
    act(() => void jest.advanceTimersByTime(1000));
    act(() => report.fn?.());
    expect(onAdvance).not.toHaveBeenCalled(); // a one-line card must not flash past
    act(() => void jest.advanceTimersByTime(4000));
    expect(onAdvance).toHaveBeenCalledTimes(1);
  });

  it("turns the page at the ceiling when a claimed page never reports", () => {
    const onAdvance = jest.fn();
    const report: { fn?: () => void } = {};
    render(
      <Deck pageKey="p0" floorMs={5000} ceilingMs={20000} onAdvance={onAdvance}>
        {() => <Claimer report={report} />}
      </Deck>,
    );
    act(() => void jest.advanceTimersByTime(19999));
    expect(onAdvance).not.toHaveBeenCalled();
    act(() => void jest.advanceTimersByTime(2));
    expect(onAdvance).toHaveBeenCalledTimes(1);
  });

  it("advances a page only once, however many times its body reports", () => {
    const onAdvance = jest.fn();
    const report: { fn?: () => void } = {};
    render(
      <Deck pageKey="p0" floorMs={1000} ceilingMs={40000} onAdvance={onAdvance}>
        {() => <Claimer report={report} />}
      </Deck>,
    );
    act(() => void jest.advanceTimersByTime(2000));
    act(() => {
      report.fn?.();
      report.fn?.();
      report.fn?.();
    });
    expect(onAdvance).toHaveBeenCalledTimes(1);
  });

  it("ignores a late report from the page that just left air", () => {
    const onAdvance = jest.fn();
    const report: { fn?: () => void } = {};
    const { rerender } = render(
      <Deck pageKey="p0" floorMs={5000} ceilingMs={40000} onAdvance={onAdvance}>
        {() => <Claimer report={report} />}
      </Deck>,
    );
    act(() => void jest.advanceTimersByTime(1000));
    const stale = report.fn!;
    // A director cut rewinds the deck: a report scheduled against the old page
    // must not hand the incoming slide the outgoing one's advance.
    rerender(
      <Deck pageKey="p1" floorMs={5000} ceilingMs={40000} onAdvance={onAdvance}>
        {() => <Claimer report={report} />}
      </Deck>,
    );
    act(() => stale());
    act(() => void jest.advanceTimersByTime(4000));
    expect(onAdvance).not.toHaveBeenCalled();
  });
});
