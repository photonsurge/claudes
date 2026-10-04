/**
 * The on-air components, from the plan (§4.3, §4.4, §5): the grid draws only
 * the letters the projection shows; the phase picks the card (intro with the
 * puzzle number and word count, the finale with the podium and how many the
 * host had to solve, a holding card when idle); HowToStrip says the host is
 * playing a demo round when no live chat is attached.
 */
import { render } from "@testing-library/react";
import { emptyGame } from "@photonsurge/shared/crossword";
import Grid from "./Grid";
import CrosswordSurface from "./CrosswordSurface";
import HowToStrip from "./HowToStrip";
import { HIDDEN_ANSWERS, PUZZLE, SHOWN_LETTERS, finalePub, pub } from "./plan.fixture";

const text = (el: Element) => el.textContent ?? "";

describe("Grid", () => {
  it("draws exactly the letters the projection shows", () => {
    const s = pub();
    const { container } = render(<Grid rows={s.rows} entries={s.entries} spotlightId="2D" cell={64} puzzleKey={42} />);
    const letters = text(container).replace(/[^A-Z]/g, "").split("").sort();
    expect(letters).toEqual(SHOWN_LETTERS);
  });

  it("draws no letter when nothing is shown", () => {
    const s = pub({ hints: [], solved: {}, scores: {}, feed: [] });
    const { container } = render(<Grid rows={s.rows} entries={s.entries} cell={64} puzzleKey={42} />);
    expect(text(container).replace(/[^A-Z]/g, "")).toBe("");
  });

  it("draws a solved word in full once the projection carries it", () => {
    const s = finalePub();
    const { container } = render(<Grid rows={s.rows} entries={s.entries} cell={64} puzzleKey={42} />);
    const letters = text(container).replace(/[^A-Z]/g, "");
    // 5 + 4 + 4 letters, less the two shared cells.
    expect(letters).toHaveLength(11);
  });
});

describe("CrosswordSurface while playing", () => {
  it("puts no unsolved answer anywhere on the frame", () => {
    const { container } = render(<CrosswordSurface state={pub()} offset={0} brand="Grid Night" />);
    for (const a of HIDDEN_ANSWERS) expect(text(container)).not.toContain(a);
    expect(text(container)).toContain("Smallest unit of an element");
  });
});

describe("phase cards", () => {
  it("intro: the puzzle number and the word count", () => {
    const s = pub({ phase: "intro", spotlight: null, hints: [], solved: {}, scores: {}, feed: [], phaseEndsAt: 12_000 });
    const { container } = render(<CrosswordSurface state={s} offset={0} brand="Grid Night" />);
    const t = text(container);
    expect(t).toMatch(/Puzzle\s*42/);
    expect(t).toMatch(new RegExp(`(^|\\D)${PUZZLE.entries.length}\\s*words?`, "i"));
    // No clue is given away on the title card.
    expect(t).not.toContain("Building block of a proton");
  });

  it("finale: the podium names and points, and how many words the host filled", () => {
    const s = finalePub();
    const { container } = render(<CrosswordSurface state={s} offset={0} brand="Grid Night" />);
    const t = text(container);
    expect(t).toContain("rich");
    expect(t).toContain("ann");
    expect(t.indexOf("rich")).toBeGreaterThanOrEqual(0);
    expect(t).toMatch(/host[^0-9]*1\b/i);
  });

  it("finale: says so when the audience solved every word", () => {
    const s = finalePub({
      solved: {
        "1D": { by: "sim:rich", name: "rich", at: 400, points: 4 },
        "2D": { by: "sim:ann", name: "ann", at: 600, points: 3 },
        "1A": { by: "sim:ann", name: "ann", at: 900, points: 3 },
      },
    });
    const { container } = render(<CrosswordSurface state={s} offset={0} brand="Grid Night" />);
    expect(text(container)).not.toMatch(/host[^0-9]*[1-9]\b/i);
  });

  it("idle: a holding card with the brand, no grid and no clues", () => {
    const { container } = render(<CrosswordSurface state={emptyGame("xw", 0).pub} offset={0} brand="Grid Night" />);
    const t = text(container);
    expect(t).toContain("Grid Night");
    expect(t).not.toMatch(/ACROSS/i);
    expect(t.replace(/Grid Night|Crossword/gi, "").length).toBeGreaterThan(0);
    expect(container.querySelectorAll("[data-testid^='cw-cell']").length).toBe(0);
  });

  it("before the first state lands: the holding card, not a blank frame", () => {
    const { container } = render(<CrosswordSurface state={null} offset={0} brand="Grid Night" />);
    expect(text(container)).toContain("Grid Night");
  });
});

describe("HowToStrip", () => {
  it("says the host is playing a demo round when input is not live", () => {
    const { container } = render(<HowToStrip inputLive={false} />);
    expect(text(container)).toMatch(/demo/i);
    expect(text(container)).toMatch(/host/i);
  });

  it("tells viewers to answer in chat when input is live, without the demo wording", () => {
    const { container } = render(<HowToStrip inputLive />);
    expect(text(container)).toMatch(/chat/i);
    expect(text(container)).not.toMatch(/demo/i);
  });

  it("the surface's strip follows the state's inputLive", () => {
    const off = render(<CrosswordSurface state={pub({}, { inputLive: false })} offset={0} brand="B" />);
    expect(text(off.container)).toMatch(/demo/i);
    off.unmount();
    const on = render(<CrosswordSurface state={pub({}, { inputLive: true })} offset={0} brand="B" />);
    expect(text(on.container)).not.toMatch(/demo/i);
  });
});
