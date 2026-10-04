/**
 * PuzzlesPage — over a faked API: lists the stock, refetches on a filter,
 * and Generate now queues a build for the picked crossword channel only.
 */
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import PuzzlesPage from "./PuzzlesPage";
import type { PuzzleRow } from "./api";

jest.mock("next/link", () => ({
  __esModule: true,
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const row: PuzzleRow = {
  id: "p1",
  title: "Volcanoes",
  status: "ready",
  familyFriendly: true,
  source: "themed",
  createdAt: 1_700_000_000_000,
  width: 11,
  height: 9,
  words: 14,
  plays: 0,
  scenes: [],
};

const calls: string[] = [];
const bodies: unknown[] = [];

beforeEach(() => {
  calls.length = 0;
  bodies.length = 0;
  global.fetch = jest.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const u = String(url);
    calls.push(`${init?.method ?? "GET"} ${u}`);
    if (init?.body) bodies.push(JSON.parse(String(init.body)));
    const json = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body }) as Response;
    if (u === "/api/scenes")
      return json({
        scenes: [
          { id: "default", name: "Main" },
          { id: "xw", name: "Crossword One", surface: "crossword" },
        ],
      });
    if (u.startsWith("/api/crossword/puzzles")) return json({ puzzles: u.includes("status=ready") ? [] : [row] });
    if (u === "/api/crossword/generate") return json({ queued: true }, 202);
    return json({ error: "nope" }, 404);
  }) as typeof fetch;
});

it("lists puzzles with a link to each", async () => {
  render(<PuzzlesPage />);
  const link = await screen.findByRole("link", { name: "Volcanoes" });
  expect(link).toHaveAttribute("href", "/admin/crosswords/puzzles/p1");
  const tr = link.closest("tr")!;
  expect(within(tr).getByText("ready")).toBeInTheDocument();
  expect(within(tr).getByText("14")).toBeInTheDocument();
});

it("shows the family-friendly chip", async () => {
  render(<PuzzlesPage />);
  const tr = (await screen.findByRole("link", { name: "Volcanoes" })).closest("tr")!;
  expect(within(tr).getByText("Family friendly")).toBeInTheDocument();
});

it("has no Draft status", async () => {
  render(<PuzzlesPage />);
  await screen.findByRole("link", { name: "Volcanoes" });
  fireEvent.mouseDown(screen.getByLabelText("Status"));
  const options = await screen.findAllByRole("option");
  expect(options.map((o) => o.textContent)).toEqual(["All", "Ready", "Rejected"]);
});

it("refetches with the status filter", async () => {
  render(<PuzzlesPage />);
  await screen.findByRole("link", { name: "Volcanoes" });
  fireEvent.mouseDown(screen.getByLabelText("Status"));
  fireEvent.click(await screen.findByRole("option", { name: "Ready" }));
  expect(await screen.findByText(/No puzzles match/)).toBeInTheDocument();
  expect(calls).toContain("GET /api/crossword/puzzles?status=ready");
});

it("generates for a crossword channel with just the scene", async () => {
  render(<PuzzlesPage />);
  await waitFor(() => expect(screen.getByRole("button", { name: "Generate" })).toBeEnabled());
  fireEvent.mouseDown(screen.getByLabelText("Channel"));
  const options = await screen.findAllByRole("option");
  expect(options.map((o) => o.textContent)).toEqual(["Crossword One"]);
  fireEvent.click(options[0]);
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Generate" }));
  });
  expect(await screen.findByText(/Build queued/)).toBeInTheDocument();
  expect(bodies).toContainEqual({ sceneId: "xw" });
});
