import { fireEvent, render, screen } from "@testing-library/react";
import VodTimeline, { estimateStopOffsets } from "./VodTimeline";
import type { AsRunItem } from "@photonsurge/shared/vod";
import type { AirEntry } from "../../../lib/airlog";

const entry = (id: string, over: Partial<AirEntry> = {}): AirEntry => ({
  id,
  runId: "air-1",
  sceneId: "default",
  seq: 1,
  kind: "quake",
  segmentId: `quake:${id}`,
  title: `Quake ${id}`,
  breaking: false,
  timesShown: 1,
  center: [0, 0],
  zoom: 3,
  holdMs: 45000,
  startedAt: "2026-09-01T10:00:00Z",
  endedAt: "2026-09-01T10:00:45Z",
  actualMs: 45000,
  endReason: "expired",
  ...over,
});

const items: AsRunItem<AirEntry>[] = [
  { type: "gap", offsetMs: 0, endOffsetMs: 30_000, reason: "before-first-cut" },
  { type: "cut", entry: entry("a"), offsetMs: 30_000, endOffsetMs: 75_000, clippedStart: false, clippedEnd: false },
  { type: "cut", entry: entry("b"), offsetMs: 5_025_000, endOffsetMs: null, clippedStart: false, clippedEnd: true },
];

it("labels rows with video offsets, draws gaps, and seeks the player from ▶", () => {
  const onSeek = jest.fn();
  render(<VodTimeline items={items} watchUrl="https://youtu.be/v" onSeek={onSeek} />);
  expect(screen.getByText(/No cut logged · 30s before the director's first cut/)).toBeInTheDocument();
  expect(screen.getByText("0:30")).toBeInTheDocument();
  expect(screen.getByText("1:23:45")).toBeInTheDocument();
  expect(screen.getByText("ran past the end")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Play from 1:23:45" }));
  expect(onSeek).toHaveBeenCalledWith(5_025_000);
});

it("falls back to watch-URL links at the offset when there is no player", () => {
  render(<VodTimeline items={items} watchUrl="https://youtu.be/v" />);
  expect(screen.getByRole("link", { name: "Play from 0:30" })).toHaveAttribute("href", "https://youtu.be/v?t=30s");
});

it("spreads round-up stops evenly over the shot and lets each seek", () => {
  expect(estimateStopOffsets(60_000, 120_000, 3)).toEqual([60_000, 80_000, 100_000]);
  expect(estimateStopOffsets(60_000, null, 2)).toEqual([60_000, 60_000]);
  expect(estimateStopOffsets(0, 10_000, 0)).toEqual([]);
  const onSeek = jest.fn();
  const tour: AsRunItem<AirEntry>[] = [
    {
      type: "cut",
      entry: entry("tour", { kind: "country", stops: [{ label: "Tokyo", lng: 139.7, lat: 35.7 }, { label: "Osaka", lng: 135.5, lat: 34.7 }] }),
      offsetMs: 60_000,
      endOffsetMs: 120_000,
      clippedStart: false,
      clippedEnd: false,
    },
  ];
  render(<VodTimeline items={tour} onSeek={onSeek} />);
  fireEvent.click(screen.getByRole("button", { name: "Play from ≈1:30" }));
  expect(onSeek).toHaveBeenCalledWith(90_000);
});

it("interleaves chat after the cut that was on air when it landed", () => {
  render(
    <VodTimeline
      items={items}
      chat={[
        { id: "c2", offsetMs: 70_000, author: "bob", text: "what was that?" },
        { id: "c1", offsetMs: 10_000, author: "ann", text: "hi" },
        { id: "c3", offsetMs: 9_000_000, author: "cy", text: "still here" },
      ]}
    />,
  );
  const text = document.body.textContent ?? "";
  expect(text.indexOf("hi")).toBeLessThan(text.indexOf("Quake a"));
  expect(text.indexOf("what was that?")).toBeGreaterThan(text.indexOf("Quake a"));
  expect(text.indexOf("what was that?")).toBeLessThan(text.indexOf("Quake b"));
  expect(text.indexOf("still here")).toBeGreaterThan(text.indexOf("Quake b"));
});
