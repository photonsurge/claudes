/**
 * Plan §8.3 — one puzzle, over a faked API: the grid with its answers, the
 * family-friendly chip, each word linking to its page in Words, and Reject.
 * No approve, no clue edit, no drop (§7.4: approval is on words and clues).
 */
import { configure, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { numberEntries, type CrosswordPuzzle } from "@photonsurge/shared/crossword";
import PuzzleDetailPage from "./PuzzleDetailPage";

// MUI pages render slowly when the whole suite runs in parallel.
configure({ asyncUtilTimeout: 5000 });

jest.mock("next/link", () => ({
  __esModule: true,
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

let puzzle: CrosswordPuzzle;
const sent: { method: string; url: string; body?: unknown }[] = [];

beforeEach(() => {
  sent.length = 0;
  puzzle = {
    id: "p1",
    title: "Chain",
    width: 5,
    height: 3,
    status: "ready",
    familyFriendly: true,
    source: "bank",
    createdAt: 1,
    plays: [{ sceneId: "xw", startedAt: 5 }],
    entries: numberEntries([
      { answer: "CAT", clue: "Feline pet", row: 0, col: 0, dir: "across" },
      { answer: "TOE", clue: "Digit on a foot", row: 0, col: 2, dir: "down" },
      { answer: "EGG", clue: "Breakfast oval", row: 2, col: 2, dir: "across" },
    ]).map((e) => ({ ...e, wordId: `word-${e.answer.toLowerCase()}`, clueId: `clue-${e.answer.toLowerCase()}` })),
  };
  global.fetch = jest.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const u = String(url);
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    sent.push({ method, url: u, body });
    const json = (b: unknown, status = 200) => ({ ok: status < 400, status, json: async () => b }) as Response;
    if (u !== "/api/crossword/puzzles/p1") return json({ error: "nope" }, 404);
    if (method === "GET") return json(puzzle);
    if (method === "PATCH" && (body as { action?: string })?.action === "reject") return json((puzzle = { ...puzzle, status: "rejected" }));
    return json({ error: "bad" }, 400);
  }) as typeof fetch;
});

it("shows the grid with every answer and the clues", async () => {
  render(<PuzzleDetailPage id="p1" />);
  const grid = await screen.findByRole("grid");
  const letters = within(grid)
    .getAllByRole("gridcell")
    .map((c) => (c.textContent ?? "").replace(/\d/g, ""))
    .join("");
  expect(letters).toBe("CATOEGG");
  for (const clue of ["Feline pet", "Digit on a foot", "Breakfast oval"]) expect(screen.getByText(clue)).toBeInTheDocument();
});

it("shows the family-friendly chip, and not on an untagged puzzle", async () => {
  const { unmount } = render(<PuzzleDetailPage id="p1" />);
  await screen.findByRole("grid");
  expect(screen.getByText(/^family[- ]friendly$/i)).toBeInTheDocument();
  unmount();
  puzzle = { ...puzzle, familyFriendly: false };
  render(<PuzzleDetailPage id="p1" />);
  await screen.findByRole("grid");
  expect(screen.queryByText(/^family[- ]friendly$/i)).toBeNull();
});

it("links each word to its page in Words", async () => {
  render(<PuzzleDetailPage id="p1" />);
  await screen.findByRole("grid");
  for (const w of ["cat", "toe", "egg"]) {
    expect(screen.getByRole("link", { name: w.toUpperCase() })).toHaveAttribute("href", `/admin/crosswords/words/word-${w}`);
  }
});

it("Reject sends { action: 'reject' } and shows the puzzle rejected", async () => {
  render(<PuzzleDetailPage id="p1" />);
  await screen.findByRole("grid");
  fireEvent.click(screen.getByRole("button", { name: /reject/i }));
  await waitFor(() => expect(sent.some((s) => s.method === "PATCH")).toBe(true));
  expect(sent.filter((s) => s.method === "PATCH").map((s) => s.body)).toEqual([{ action: "reject" }]);
  expect(await screen.findByText("rejected")).toBeInTheDocument();
});

it("offers no approve, clue edit or drop", async () => {
  render(<PuzzleDetailPage id="p1" />);
  await screen.findByRole("grid");
  expect(screen.queryByRole("button", { name: /approve|edit|drop|remove|save/i })).toBeNull();
  expect(screen.queryByRole("textbox")).toBeNull();
});
