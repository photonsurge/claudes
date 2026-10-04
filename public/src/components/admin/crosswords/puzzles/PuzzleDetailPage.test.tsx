/**
 * PuzzleDetailPage — over a faked API: the grid shows every answer, a clue is
 * edited, a refused drop shows the route's message, and Approve flips status.
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
    theme: "Pets",
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
  };
  global.fetch = jest.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const json = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body }) as Response;
    if (String(url) !== "/api/crossword/puzzles/p1") return json({ error: "nope" }, 404);
    if (init?.method !== "PATCH") return json(puzzle);
    const body = JSON.parse(String(init.body));
    patches.push(body);
    if (body.action === "approve") return json((puzzle = { ...puzzle, status: "ready" }));
    if (body.action === "drop") return json({ error: "Dropping 2D splits the grid into pieces. Generate a new puzzle instead." }, 422);
    if (body.action === "clue") {
      puzzle = { ...puzzle, entries: puzzle.entries.map((e) => (e.id === body.entryId ? { ...e, clue: body.clue } : e)) };
      return json(puzzle);
    }
    return json({ error: "bad" }, 400);
  }) as typeof fetch;
});

it("shows the grid with answers and links each word to Words", async () => {
  render(<PuzzleDetailPage id="p1" />);
  const grid = await screen.findByRole("grid");
  expect(within(grid).getAllByRole("gridcell").map((c) => c.textContent?.replace(/\d/g, "")).join("")).toBe("CATOEGG");
  expect(screen.getByRole("link", { name: "CAT" })).toHaveAttribute("href", "/admin/crosswords/words?q=CAT");
});

it("saves an edited clue", async () => {
  render(<PuzzleDetailPage id="p1" />);
  const input = await screen.findByLabelText("Clue for 1A");
  fireEvent.change(input, { target: { value: "Purring pet" } });
  const row = input.closest("tr")!;
  await act(async () => {
    fireEvent.click(within(row).getByRole("button", { name: "Save" }));
  });
  expect(patches).toContainEqual({ action: "clue", entryId: "1A", clue: "Purring pet" });
  expect(screen.getByLabelText("Clue for 1A")).toHaveValue("Purring pet");
});

it("shows a refused drop's message", async () => {
  jest.spyOn(window, "confirm").mockReturnValue(true);
  render(<PuzzleDetailPage id="p1" />);
  const row = (await screen.findByLabelText("Clue for 2D")).closest("tr")!;
  await act(async () => {
    fireEvent.click(within(row).getByRole("button", { name: "Drop" }));
  });
  expect(await screen.findByText(/splits the grid/)).toBeInTheDocument();
});

it("approves", async () => {
  render(<PuzzleDetailPage id="p1" />);
  await screen.findByRole("grid");
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
  });
  expect(patches).toContainEqual({ action: "approve" });
  expect(screen.getByRole("button", { name: "Approve" })).toBeDisabled();
  expect(screen.getByText("ready")).toBeInTheDocument();
});
