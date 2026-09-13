/**
 * The ACTIVE FEED marquee owns its WORLD REPORT slide's clock: one LAP — every
 * row shown once — is one run, and the deck turns the page after the channel's
 * `reportRuns` laps. This was the worst pacing bug on the page before: a 20-row
 * feed stepping a row every ~3 s needs a full minute to come round, but the deck
 * flipped on a blind 6 s dwell, so most of the feed was never seen.
 */
import { act, cleanup, render } from "@testing-library/react";
import { feedRowMs } from "@photonsurge/shared/reading-pace";
import WorldFeed, { FEED_ROW_H } from "./WorldFeed";
import { ReadPaceContext } from "./pace-context";
import { RunPacingContext, type RunPacing } from "./run-pacing";
import type { WorldWatchItem } from "../../lib/broadcast";

let frames: FrameRequestCallback[] = [];

beforeEach(() => {
  frames = [];
  globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
    frames.push(cb);
    return frames.length;
  }) as typeof requestAnimationFrame;
  globalThis.cancelAnimationFrame = (() => {}) as typeof cancelAnimationFrame;
});
afterEach(cleanup);

function frame(t: number) {
  const pending = frames;
  frames = [];
  act(() => {
    for (const cb of pending) cb(t);
  });
}

/** `n` rows of identical length, so the mean row length (and so the step) is exact. */
function items(n: number): WorldWatchItem[] {
  return Array.from({ length: n }, (_, i) => ({
    key: `k${i}`,
    kind: "quake" as const,
    color: "#fff",
    tag: `M5.${i % 10}`,
    glyph: "quake" as const,
    flag: "",
    title: "Somewhere in the ocean",
    sub: "120km SW of nowhere",
    weight: 1,
    sortTime: i,
  }));
}

/** The marquee's step for these fixture rows: the row's read time at 15 cps. */
function rowStep(): number {
  const row = items(1)[0];
  return feedRowMs(row.title.length + row.sub.length, 15);
}

function mount(rows: number, visible: number, runs: number) {
  const done = jest.fn();
  const pacing: RunPacing = { runs, claim: () => () => {}, done };
  render(
    <ReadPaceContext.Provider value={15}>
      <RunPacingContext.Provider value={pacing}>
        <WorldFeed items={items(rows)} visible={visible} paceDeck />
      </RunPacingContext.Provider>
    </ReadPaceContext.Provider>,
  );
  return done;
}

describe("WorldFeed run pacing", () => {
  it("reports a run only once every row has been on screen", () => {
    const rows = 20;
    const visible = 4;
    const done = mount(rows, visible, 1);
    // One row step is that row's read time at the channel's pace — the marquee
    // paces off the title + sub line, which is what a viewer reads as it passes.
    const step = rowStep();
    expect(step).toBeGreaterThan(0);
    const lapRows = rows - visible + 1;

    frame(0);
    // Two rows in — the old blind dwell would already have turned the page here.
    frame(step * 2 + 1);
    expect(done).not.toHaveBeenCalled();
    // One row short of the whole lap.
    frame(step * (lapRows - 1) + 1);
    expect(done).not.toHaveBeenCalled();
    frame(step * lapRows + 1);
    expect(done).toHaveBeenCalled();
  });

  it("takes two laps when the channel asks for two runs", () => {
    const rows = 10;
    const visible = 4;
    const done = mount(rows, visible, 2);
    const step = rowStep();
    const lapRows = rows - visible + 1;
    frame(0);
    frame(step * lapRows + 1);
    expect(done).not.toHaveBeenCalled();
    frame(step * lapRows * 2 + 1);
    expect(done).toHaveBeenCalled();
  });

  it("claims nothing when the feed is short enough to sit still", () => {
    // Nothing scrolls, so there is no lap to count — the slide falls back to the
    // channel's dwell, exactly as it behaved before.
    const done = mount(3, 7, 1);
    frame(0);
    frame(600_000);
    expect(done).not.toHaveBeenCalled();
  });

  it("reports nothing off-deck", () => {
    const done = jest.fn();
    render(
      <ReadPaceContext.Provider value={15}>
        <RunPacingContext.Provider value={{ runs: 1, claim: () => () => {}, done }}>
          {/* no paceDeck */}
          <WorldFeed items={items(20)} visible={4} />
        </RunPacingContext.Provider>
      </ReadPaceContext.Provider>,
    );
    frame(0);
    frame(600_000);
    expect(done).not.toHaveBeenCalled();
  });

  it("keeps the row height the window is sized from", () => {
    expect(FEED_ROW_H).toBeGreaterThan(0);
  });
});
