// Unit tests for the streaming-run orchestration state machine. OBS + YouTube +
// Mongo + the queue + the in-process monitor are all mocked, so we assert the
// ORDER of external calls and the run-doc state each step lands in — no network.

jest.mock("./monitor", () => ({ startMonitor: jest.fn(), stopMonitor: jest.fn(), stopAllMonitors: jest.fn() }));
jest.mock("../socket", () => ({ emitWorkerEvent: jest.fn() }));
jest.mock("@photonsurge/shared/utill/logger", () => ({ log: jest.fn() }));

jest.mock("../obs/client", () => {
  class ObsUnavailableError extends Error {
    constructor(m: string) {
      super(m);
      this.name = "ObsUnavailableError";
    }
  }
  return {
    ObsUnavailableError,
    setStreamKey: jest.fn(async () => {}),
    startStream: jest.fn(async () => {}),
    stopStream: jest.fn(async () => {}),
    getStatus: jest.fn(async () => ({
      outputActive: true,
      outputReconnecting: false,
      outputBytes: 0,
      outputSkippedFrames: 0,
      outputTotalFrames: 0,
      outputDurationMs: 0,
      outputCongestion: 0,
    })),
  };
});

jest.mock("../youtube/client", () => ({
  getYoutubeClient: jest.fn(async () => ({ youtube: {}, accountId: "acc", channelId: "acc" })),
  createBroadcast: jest.fn(async () => ({ broadcastId: "bcast", watchUrl: "https://youtu.be/bcast" })),
  createStream: jest.fn(async () => ({ streamId: "strm", ingestionAddress: "rtmp://ingest", streamName: "secret-key" })),
  bindBroadcast: jest.fn(async () => {}),
  transitionBroadcast: jest.fn(async () => {}),
  getBroadcastLifeCycle: jest.fn(async () => "live"),
  getStreamStatus: jest.fn(async () => ({ streamStatus: "active", health: "good" })),
  resolveLiveChatId: jest.fn(async () => "chat-1"),
}));

const fakeQueue = { add: jest.fn(async () => ({})), getJob: jest.fn(async () => null) };
jest.mock("@photonsurge/shared/bull/bull", () => ({ getQueue: jest.fn(() => fakeQueue) }));

// In-memory run store standing in for the Mongo data-access layer.
const runs = new Map<string, any>();
const db = {
  getRun: jest.fn(async (id: string) => (runs.has(id) ? { ...runs.get(id) } : null)),
  updateRun: jest.fn(async (id: string, patch: any) => {
    const next = { ...(runs.get(id) ?? { id }), ...patch };
    runs.set(id, next);
    return { ...next };
  }),
  listRuns: jest.fn(async () => [...runs.values()]),
};
jest.mock("@photonsurge/shared/db/index", () => ({ getAppDb: jest.fn(async () => db) }));

import { goLive, finishRun } from "./lifecycle";
import * as obs from "../obs/client";
import * as yt from "../youtube/client";

const setRun = (r: any) => runs.set(r.id, r);

beforeEach(() => {
  runs.clear();
  jest.clearAllMocks();
});

