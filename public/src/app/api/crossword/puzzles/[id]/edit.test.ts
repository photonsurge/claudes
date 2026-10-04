/**
 * Puzzle edits without a layout search: a clue rewrite is cleaned and
 * validated; a drop keeps the other words in place, trims and renumbers, and
 * is refused when the rest falls apart or runs short.
 */
import { numberEntries, type CrosswordPuzzle } from "@photonsurge/shared/crossword";
import { dropEntry, editClue, isConnected } from "./edit";

/** CAT across, TOE down from its T, EGG across from TOE's E: a chain. */
const chainPuzzle = (): CrosswordPuzzle => ({
  id: "p1",
  title: "Chain",
  theme: "",
  width: 5,
  height: 3,
  status: "draft",
  source: "seed",
  createdAt: 1,
  plays: [],
  entries: numberEntries([
    { answer: "CAT", clue: "Feline pet", row: 0, col: 0, dir: "across" },
    { answer: "TOE", clue: "Digit on a foot", row: 0, col: 2, dir: "down" },
    { answer: "EGG", clue: "Breakfast oval", row: 2, col: 2, dir: "across" },
  ]),
});

describe("editClue", () => {
  it("cleans the clue and saves it", () => {
    const res = editClue(chainPuzzle(), "1A", "  Purring   house pet (3) ");
    expect(res.ok && res.puzzle.entries.find((e) => e.id === "1A")!.clue).toBe("Purring house pet");
  });

  it.each([
    ["Pet", /under 8/],
    ["A".repeat(49), /over 48/],
    ["Catnap taker, perhaps", /gives the answer away/],
    ["Feline pet", null],
  ])("%s", (clue, problem) => {
    const res = editClue(chainPuzzle(), "1A", clue);
    if (problem) expect(!res.ok && res.error).toMatch(problem);
    else expect(res.ok).toBe(true);
  });

  it("honours an extra blocklist term", () => {
    const res = editClue(chainPuzzle(), "1A", "Fluffy household animal", ["fluffy"]);
    expect(!res.ok && res.error).toMatch(/blocklist/);
  });

  it("refuses an unknown entry", () => {
    expect(editClue(chainPuzzle(), "9A", "Feline pet").ok).toBe(false);
  });
});

describe("dropEntry", () => {
  it("drops an end word, trims the empty columns and renumbers", () => {
    const res = dropEntry(chainPuzzle(), "1A", 2);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.puzzle.width).toBe(3);
    expect(res.puzzle.height).toBe(3);
    expect(res.puzzle.entries.map((e) => [e.id, e.answer, e.row, e.col, e.clue])).toEqual([
      ["2A", "EGG", 2, 0, "Breakfast oval"],
      ["1D", "TOE", 0, 0, "Digit on a foot"],
    ]);
  });

  it("refuses a drop that splits the grid, suggesting Generate", () => {
    const res = dropEntry(chainPuzzle(), "2D", 2);
    expect(res.ok).toBe(false);
    expect(!res.ok && res.error).toMatch(/splits the grid.*Generate/);
  });

  it("refuses a drop below the minimum word count", () => {
    const res = dropEntry(chainPuzzle(), "1A", 3);
    expect(!res.ok && res.error).toMatch(/leaves 2 words, under the minimum of 3.*Generate/);
  });

  it("isConnected sees shared cells", () => {
    const p = chainPuzzle();
    expect(isConnected(p.entries)).toBe(true);
    expect(isConnected(p.entries.filter((e) => e.id !== "2D"))).toBe(false);
  });
});
