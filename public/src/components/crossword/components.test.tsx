import { render, screen, within } from "@testing-library/react";
import type { CrosswordPublicEntry, CrosswordPublicState } from "@photonsurge/shared/crossword";
import Grid from "./Grid";
import { ACCENT, BLOCK, CELL_SOLVED } from "./styles";
import SpotlightCard, { entryPattern } from "./SpotlightCard";
import CrosswordSurface, { cellSize } from "./CrosswordSurface";
import * as L from "./layout";
import { hostFilled } from "./FinaleCard";
import HowToStrip from "./HowToStrip";
import { clockOffset } from "../../lib/crossword";

// 3×3 board: 1 across CAT on row 0 (solved), 2 down ASH from (0,1) with a hint S.
const entries: CrosswordPublicEntry[] = [
  { id: "1A", num: 1, dir: "across", row: 0, col: 0, length: 3, clue: "Purring pet", solved: { name: "rich", points: 3 } },
  { id: "2D", num: 2, dir: "down", row: 0, col: 1, length: 3, clue: "Volcano dust" },
];
const rows = ["CAT", "#S#", "#.#"];

const pub = (p: Partial<CrosswordPublicState> = {}): CrosswordPublicState => ({
  sceneId: "xw",
  seq: 4,
  serverNow: 0,
  phase: "playing",
  phaseEndsAt: 0,
  puzzleNo: 42,
  title: "Volcanoes",
  width: 3,
  height: 3,
  rows,
  entries,
  spotlight: { entryId: "2D", startedAt: 0, endsAt: 60_000 },
  scores: [{ name: "rich", points: 3, words: 1 }],
  today: [{ name: "rich", points: 10 }],
  feed: [{ at: 1, text: "rich took 1 across +3" }],
  inputLive: true,
  paused: false,
  ...p,
});

describe("Grid", () => {
  it("renders the shown letters only: blocks empty, unshown cells blank", () => {
    render(<Grid rows={rows} entries={entries} spotlightId="2D" cell={40} puzzleKey={1} />);
    const letters = screen.getAllByTestId("cw-letter").map((n) => n.textContent);
    expect(letters).toEqual(["C", "A", "T", "S"]);
    expect(screen.getByTestId("cw-cell-2-1").textContent).toBe("");
    expect(screen.getByTestId("cw-cell-1-0")).toHaveAttribute("data-block");
    // Numbers sit on the starting cells.
    expect(screen.getByTestId("cw-cell-0-0").textContent).toBe("1C");
    expect(screen.getByTestId("cw-cell-0-1").textContent).toBe("2A");
  });

  it("draws from the theme variables, never the weather tokens", () => {
    const { container } = render(<Grid rows={rows} entries={entries} cell={40} puzzleKey={1} />);
    expect(container.innerHTML).not.toContain("gods");
    expect(BLOCK).toBe("var(--cw-block)");
    expect(CELL_SOLVED).toBe("var(--cw-cell-solved)");
    expect(ACCENT).toBe("var(--cw-accent)");
  });

  it("flashes a word solved while on screen, not one already solved at load", () => {
    const open = entries.map((e) => (e.id === "2D" ? e : { ...e, solved: undefined }));
    const { container, rerender } = render(<Grid rows={rows} entries={entries} cell={40} puzzleKey={1} />);
    const flashes = () => container.querySelectorAll('[style*="cwFlash"]').length;
    expect(flashes()).toBe(0);
    rerender(<Grid rows={rows} entries={[...entries.slice(0, 1), { ...entries[1], solved: { name: "x", points: 1 } }]} cell={40} puzzleKey={1} />);
    expect(flashes()).toBe(3);
    // A new puzzle starts clean.
    rerender(<Grid rows={rows} entries={open} cell={40} puzzleKey={2} />);
    expect(flashes()).toBe(0);
  });
});

describe("SpotlightCard", () => {
  afterEach(() => jest.useRealTimers());

  it("shows the clue, its letters so far and the countdown from serverNow", () => {
    jest.useFakeTimers();
    jest.setSystemTime(100_000);
    // Server clock 5 s ahead of this box; spotlight ends at server 129 s → 24 s left.
    const offset = clockOffset(105_000, 100_000);
    render(
      <SpotlightCard
        entry={entries[1]}
        spotlight={{ entryId: "2D", startedAt: 69_000, endsAt: 129_000 }}
        rows={rows}
        offset={offset}
        paused={false}
      />,
    );
    expect(screen.getByText("Volcano dust")).toBeInTheDocument();
    expect(screen.getByText(/2 DOWN · 3 letters/)).toBeInTheDocument();
    expect(screen.getByTestId("cw-countdown").textContent).toBe("0:24");
    expect(entryPattern(entries[1], rows)).toEqual(["A", "S", null]);
  });

  it("reads PAUSED while the game is paused", () => {
    render(<SpotlightCard entry={entries[1]} spotlight={pub().spotlight} rows={rows} offset={0} paused />);
    expect(screen.getByTestId("cw-countdown").textContent).toBe("PAUSED");
  });

  it("says who took the word during its beat", () => {
    render(<SpotlightCard entry={entries[0]} spotlight={{ entryId: "1A", startedAt: 0, endsAt: 1 }} rows={rows} offset={0} paused={false} />);
    expect(screen.getByTestId("cw-spotlight-solved").textContent).toContain("rich");
    expect(screen.queryByTestId("cw-countdown")).toBeNull();
  });
});

