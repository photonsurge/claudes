jest.mock("../lib/director-commands", () => ({
  sendCommand: jest.fn(async () => ({ ok: true, command: {} })),
  fetchCommands: jest.fn(async () => []),
  dropCommand: jest.fn(async () => true),
}));

import { act, fireEvent, render, screen } from "@testing-library/react";
import { DEFAULT_DIRECTOR_CONFIG, type DirectorState } from "@photonsurge/shared/director";
import type { DirectorCommand } from "@photonsurge/shared/director-commands";
import { dropCommand, fetchCommands, sendCommand } from "../lib/director-commands";
import DirectorCommandBar from "./DirectorCommandBar";

const live = (over: Partial<DirectorState> = {}): DirectorState => ({
  sceneId: "wind",
  seq: 3,
  active: true,
  segment: null,
  startedAt: 0,
  endsAt: 0,
  upNext: [],
  ...over,
});
const row = (over: Partial<DirectorCommand>): DirectorCommand => ({
  id: "c1",
  sceneId: "wind",
  source: { kind: "operator", user: "op@x" },
  cmd: { op: "skip" },
  status: "applied",
  createdAt: 1,
  expiresAt: 2,
  ...over,
});

beforeEach(() => jest.clearAllMocks());

/** Render and let the initial log fetches settle, so no update lands outside act(). */
async function renderBar(state = live(), kinds = DEFAULT_DIRECTOR_CONFIG.kinds) {
  let out!: ReturnType<typeof render>;
  await act(async () => {
    out = render(<DirectorCommandBar sceneId="wind" live={state} kinds={kinds} pollMs={60_000} />);
  });
  return out;
}

/** Click and let the send + refresh settle. */
async function click(name: string) {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name }));
  });
}

it("sends hold, pause and clear", async () => {
  await renderBar(live({ queued: [{ id: "q", label: "Next: a quake", source: "operator" }] }));
  await click("Hold +30s");
  await click("Pause");
  await click("Clear queue");
  expect((sendCommand as jest.Mock).mock.calls.map((c) => c[1])).toEqual([
    { op: "hold", extendS: 30 },
    { op: "pause" },
    { op: "clear" },
  ]);
});

it("offers Resume while paused", async () => {
  await renderBar(live({ paused: { since: 1 } }));
  await click("Resume");
  expect(sendCommand).toHaveBeenCalledWith("wind", { op: "resume" });
});

it("disables Clear when nothing is queued", async () => {
  await renderBar();
  expect(screen.getByRole("button", { name: "Clear queue" })).toBeDisabled();
});

it("cuts to a kind now, offering only kinds the channel airs", async () => {
  await renderBar(live(), { ...DEFAULT_DIRECTOR_CONFIG.kinds, ship: false });
  expect(screen.queryByRole("button", { name: "Ship" })).not.toBeInTheDocument();
  await click("Quake");
  expect(sendCommand).toHaveBeenCalledWith("wind", { op: "cut", target: { type: "kind", kind: "quake" } });
});

it("shows why a command was refused", async () => {
  (sendCommand as jest.Mock).mockResolvedValueOnce({ ok: false, error: "director is off" });
  await renderBar();
  await click("Hold +30s");
  expect(screen.getByRole("alert")).toHaveTextContent("director is off");
});

it("lists the command log with outcomes, and drops a queued row", async () => {
  (fetchCommands as jest.Mock).mockResolvedValue([
    row({ id: "a", cmd: { op: "cut", target: { type: "segment", id: "quake:x" } }, resolved: { id: "quake:x", title: "M6 Chile" } }),
    row({ id: "b", status: "refused", note: "no quake in the pool", cmd: { op: "cut", target: { type: "kind", kind: "quake" } } }),
    row({ id: "c", status: "queued", cmd: { op: "queue", target: { type: "kind", kind: "storm" } }, source: { kind: "viewer", platform: "youtube", author: "ann" } }),
  ]);
  await renderBar();
  expect(screen.getByText(/Take quake:x → M6 Chile/)).toBeInTheDocument();
  expect(screen.getByText(/no quake in the pool/)).toBeInTheDocument();
  expect(screen.getByText(/@ann/)).toBeInTheDocument();
  await click("Drop Next: a storm");
  expect(dropCommand).toHaveBeenCalledWith("wind", "c");
});

it("refreshes the log when a new cut lands", async () => {
  const { rerender } = await renderBar();
  const before = (fetchCommands as jest.Mock).mock.calls.length;
  await act(async () => {
    rerender(<DirectorCommandBar sceneId="wind" live={live({ seq: 4 })} kinds={DEFAULT_DIRECTOR_CONFIG.kinds} pollMs={60_000} />);
  });
  expect((fetchCommands as jest.Mock).mock.calls.length).toBeGreaterThan(before);
});
