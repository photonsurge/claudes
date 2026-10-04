/**
 * The Renders section (§6.7): grouped by queue with Pause / Resume, a status
 * badge per video (queued with its place, awaiting ingest, live with clip N of
 * M and time left, failed with its reason), Health on the live row, and the
 * Stop / Cancel / Retry / Watch / As-run controls.
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { RunState } from "@photonsurge/shared/runs";
import RendersSection from "./RendersSection";
import type { RenderRow, RendersResponse } from "../../../lib/renders";

const NOW = 1_000_000;

const row = (id: string, over: Partial<RenderRow>): RenderRow =>
  ({ id, encoderId: "v1", what: { type: "script", scriptId: "s" }, publishAs: "public", offline: false, status: "queued", queuedAt: 10, label: `Video ${id}`, ...over }) as RenderRow;

const liveRun: RunState = {
  id: "run1",
  sceneId: "shorts",
  encoderId: "v1",
  status: "live",
  title: "Europe round-up · Tuesday",
  startAt: NOW - 20_000,
  needsManualObs: false,
  youtube: { bound: true, watchUrl: "https://youtu.be/abc" },
  script: { scriptId: "s", renderId: "live1", offline: false, publishAs: "public" },
};

const DATA: RendersResponse = {
  queues: [
    { encoderId: "v1", name: "Video 1", use: "videos", paused: false },
    { encoderId: "v2", name: "Video 2", use: "videos", paused: true },
  ],
  renders: [
    row("q2", { queuedAt: 30 }),
    row("q1", { queuedAt: 20 }),
    row("later", { queuedAt: 25, notBefore: NOW + 3_600_000 }),
    row("live1", {
      status: "live",
      assignedEncoderId: "v1",
      encoderId: "any",
      runId: "run1",
      run: liveRun,
      play: { startedAt: NOW - 17_000, clips: [{ startMs: 0, durationMs: 60_000 }, { startMs: 60_000, durationMs: 6_000 }] },
    }),
    row("prep", { status: "preparing", encoderId: "v2", assignedEncoderId: "v2", runId: "run2", run: { ...liveRun, id: "run2", status: "awaiting-ingest" } }),
    row("done1", { status: "done", runId: "run0", videoUrl: "https://youtu.be/done", endedAt: 5 }),
    row("bad", { status: "failed", note: "OBS unreachable", endedAt: 4 }),
  ],
};

function setup(data: RendersResponse = DATA, extra: Partial<Parameters<typeof RendersSection>[0]> = {}) {
  const onAction = jest.fn(async () => ({ ok: true }));
  render(<RendersSection data={data} onAction={onAction} now={() => NOW} {...extra} />);
  return { onAction };
}

const rowEl = (id: string) => screen.getByTestId(`render-${id}`);

it("groups videos by queue: live first, then queued in order; later ones wait without a place", () => {
  setup();
  const v1 = screen.getByRole("group", { name: "Queue Video 1" });
  const ids = within(v1)
    .getAllByTestId(/^render-/)
    .map((el) => el.dataset.testid);
  expect(ids).toEqual(["render-live1", "render-q1", "render-q2", "render-later"]);
  expect(within(rowEl("q1")).getByText("queued · #1")).toBeInTheDocument();
  expect(within(rowEl("q2")).getByText("queued · #2")).toBeInTheDocument();
  expect(within(rowEl("later")).getByText(/starts at/)).toBeInTheDocument();
});

it("shows live with clip N of M and time left, and the health readout", () => {
  setup(DATA, { health: { run1: { runId: "run1", sceneId: "shorts", at: Date.now(), obs: { kbps: 6012, droppedRatio: 0.002 }, youtube: { health: "good" } } } });
  const live = rowEl("live1");
  expect(within(live).getByText("live")).toBeInTheDocument();
  expect(within(live).getByText(/clip 1 of 2 · 0:49 left/)).toBeInTheDocument();
  expect(within(live).getByText("Europe round-up · Tuesday")).toBeInTheDocument();
  expect(within(live).getByText("Bitrate: 6012 kbps")).toBeInTheDocument();
  expect(within(live).getByText("YouTube: good")).toBeInTheDocument();
  expect(within(live).getByRole("link", { name: /As-run/ })).toHaveAttribute("href", "/admin/streams/run1");
});

it("a socket run update wins over the listed run (awaiting ingest)", () => {
  setup(DATA, { runs: { run1: { ...liveRun, status: "awaiting-ingest" } } });
  expect(within(rowEl("live1")).getByText("awaiting ingest")).toBeInTheDocument();
  expect(within(rowEl("prep")).getByText("awaiting ingest")).toBeInTheDocument();
});

it("lists recent outcomes with their reason, Watch and Retry", () => {
  setup();
  expect(within(rowEl("done1")).getByText("done")).toBeInTheDocument();
  expect(within(rowEl("done1")).getByRole("link", { name: /Watch/ })).toHaveAttribute("href", "https://youtu.be/done");
  expect(within(rowEl("bad")).getByText("failed")).toBeInTheDocument();
  expect(within(rowEl("bad")).getByText(/OBS unreachable/)).toBeInTheDocument();
  expect(within(rowEl("done1")).queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
});

it("Stop, Cancel, Retry, Pause and Resume send their actions", async () => {
  const { onAction } = setup();
  fireEvent.click(within(rowEl("live1")).getByRole("button", { name: "Stop" }));
  fireEvent.click(within(rowEl("q1")).getByRole("button", { name: "Cancel" }));
  fireEvent.click(within(rowEl("bad")).getByRole("button", { name: "Retry" }));
  fireEvent.click(within(screen.getByRole("group", { name: "Queue Video 1" })).getAllByRole("button", { name: "Pause" })[0]);
  fireEvent.click(within(screen.getByRole("group", { name: "Queue Video 2" })).getAllByRole("button", { name: "Resume" })[0]);
  await waitFor(() => expect(onAction).toHaveBeenCalledTimes(5));
  expect(onAction.mock.calls.map((c) => (c as unknown[])[0])).toEqual([
    { action: "stop", renderId: "live1" },
    { action: "cancel", renderId: "q1" },
    { action: "retry", renderId: "bad" },
    { action: "pause", encoderId: "v1" },
    { action: "resume", encoderId: "v2" },
  ]);
});

it("shows a refused action's reason", async () => {
  const onAction = jest.fn(async () => ({ ok: false, error: "only a queued video can be cancelled" }));
  render(<RendersSection data={DATA} onAction={onAction} now={() => NOW} />);
  fireEvent.click(within(rowEl("q1")).getByRole("button", { name: "Cancel" }));
  expect(await screen.findByText("only a queued video can be cancelled")).toBeInTheDocument();
});

it("the any pool has no Pause, and an empty list says how to start", () => {
  setup({ queues: [{ encoderId: "any", name: "Any video encoder", paused: false }], renders: [row("a", { encoderId: "any" })] });
  const pool = screen.getByRole("group", { name: "Queue Any video encoder" });
  expect(within(pool).queryByRole("button", { name: "Pause" })).not.toBeInTheDocument();
  expect(within(pool).getByText("taken by the first idle video encoder")).toBeInTheDocument();
});

it("says how to start when nothing has rendered", () => {
  setup({ queues: [], renders: [] });
  expect(screen.getByText(/Assign an OBS encoder to videos/)).toBeInTheDocument();
});

it("an offline test's row shows one OBS screenshot per clip, each linking to full size; a failed capture says why", () => {
  const testRun: RunState = {
    ...liveRun,
    id: "run9",
    status: "ended",
    youtube: undefined,
    script: { scriptId: "s", renderId: "t9", offline: true, publishAs: "public" },
    shots: [
      { clipIndex: 0, clipId: "c1", at: 1, blobId: "run9-0.jpg" },
      { clipIndex: 1, clipId: "c2", at: 2, error: "cannot reach OBS" },
    ],
  };
  setup({ ...DATA, renders: [row("t9", { status: "done", offline: true, runId: "run9", run: testRun, endedAt: 6 })] });
  const el = within(rowEl("t9"));
  expect(el.getByRole("link", { name: "Clip 1 screenshot" })).toHaveAttribute("href", "/api/shorts/shots/run9-0.jpg");
  expect(el.getByAltText("Clip 1 as OBS drew it")).toHaveAttribute("src", "/api/shorts/shots/run9-0.jpg");
  expect(el.getByText("Clip 2: no image")).toBeInTheDocument();
});
