/**
 * PuzzleDetailPage — over a faked API: the grid shows every answer, words link
 * to Words, the family-friendly chip shows, and Reject flips status.
 * There is no clue edit, drop or approve.
 */
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { numberEntries, type CrosswordPuzzle } from "@photonsurge/shared/crossword";
import PuzzleDetailPage from "./PuzzleDetailPage";

jest.mock("next/link", () => ({
  __esModule: true,
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

let puzzle: CrosswordPuzzle;
const patches: unknown[] = [];

beforeEach(() => {
  patches.length = 0;
  puzzle = {
    id: "p1",
    title: "Chain",
    width: 5,
    height: 3,
    status: "ready",
    familyFriendly: true,
    source: "seed",
    createdAt: 1,
    plays: [],
    entries: numberEntries([
      { answer: "CAT", clue: "Feline pet", row: 0, col: 0, dir: "across" },
      { answer: "TOE", clue: "Digit on a foot", row: 0, col: 2, dir: "down" },
      { answer: "EGG", clue: "Breakfast oval", row: 2, col: 2, dir: "across" },
    ]),
  };
  global.fetch = jest.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const json = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body }) as Response;
    if (String(url) !== "/api/crossword/puzzles/p1") return json({ error: "nope" }, 404);
    if (init?.method !== "PATCH") return json(puzzle);
    const body = JSON.parse(String(init.body));
    patches.push(body);
    if (body.action === "reject") return json((puzzle = { ...puzzle, status: "rejected" }));
    return json({ error: "bad" }, 400);
  }) as typeof fetch;
});

it("shows the grid with answers and the family-friendly chip", async () => {
  render(<PuzzleDetailPage id="p1" />);
  const grid = await screen.findByRole("grid");
  expect(within(grid).getAllByRole("gridcell").map((c) => c.textContent?.replace(/\d/g, "")).join("")).toBe("CATOEGG");
  expect(screen.getByText("Family friendly")).toBeInTheDocument();
});

it("links each word to its Words page, a seed entry to a search", async () => {
  puzzle = {
    ...puzzle,
    entries: puzzle.entries.map((e, i) => ({ ...e, wordId: i === 0 ? "seed:cat" : `w${i}` })),
  };
  render(<PuzzleDetailPage id="p1" />);
  await screen.findByRole("grid");
  expect(screen.getByRole("link", { name: "CAT" })).toHaveAttribute("href", "/admin/crosswords/words?q=CAT");
  expect(screen.getByRole("link", { name: "TOE" })).toHaveAttribute("href", "/admin/crosswords/words/w2");
});

it("has no clue editing, drop or approve", async () => {
  render(<PuzzleDetailPage id="p1" />);
  await screen.findByRole("grid");
  expect(screen.queryByRole("textbox")).toBeNull();
  for (const name of ["Save", "Drop", "Approve"]) expect(screen.queryByRole("button", { name })).toBeNull();
});

it("rejects, with no way back", async () => {
  render(<PuzzleDetailPage id="p1" />);
  await screen.findByRole("grid");
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Reject" }));
  });
  expect(patches).toContainEqual({ action: "reject" });
  expect(screen.getByText("rejected")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Reject" })).toBeDisabled();
  expect(screen.queryByRole("button", { name: "Restore" })).toBeNull();
});
