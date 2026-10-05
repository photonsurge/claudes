/**
 * DeskPage — over a faked API: draws the board and spotlight from the state
 * route, polls it every 2 s, sends commands and simulator messages, and links
 * Output (tokened crossword URL), Settings and Go live, and says why the
 * channel idles or replays when the pool is too small (the desk route's reason).
 */
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { CrosswordPublicState } from "@photonsurge/shared/crossword";
import DeskPage from "./DeskPage";
import { DESK_POLL_MS } from "./useDeskState";

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
let stopBody: object = { ok: true };
let runs: { id: string; sceneId: string; status: string; slotId?: string }[] = [];
// The desk route's stock reason (§7.5); the runner's own, so the page only words it.
let reason: { kind: string; unplayed: number } = { kind: "fresh", unplayed: 1 };
const calls: string[] = [];
const bodies: Record<string, unknown[]> = {};

beforeEach(() => {
  calls.length = 0;
  reason = { kind: "fresh", unplayed: 1 };
  runs = [];
  stopBody = { ok: true };
  for (const k of Object.keys(bodies)) delete bodies[k];
  state = {
    sceneId: "xw",
    seq: 4,
    serverNow: NOW,
    phase: "playing",
    phaseEndsAt: 0,
    puzzleNo: 42,
    title: "Volcanoes",
    width: 3,
    height: 1,
    rows: ["C.."],
    entries: [{ id: "1A", num: 1, dir: "across", row: 0, col: 0, length: 3, clue: "Feline pet" }],
    spotlight: { entryId: "1A", startedAt: NOW - 10_000, endsAt: NOW + 30_000 },
    scores: [{ name: "Ann", points: 5, words: 1 }],
    today: [{ name: "Ann", points: 12 }],
    feed: [{ at: NOW - 1000, text: "Ann took 4D +5" }],
    inputLive: false,
    paused: false,
  };
  global.fetch = jest.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const u = String(url);
    calls.push(`${init?.method ?? "GET"} ${u}`);
    if (init?.body) (bodies[u] ??= []).push(JSON.parse(String(init.body)));
    const json = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body }) as Response;
    if (u === "/api/scenes") return json({ scenes: [{ id: "xw", name: "Crossword One", surface: "crossword", watchToken: "tok" }] });
    if (u === "/api/crossword/xw/state") return json(state);
    if (u === "/api/crossword/xw/command" || u === "/api/crossword/xw/sim") return json({ queued: true }, 202);
    if (u === "/api/streams") return json({ runs });
    if (init?.method === "POST" && u.startsWith("/api/streams/")) return json(stopBody, 202);
    if (u === "/api/crossword/xw/desk") return json({ reason, pool: null });
    return json({ error: "nope" }, 404);
  }) as typeof fetch;
});

afterEach(() => jest.useRealTimers());

it("draws the board, the spotlight and the boards", async () => {
  jest.spyOn(Date, "now").mockReturnValue(NOW);
  render(<DeskPage sceneId="xw" />);
  expect(await screen.findByText("Feline pet")).toBeInTheDocument();
  expect(screen.getByText(/1 ACROSS · 3 letters/)).toBeInTheDocument();
  expect(screen.getByText("30s left")).toBeInTheDocument();
  expect(screen.getByText(/Puzzle 42 · Volcanoes · 0 of 1 solved/)).toBeInTheDocument();
  expect(screen.getByText("No live chat (demo round)")).toBeInTheDocument();
  expect(screen.getByText("Ann took 4D +5")).toBeInTheDocument();
  expect(within(screen.getByRole("grid")).getAllByRole("gridcell")[0]).toHaveTextContent("C");
  jest.restoreAllMocks();
});

