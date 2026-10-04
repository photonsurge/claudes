/**
 * Plan §7.5, §8.3 — the Desk over a faked API: the board in small, Pause/Resume,
 * Skip clue, Reveal word, Next puzzle posting the right commands, Go live and
 * End, the simulator posting name and text, and a line saying why the channel
 * is idle or replaying when the approved pool is too small.
 */
import { configure, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { CrosswordPublicState } from "@photonsurge/shared/crossword";
import DeskPage from "./DeskPage";

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

const NOW = Date.now();
let state: CrosswordPublicState;
// The desk route's structured reason (§7.5), decided by shared's crosswordStockReason (tested there and on the route).
let reason: { kind: string; unplayed: number };
const posts: { url: string; body: unknown }[] = [];

const playing = (): CrosswordPublicState => ({
  sceneId: "xw",
  seq: 1,
  serverNow: NOW,
  phase: "playing",
  phaseEndsAt: NOW + 600_000,
  puzzleNo: 42,
  title: "Puzzle 42",
  width: 3,
  height: 2,
  rows: ["C..", "###"],
  entries: [{ id: "1A", num: 1, dir: "across", row: 0, col: 0, length: 3, clue: "Feline pet" }],
  spotlight: { entryId: "1A", startedAt: NOW - 5_000, endsAt: NOW + 55_000 },
  scores: [],
  today: [],
  feed: [],
  inputLive: false,
  paused: false,
});

beforeEach(() => {
  posts.length = 0;
  state = playing();
  reason = { kind: "fresh", unplayed: 1 };
  window.confirm = jest.fn(() => true);
  global.fetch = jest.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const u = String(url);
    const json = (b: unknown, status = 200) => ({ ok: status < 400, status, json: async () => b }) as Response;
    if (init?.method === "POST") {
      posts.push({ url: u, body: JSON.parse(String(init.body)) });
      return json({ queued: true }, 202);
    }
    if (u === "/api/scenes") return json({ scenes: [{ id: "xw", name: "Crossword One", surface: "crossword", watchToken: "tok" }] });
    if (u === "/api/crossword/xw/state") return json(state);
    if (u === "/api/crossword/xw/desk") return json({ reason, pool: { words: 40, ffWords: 20, puzzlesWithoutRepeat: 2, ffPuzzlesWithoutRepeat: 1, targetWords: 280 } });
    return json({ error: "nope" }, 404);
  }) as typeof fetch;
});

const commands = () => posts.filter((p) => p.url === "/api/crossword/xw/command").map((p) => (p.body as { command: string }).command);

it("shows the board in small, with only the letters showing", async () => {
  render(<DeskPage sceneId="xw" />);
  const grid = await screen.findByRole("grid");
  const cells = within(grid).getAllByRole("gridcell");
  expect(cells).toHaveLength(3);
  expect(cells.map((c) => (c.textContent ?? "").replace(/\d/g, "")).join("")).toBe("C");
  expect(screen.getByText("Feline pet")).toBeInTheDocument();
});

it.each([
  ["Pause", "pause"],
  ["Skip clue", "skipClue"],
  ["Reveal word", "reveal"],
  ["Next puzzle", "nextPuzzle"],
])("%s posts the %s command", async (label, command) => {
  render(<DeskPage sceneId="xw" />);
  await screen.findByRole("grid");
  const btn = screen.getByRole("button", { name: label });
  await waitFor(() => expect(btn).toBeEnabled());
  fireEvent.click(btn);
  await waitFor(() => expect(commands()).toEqual([command]));
});

it("Resume posts resume while paused", async () => {
  state = { ...state, paused: true };
  render(<DeskPage sceneId="xw" />);
  await screen.findByRole("grid");
  fireEvent.click(screen.getByRole("button", { name: "Resume" }));
  await waitFor(() => expect(commands()).toEqual(["resume"]));
});

it("has Go live and End", async () => {
  render(<DeskPage sceneId="xw" />);
  await screen.findByRole("grid");
  const control = (name: RegExp) => [...screen.queryAllByRole("button", { name }), ...screen.queryAllByRole("link", { name })];
  expect(control(/go live/i).length).toBeGreaterThan(0);
  expect(control(/^end/i).length).toBeGreaterThan(0);
});

it("the simulator posts name and text to the sim route", async () => {
  render(<DeskPage sceneId="xw" />);
  await screen.findByRole("grid");
  fireEvent.change(screen.getByLabelText(/^name$/i), { target: { value: "Ann" } });
  fireEvent.change(screen.getByLabelText(/^(message|text)$/i), { target: { value: "1a cat" } });
  fireEvent.click(screen.getByRole("button", { name: /^(say|send)/i }));
  await waitFor(() => expect(posts.filter((p) => p.url === "/api/crossword/xw/sim")).toHaveLength(1));
  expect(posts.find((p) => p.url === "/api/crossword/xw/sim")!.body).toEqual({ name: "Ann", text: "1a cat" });
});

it("says why the channel is idle", async () => {
  state = { ...state, phase: "idle", width: 0, height: 0, rows: [], entries: [], spotlight: null };
  reason = { kind: "noReady", unplayed: 0 };
  render(<DeskPage sceneId="xw" />);
  expect(await screen.findByText(/idle/i, { selector: ".MuiAlert-message, .MuiAlert-message *" })).toHaveTextContent(/approve|pool|stock/i);
});

it("says why the channel is replaying when the puzzle on air has aired here before", async () => {
  // The route decides it (the puzzle on air aired here before); the page words it.
  reason = { kind: "replay", unplayed: 0 };
  render(<DeskPage sceneId="xw" />);
  const line = await screen.findByText(/replay/i);
  expect(line).toHaveTextContent(/approve|pool/i);
});

it("says nothing about replaying while there is unplayed stock", async () => {
  render(<DeskPage sceneId="xw" />);
  await screen.findByRole("grid");
  await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(expect.stringMatching(/^\/api\/crossword\/xw\/desk/), expect.anything()));
  expect(screen.queryByText(/replay/i)).toBeNull();
});