describe("CrosswordSurface", () => {
  it("holds with no state and for idle", () => {
    const { rerender } = render(<CrosswordSurface state={null} offset={0} brand="G.O.D.S." />);
    expect(screen.getByTestId("cw-holding")).toBeInTheDocument();
    rerender(<CrosswordSurface state={pub({ phase: "idle", width: 0, height: 0, rows: [], entries: [] })} offset={0} brand="G.O.D.S." />);
    expect(screen.getByTestId("cw-holding")).toBeInTheDocument();
  });

  it("plays: header counts, grid, spotlight, clue list", () => {
    render(<CrosswordSurface state={pub()} offset={0} brand="G.O.D.S." />);
    expect(screen.getByText(/of 2 solved/)).toBeInTheDocument();
    expect(screen.getByText("Puzzle 42")).toBeInTheDocument();
    expect(screen.getByTestId("cw-grid")).toBeInTheDocument();
    expect(within(screen.getByTestId("cw-spotlight")).getByText("Volcano dust")).toBeInTheDocument();
    expect(screen.getByTestId("cw-clue-1A").textContent).toContain("rich +3");
    expect(screen.queryByTestId("cw-paused")).toBeNull();
  });

  it("shows the intro card, the paused chip and the finale with the host count", () => {
    const { rerender } = render(<CrosswordSurface state={pub({ phase: "intro" })} offset={0} brand="B" />);
    expect(screen.getByTestId("cw-intro").textContent).toContain("Volcanoes");
    expect(screen.getByTestId("cw-intro").textContent).toContain("2 words");

    rerender(<CrosswordSurface state={pub({ paused: true })} offset={0} brand="B" />);
    expect(screen.getByTestId("cw-paused")).toBeInTheDocument();

    const finished = [entries[0], { ...entries[1], solved: { name: "Host", points: 0 } }];
    rerender(<CrosswordSurface state={pub({ phase: "finale", entries: finished, rows: ["CAT", "#S#", "#H#"] })} offset={0} brand="B" />);
    expect(screen.getByTestId("cw-finale-host").textContent).toBe("The host had to fill 1 of 2");
    expect(hostFilled(finished)).toBe(1);
  });
});

describe("cellSize", () => {
  it("starts at 64 px and shrinks to fit a large puzzle", () => {
    expect(cellSize(9, 9)).toBe(64);
    expect(cellSize(13, 13)).toBeLessThan(64);
    expect(cellSize(13, 13) * 13).toBeLessThanOrEqual(752);
  });
});

describe("HowToStrip", () => {
  it("invites answers with live chat, and says demo without", () => {
    const { rerender } = render(<HowToStrip inputLive />);
    expect(screen.getByTestId("cw-howto").textContent).toContain("Type your answer in the chat");
    rerender(<HowToStrip inputLive={false} />);
    expect(screen.getByTestId("cw-howto").textContent).toContain("DEMO ROUND");
  });
});

describe("fit at the plan's caps", () => {
  it("the right column's boxes add up to the body", () => {
    expect(L.SPOT_H + L.BOTTOM_H + L.LIST_H + L.RIGHT_GAP * 2).toBe(L.BODY_H);
    expect(L.BODY_TOP + L.BODY_H + L.GAP + L.FOOTER_H + L.PAD).toBe(L.FRAME_H);
    expect(L.PAD * 3 + L.GRID_COL_W + L.RIGHT_W).toBe(L.FRAME_W);
  });

  it("13 columns fit the grid column at a useful cell size", () => {
    expect(cellSize(13, 13) * 13 + L.GRID_PAD * 2).toBeLessThanOrEqual(L.GRID_COL_W);
    expect(cellSize(13, 13)).toBeGreaterThanOrEqual(56);
  });

  it("16 clues of 48 characters split 8/8 fit the list, credit line included", () => {
    const f = L.clueFontSize(8);
    expect(f).toBeGreaterThanOrEqual(16);
    expect(L.clueColumnHeight(8, f)).toBeLessThanOrEqual(L.LIST_CONTENT_H);
    // Even a lopsided 10-row column still fits at some size.
    expect(L.clueColumnHeight(10, L.clueFontSize(10))).toBeLessThanOrEqual(L.LIST_CONTENT_H);
  });

  it("the bottom plate holds its rows", () => {
    const content = L.BOTTOM_H - 24; // 12 px padding top and bottom
    const table = 16 * 1.2 + 6 + L.BOTTOM_ROWS * (20 * 1.2 + 6);
    const feed = 16 * 1.2 + 6 + L.BOTTOM_ROWS * (18 * 1.25 + 6);
    expect(Math.max(table, feed)).toBeLessThanOrEqual(content);
  });
});