it("links Output to the tokened crossword page and Settings; Go live opens the dialog for this channel", async () => {
  render(<DeskPage sceneId="xw" />);
  await waitFor(() => expect(screen.getByRole("link", { name: "Output" })).toHaveAttribute("href", "/crossword/xw?token=tok"));
  expect(screen.getByRole("link", { name: "Settings" })).toHaveAttribute("href", "/admin/crosswords/channels/xw");
  await waitFor(() => expect(screen.getByRole("button", { name: "Go live" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "Go live" }));
  expect(await screen.findByRole("dialog", { name: "Go live: Crossword One" })).toBeInTheDocument();
});

it("polls the state every 2 s", async () => {
  jest.useFakeTimers();
  render(<DeskPage sceneId="xw" />);
  await act(async () => {
    await jest.advanceTimersByTimeAsync(10);
  });
  const before = calls.filter((c) => c === "GET /api/crossword/xw/state").length;
  await act(async () => {
    await jest.advanceTimersByTimeAsync(DESK_POLL_MS * 2);
  });
  expect(calls.filter((c) => c === "GET /api/crossword/xw/state").length).toBeGreaterThanOrEqual(before + 2);
});

it("sends commands: Pause, then Resume once the state says paused", async () => {
  render(<DeskPage sceneId="xw" />);
  await screen.findByText("Feline pet");
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
  });
  expect(bodies["/api/crossword/xw/command"]).toEqual([{ command: "pause" }]);
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Reveal word" }));
  });
  expect(bodies["/api/crossword/xw/command"]).toContainEqual({ command: "reveal" });

  state = { ...state, seq: 5, paused: true };
  expect(await screen.findByRole("button", { name: "Resume" }, { timeout: 4000 })).toBeInTheDocument();
});

it("says as a viewer", async () => {
  render(<DeskPage sceneId="xw" />);
  await screen.findByText("Feline pet");
  fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Ann" } });
  fireEvent.change(screen.getByLabelText("Message"), { target: { value: "cat" } });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Say" }));
  });
  expect(bodies["/api/crossword/xw/sim"]).toEqual([{ name: "Ann", text: "cat" }]);
  expect(screen.getByLabelText("Message")).toHaveValue("");
});

it("disables Skip and Reveal with no clue in the spotlight", async () => {
  state = { ...state, phase: "intro", spotlight: null, phaseEndsAt: NOW + 5000 };
  render(<DeskPage sceneId="xw" />);
  await screen.findByText(/Intro card/, { selector: "p" });
  expect(screen.getByRole("button", { name: "Skip clue" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Reveal word" })).toBeDisabled();
});

it("says why it is idle", async () => {
  state = { ...state, phase: "idle", spotlight: null, entries: [], rows: [], width: 0, height: 0 };
  reason = { kind: "noReady", unplayed: 0 };
  render(<DeskPage sceneId="xw" />);
  expect(await screen.findByText(/no ready puzzles: approve more words/)).toBeInTheDocument();
});

it("says it is replaying when the puzzle on air has aired here before", async () => {
  reason = { kind: "replay", unplayed: 0 };
  render(<DeskPage sceneId="xw" />);
  expect(await screen.findByText(/Replaying\. This puzzle has aired on this channel before/)).toBeInTheDocument();
});

it("shows no reason while there is unplayed stock", async () => {
  render(<DeskPage sceneId="xw" />);
  await screen.findByText("Feline pet");
  expect(screen.queryByText(/approve more words/)).toBeNull();
});

it("warns that End also turns off a standing slot, and reports it", async () => {
  runs = [{ id: "r1", sceneId: "xw", status: "live", slotId: "s1" } as (typeof runs)[number]];
  stopBody = { ok: true, slotDisabled: "s1" };
  const confirm = jest.spyOn(window, "confirm").mockReturnValue(true);
  render(<DeskPage sceneId="xw" />);
  await screen.findByText("Feline pet");
  await waitFor(() => expect(screen.getByRole("button", { name: "End" })).toBeEnabled());
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "End" }));
  });
  expect(confirm.mock.calls[0][0]).toMatch(/standing slot/);
  expect(await screen.findByText(/slot s1 is now off/)).toBeInTheDocument();
});

it("disables End with no live run", async () => {
  render(<DeskPage sceneId="xw" />);
  await screen.findByText("Feline pet");
  expect(screen.getByRole("button", { name: "End" })).toBeDisabled();
});

it("ends the live run through the streams stop route, after confirming", async () => {
  runs = [
    { id: "old", sceneId: "xw", status: "ended" },
    { id: "r1", sceneId: "xw", status: "live" },
    { id: "r2", sceneId: "other", status: "live" },
  ];
  const confirm = jest.spyOn(window, "confirm").mockReturnValue(false);
  render(<DeskPage sceneId="xw" />);
  await screen.findByText("Feline pet");
  await waitFor(() => expect(screen.getByRole("button", { name: "End" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "End" }));
  expect(calls).not.toContain("POST /api/streams/r1/stop");
  confirm.mockReturnValue(true);
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "End" }));
  });
  expect(calls).toContain("POST /api/streams/r1/stop");
  expect(await screen.findByText(/Stop requested/)).toBeInTheDocument();
});
