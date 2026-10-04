/**
 * Pure render helpers: queue positions, play progress, the §6.7 status line
 * and the encoder ordering for videos and channels.
 */
import type { RunState } from "@photonsurge/shared/runs";
import {
  defaultRenderEncoder,
  encodersForChannel,
  encodersForVideo,
  playProgress,
  queuePositions,
  renderStatus,
  type EncoderWithOccupancy,
  type RenderRow,
} from "./renders";

const row = (over: Partial<RenderRow>): RenderRow =>
  ({ id: "r", encoderId: "v1", what: { type: "script", scriptId: "s" }, publishAs: "public", offline: false, status: "queued", queuedAt: 1, ...over }) as RenderRow;

describe("queuePositions", () => {
  it("numbers each queue oldest first, skipping videos queued for later", () => {
    const pos = queuePositions(
      [
        { id: "a", encoderId: "v1", status: "queued", queuedAt: 3 },
        { id: "b", encoderId: "v1", status: "queued", queuedAt: 1 },
        { id: "c", encoderId: "any", status: "queued", queuedAt: 2 },
        { id: "d", encoderId: "v1", status: "queued", queuedAt: 0, notBefore: 500 },
        { id: "e", encoderId: "v1", status: "live", queuedAt: 0 },
      ],
      100,
    );
    expect(Object.fromEntries(pos)).toEqual({ b: 1, a: 2, c: 1 });
  });
});

describe("playProgress", () => {
  const play = { startedAt: 1000, clips: [{ startMs: 0, durationMs: 30_000 }, { startMs: 30_000, durationMs: 6_000 }] };
  it("finds the clip and the time left", () => {
    expect(playProgress(play, 1000 + 10_000)).toEqual({ clip: 1, of: 2, leftMs: 26_000 });
    expect(playProgress(play, 1000 + 31_000)).toEqual({ clip: 2, of: 2, leftMs: 5_000 });
    expect(playProgress(play, 1000 + 99_000)).toEqual({ clip: 2, of: 2, leftMs: 0 });
  });
  it("has nothing to say about an empty play", () => {
    expect(playProgress({ startedAt: 1, clips: [] }, 2)).toBeNull();
  });
});

describe("renderStatus", () => {
  const run = (status: RunState["status"]): RunState => ({ id: "run", sceneId: "shorts", status, needsManualObs: false });
  it("queued with its place, or the time it waits for", () => {
    expect(renderStatus(row({}), 0, 2)).toMatchObject({ label: "queued · #2" });
    expect(renderStatus(row({ notBefore: 5000 }), 0).detail).toMatch(/^starts at /);
  });
  it("preparing, awaiting ingest, live with progress", () => {
    expect(renderStatus(row({ status: "preparing" }), 0)).toMatchObject({ label: "preparing" });
    expect(renderStatus(row({ status: "preparing", run: run("awaiting-ingest") }), 0)).toMatchObject({ label: "awaiting ingest" });
    expect(renderStatus(row({ status: "live", run: run("live") }), 0)).toMatchObject({ label: "live", detail: "starting the script" });
    const playing = row({ status: "live", run: run("live"), play: { startedAt: 0, clips: [{ startMs: 0, durationMs: 60_000 }] } });
    expect(renderStatus(playing, 15_000)).toMatchObject({ label: "live", detail: "clip 1 of 1 · 0:45 left" });
    expect(renderStatus({ ...playing, offline: true }, 15_000).label).toBe("rehearsing");
  });
  it("the outcomes, with their reason", () => {
    expect(renderStatus(row({ status: "done" }), 0)).toMatchObject({ label: "done", color: "success" });
    expect(renderStatus(row({ status: "skipped", note: "too late" }), 0)).toMatchObject({ label: "skipped", detail: "too late" });
    expect(renderStatus(row({ status: "failed", note: "stopped by operator" }), 0)).toMatchObject({ label: "failed", detail: "stopped by operator" });
  });
});

describe("encoder ordering", () => {
  const enc = (id: string, use: "channels" | "videos", canQueueVideo = true, enabled = true): EncoderWithOccupancy => ({
    id,
    url: "ws://x",
    enabled,
    hasPassword: false,
    use,
    occupancy: { state: canQueueVideo ? "free" : "live", label: "", canQueueVideo, queued: 0 },
  });
  const list = [enc("ch", "channels"), enc("v1", "videos", false), enc("v2", "videos"), enc("v3", "videos", true, false)];

  it("lists video encoders first for a video", () => {
    expect(encodersForVideo(list).map((e) => e.id)).toEqual(["v1", "v2", "v3", "ch"]);
  });
  it("never offers a video encoder to a channel, unless it is the saved pick", () => {
    expect(encodersForChannel(list).map((e) => e.id)).toEqual(["ch"]);
    expect(encodersForChannel(list, "v2").map((e) => e.id)).toEqual(["ch", "v2"]);
  });
  it("preselects the format's default when it can take a video, else the first video encoder that can, else any", () => {
    expect(defaultRenderEncoder(list, "ch")).toBe("ch");
    expect(defaultRenderEncoder(list, "v1")).toBe("v2");
    expect(defaultRenderEncoder(list)).toBe("v2");
    expect(defaultRenderEncoder([enc("ch", "channels")])).toBe("any");
  });
});