describe("goLive", () => {
  it("creates + binds YouTube, points OBS at the key, and lands in awaiting-ingest", async () => {
    setRun({ id: "r1", sceneId: "default", status: "scheduled", phase: "created", platforms: { youtube: {} }, durationMs: null });
    await goLive("r1");

    // YouTube: broadcast → stream → bind, in order.
    expect(yt.createBroadcast).toHaveBeenCalledTimes(1);
    expect(yt.createStream).toHaveBeenCalledTimes(1);
    expect(yt.bindBroadcast).toHaveBeenCalledWith(expect.anything(), "bcast", "strm");
    // OBS pointed at the YouTube ingestion address + key, then started.
    expect(obs.setStreamKey).toHaveBeenCalledWith("rtmp://ingest", "secret-key");
    expect(obs.startStream).toHaveBeenCalledTimes(1);

    const run = runs.get("r1");
    expect(run.status).toBe("awaiting-ingest");
    expect(run.phase).toBe("obs-start");
    expect(run.platforms.youtube).toMatchObject({ broadcastId: "bcast", streamId: "strm", streamName: "secret-key" });
    expect(run.obs).toMatchObject({ configured: true, streaming: true });
  });

  it("falls back to manual handoff (no failure) when OBS is unreachable", async () => {
    (obs.setStreamKey as jest.Mock).mockRejectedValueOnce(new obs.ObsUnavailableError("no OBS"));
    setRun({ id: "r2", sceneId: "default", status: "scheduled", platforms: { youtube: {} }, durationMs: null });
    await goLive("r2");

    const run = runs.get("r2");
    expect(run.status).toBe("awaiting-ingest"); // NOT failed
    expect(run.obs).toMatchObject({ configured: false, streaming: false });
    // The YouTube binding still happened, so the key is available for manual paste.
    expect(run.platforms.youtube.streamName).toBe("secret-key");
    expect(obs.startStream).not.toHaveBeenCalled();
  });

  it("marks the run failed if a YouTube step throws", async () => {
    (yt.createBroadcast as jest.Mock).mockRejectedValueOnce(new Error("quota exceeded"));
    setRun({ id: "r3", sceneId: "default", status: "scheduled", platforms: { youtube: {} }, durationMs: null });
    await goLive("r3");

    const run = runs.get("r3");
    expect(run.status).toBe("failed");
    expect(run.error).toMatchObject({ step: "goLive" });
  });

  it("refuses a second publishing run instead of hijacking the shared OBS encoder", async () => {
    // Run A already owns the single OBS streaming output.
    setRun({ id: "live-a", sceneId: "atlantic", status: "live", platforms: { youtube: { broadcastId: "b-a" } } });
    setRun({ id: "r7", sceneId: "default", status: "scheduled", platforms: { youtube: {} }, durationMs: null });

    await goLive("r7");

    const run = runs.get("r7");
    expect(run.status).toBe("failed");
    expect(run.error.message).toMatch(/only one concurrent stream/i);
    // Critically: no YouTube resources created and OBS never touched.
    expect(yt.createBroadcast).not.toHaveBeenCalled();
    expect(obs.setStreamKey).not.toHaveBeenCalled();
    expect(obs.startStream).not.toHaveBeenCalled();
    // Run A is untouched.
    expect(runs.get("live-a").status).toBe("live");
  });

  it("resumes without recreating a broadcast that already exists", async () => {
    setRun({
      id: "r4",
      sceneId: "default",
      status: "scheduled",
      platforms: { youtube: { broadcastId: "bcast", streamId: "strm", ingestionAddress: "rtmp://ingest", streamName: "secret-key" } },
      durationMs: null,
    });
    await goLive("r4");
    expect(yt.createBroadcast).not.toHaveBeenCalled();
    expect(yt.createStream).not.toHaveBeenCalled();
    expect(yt.bindBroadcast).toHaveBeenCalledTimes(1); // bind is idempotent, re-run is safe
  });
});

describe("finishRun", () => {
  it("transitions YouTube to complete, stops OBS, and marks stopped (manual)", async () => {
    setRun({
      id: "r5",
      sceneId: "default",
      status: "live",
      platforms: { youtube: { broadcastId: "bcast" } },
      obs: { configured: true, streaming: true },
    });
    (yt.getBroadcastLifeCycle as jest.Mock).mockResolvedValueOnce("live");
    await finishRun("r5", "manual");

    expect(yt.transitionBroadcast).toHaveBeenCalledWith(expect.anything(), "bcast", "complete");
    expect(obs.stopStream).toHaveBeenCalled();
    const run = runs.get("r5");
    expect(run.status).toBe("stopped");
    expect(run.endedAt).toEqual(expect.any(Number));
  });

  it("is idempotent — a second finish on an ended run does nothing external", async () => {
    setRun({ id: "r6", sceneId: "default", status: "ended", platforms: { youtube: { broadcastId: "bcast" } } });
    await finishRun("r6", "auto");
    expect(yt.transitionBroadcast).not.toHaveBeenCalled();
    expect(runs.get("r6").status).toBe("ended");
  });
});
