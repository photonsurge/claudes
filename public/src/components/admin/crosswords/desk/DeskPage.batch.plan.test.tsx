/**
 * The Desk's stock line against docs/crossword-mode-plan.md §7.5 and §8.3 and
 * the batch's intent: the Desk shows the runner's own structured reason, read
 * from GET /api/crossword/:scene/desk with the pool counts, so it says why the
 * channel replays or idles, and says nothing with fresh stock.
 */
import { render, screen, waitFor } from "@testing-library/react";
import type { CrosswordPublicState } from "@photonsurge/shared/crossword";
import DeskPage from "./DeskPage";

jest.mock("next/link", () => ({
  __esModule: true,
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const NOW = 1_000_000;
let state: CrosswordPublicState;
let desk: { reason: { kind: string; unplayed: number }; pool: unknown };
const calls: string[] = [];

const playing = (): CrosswordPublicState => ({
  sceneId: "xw",
  seq: 4,
  serverNow: NOW,
  phase: "playing",
  phaseEndsAt: 0,
  puzzleNo: 7,
  title: "Puzzle 7",
  width: 3,
  height: 1,
  rows: ["..."],
  entries: [{ id: "1A", num: 1, dir: "across", row: 0, col: 0, length: 3, clue: "Feline pet" }],
  spotlight: { entryId: "1A", startedAt: NOW - 1000, endsAt: NOW + 30_000 },
  scores: [],
  today: [],
  feed: [],
  inputLive: false,
  paused: false,
});
const idle = (): CrosswordPublicState => ({ ...playing(), phase: "idle", title: "", width: 0, height: 0, rows: [], entries: [], spotlight: null });
const POOL = { words: 320, ffWords: 200, puzzlesWithoutRepeat: 22, ffPuzzlesWithoutRepeat: 14, targetWords: 280 };

beforeEach(() => {
  calls.length = 0;
  state = playing();
  desk = { reason: { kind: "fresh", unplayed: 3 }, pool: POOL };
  global.fetch = jest.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const u = String(url);
    calls.push(`${init?.method ?? "GET"} ${u}`);
    const json = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body }) as Response;
    if (u === "/api/scenes") return json({ scenes: [{ id: "xw", name: "Crossword", surface: "crossword", watchToken: "tok" }] });
    if (u === "/api/crossword/xw/state") return json(state);
    if (u === "/api/crossword/xw/desk") return json(desk);
    if (u === "/api/streams") return json({ runs: [] });
    return json({ error: "nope" }, 404);
  }) as typeof fetch;
});

it("reads the reason from the desk route", async () => {
  render(<DeskPage sceneId="xw" />);
  await waitFor(() => expect(calls).toContain("GET /api/crossword/xw/desk"));
});

it("says nothing about stock when it is fresh", async () => {
  render(<DeskPage sceneId="xw" />);
  await screen.findByText("Feline pet");
  await waitFor(() => expect(calls).toContain("GET /api/crossword/xw/desk"));
  expect(screen.queryByText(/replay/i)).not.toBeInTheDocument();
  expect(screen.queryByText(/no ready/i)).not.toBeInTheDocument();
});

it("says the channel is replaying, with the pool, when the puzzle on air is a replay", async () => {
  desk = { reason: { kind: "replay", unplayed: 0 }, pool: POOL };
  render(<DeskPage sceneId="xw" />);
  const line = await screen.findByText(/replay/i);
  expect(line.textContent).toMatch(/320/);
});

it("says why it idles with no ready puzzle", async () => {
  state = idle();
  desk = { reason: { kind: "noReady", unplayed: 0 }, pool: POOL };
  render(<DeskPage sceneId="xw" />);
  expect(await screen.findByText(/no ready puzzles/i)).toBeInTheDocument();
});

it("says why it idles on a family-friendly channel with no family-friendly stock", async () => {
  state = idle();
  desk = { reason: { kind: "noFamilyFriendly", unplayed: 0 }, pool: POOL };
  render(<DeskPage sceneId="xw" />);
  expect(await screen.findByText(/family-friendly/i)).toBeInTheDocument();
});

it("still says why without pool counts", async () => {
  state = idle();
  desk = { reason: { kind: "noReady", unplayed: 0 }, pool: null };
  render(<DeskPage sceneId="xw" />);
  expect(await screen.findByText(/no ready puzzles/i)).toBeInTheDocument();
});
