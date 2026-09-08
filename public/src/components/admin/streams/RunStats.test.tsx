import { act, render, screen } from "@testing-library/react";
import type { RunState } from "@photonsurge/shared/runs";
import RunStats from "./RunStats";

const now = Date.UTC(2026, 8, 8, 12);
const run: RunState = { id: "r1", sceneId: "default", status: "live", needsManualObs: false, startAt: now - 60_000 };

it("shows YouTube counts, preserves zero likes and expires current viewers", () => {
  render(<RunStats run={{ ...run, youtube: { bound: true, broadcastId: "video" } }} youtubeStats={{ views: "1240", likes: "0", watchingNow: "32", fetchedAt: now }} />);
  expect(screen.getByText("Views: 1,240")).toBeInTheDocument();
  expect(screen.getByText("Likes: 0")).toBeInTheDocument();
  expect(screen.getByText("Watching now: 32")).toBeInTheDocument();
  act(() => { jest.advanceTimersByTime(120_000); });
  expect(screen.getByText("Watching now: —")).toBeInTheDocument();
});

beforeEach(() => { jest.useFakeTimers(); jest.setSystemTime(now); });
afterEach(() => { jest.useRealTimers(); });

it("ticks while live and freezes at the recorded end", () => {
  const { rerender } = render(<RunStats run={run} />);
  expect(screen.getByText("On air: 1m 0s")).toBeInTheDocument();
  act(() => { jest.advanceTimersByTime(2000); });
  expect(screen.getByText("On air: 1m 2s")).toBeInTheDocument();
  rerender(<RunStats run={{ ...run, status: "ended", endedAt: now + 2000 }} />);
  act(() => { jest.advanceTimersByTime(5000); });
  expect(screen.getByText("Runtime: 1m 2s")).toBeInTheDocument();
});

it("does not invent runtime for incomplete historical records or scheduled runs", () => {
  const { rerender } = render(<RunStats run={{ ...run, status: "failed" }} />);
  expect(screen.getByText("Runtime unavailable")).toBeInTheDocument();
  rerender(<RunStats run={{ ...run, status: "scheduled", startAt: now + 60_000 }} />);
  expect(screen.getByText("Not yet live")).toBeInTheDocument();
});

it("expires health samples and hides them after a run ends", () => {
  const health = { runId: "r1", sceneId: "default", at: now, obs: { kbps: 4200, droppedRatio: 0.012 } };
  const { rerender } = render(<RunStats run={run} health={health} />);
  expect(screen.getByText("Bitrate: 4200 kbps")).toBeInTheDocument();
  expect(screen.getByText("Dropped frames: 1.2%")).toBeInTheDocument();
  act(() => { jest.advanceTimersByTime(60_000); });
  expect(screen.queryByText(/Bitrate:/)).not.toBeInTheDocument();
  rerender(<RunStats run={{ ...run, status: "ended", endedAt: now }} health={{ ...health, at: Date.now() }} />);
  expect(screen.queryByText(/Bitrate:/)).not.toBeInTheDocument();
});
