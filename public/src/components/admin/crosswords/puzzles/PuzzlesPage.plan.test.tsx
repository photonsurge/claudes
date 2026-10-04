/**
 * Plan §7.4, §7.5, §8.3 — the Puzzles page over a faked API: the stock with its
 * family-friendly chip, source and plays; Generate now posts { sceneId } for a
 * crossword channel; and nothing on the page approves, edits clues or drops
 * words (approval is given to words and clues, never to puzzles).
 */
import { configure, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import PuzzlesPage from "./PuzzlesPage";

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

const calls: { method: string; url: string; body?: unknown }[] = [];
const row = (id: string, title: string, familyFriendly: boolean, source: string, plays: number) => ({
  id,
  title,
  status: "ready",
  familyFriendly,
  source,
  createdAt: 1_700_000_000_000,
  width: 9,
  height: 9,
  words: 14,
  plays,
  scenes: plays ? ["xw"] : [],
  ...(plays ? { lastPlayedAt: 1_700_000_100_000 } : {}),
});

beforeEach(() => {
  calls.length = 0;
  global.fetch = jest.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const u = String(url);
    const method = init?.method ?? "GET";
    calls.push({ method, url: u, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const json = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body }) as Response;
    if (u === "/api/scenes")
      return json({
        scenes: [
          { id: "main", name: "Weather Main", surface: "globe" },
          { id: "xw", name: "Crossword One", surface: "crossword" },
        ],
      });
    if (u === "/api/crossword/generate") return json({ queued: true }, 202);
    if (u.startsWith("/api/crossword/puzzles"))
      return json({ puzzles: [row("p1", "Puzzle Alpha", true, "bank", 3), row("p2", "Puzzle Beta", false, "seed", 0)] });
    return json({ error: "nope" }, 404);
  }) as typeof fetch;
});

const rowFor = (title: string) => screen.getByRole("link", { name: title }).closest("tr") as HTMLElement;

it("lists the stock, each title opening its puzzle", async () => {
  render(<PuzzlesPage />);
  expect(await screen.findByRole("link", { name: "Puzzle Alpha" })).toHaveAttribute("href", "/admin/crosswords/puzzles/p1");
  expect(screen.getByRole("link", { name: "Puzzle Beta" })).toHaveAttribute("href", "/admin/crosswords/puzzles/p2");
  expect(within(rowFor("Puzzle Alpha")).getByText("bank")).toBeInTheDocument();
  expect(within(rowFor("Puzzle Beta")).getByText("seed")).toBeInTheDocument();
  expect(within(rowFor("Puzzle Alpha")).getByText("3")).toBeInTheDocument();
});

it("shows the family-friendly chip only on a family-friendly puzzle", async () => {
  render(<PuzzlesPage />);
  await screen.findByRole("link", { name: "Puzzle Alpha" });
  expect(within(rowFor("Puzzle Alpha")).getByText(/^family[- ]friendly$/i)).toBeInTheDocument();
  expect(within(rowFor("Puzzle Beta")).queryByText(/^family[- ]friendly$/i)).toBeNull();
});

it("Generate now posts { sceneId } for a crossword channel, never a weather one", async () => {
  render(<PuzzlesPage />);
  await screen.findByRole("link", { name: "Puzzle Alpha" });
  const gen = screen.getByRole("button", { name: /generate/i });
  await waitFor(() => expect(gen).toBeEnabled());
  fireEvent.click(gen);
  await waitFor(() => expect(calls.some((c) => c.url === "/api/crossword/generate")).toBe(true));
  const post = calls.find((c) => c.url === "/api/crossword/generate")!;
  expect(post.method).toBe("POST");
  expect(post.body).toEqual({ sceneId: "xw" });
});

it("has no approve, clue edit or drop control", async () => {
  render(<PuzzlesPage />);
  await screen.findByRole("link", { name: "Puzzle Alpha" });
  expect(screen.queryByRole("button", { name: /approve|edit|drop|remove word/i })).toBeNull();
  expect(calls.every((c) => c.method === "GET" || c.url === "/api/crossword/generate")).toBe(true);
});
