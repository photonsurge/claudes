import { toRunState, runIsActive, runIsFinished, type Run } from "./runs";

const baseRun = (over: Partial<Run> = {}): Run => ({
  id: "r1",
  sceneId: "default",
  status: "live",
  platforms: {},
  ...over,
});

describe("run status predicates", () => {
  it("treats scheduled/awaiting-ingest/live/ending as active", () => {
    for (const s of ["scheduled", "awaiting-ingest", "live", "ending"] as const) {
      expect(runIsActive(s)).toBe(true);
      expect(runIsFinished(s)).toBe(false);
    }
  });
  it("treats ended/stopped/failed as finished", () => {
    for (const s of ["ended", "stopped", "failed"] as const) {
      expect(runIsActive(s)).toBe(false);
      expect(runIsFinished(s)).toBe(true);
    }
  });
});

describe("toRunState", () => {
  it("strips the RTMP stream key from the socket projection", () => {
    const run = baseRun({
      platforms: {
        youtube: {
          channelId: "UC123",
          broadcastId: "bcast",
          ingestionAddress: "rtmp://a.rtmp.youtube.com/live2",
          streamName: "secret-stream-key",
          watchUrl: "https://youtu.be/bcast",
        },
      },
      obs: { configured: true, streaming: true },
    });
    const state = toRunState(run);
    const serialized = JSON.stringify(state);
    expect(serialized).not.toContain("secret-stream-key");
    expect(state.youtube?.bound).toBe(true);
    expect(state.youtube?.ingestionAddress).toContain("rtmp://");
    expect(state.needsManualObs).toBe(false);
  });

  it("flags needsManualObs when awaiting ingest with OBS unconfigured", () => {
    const run = baseRun({
      status: "awaiting-ingest",
      platforms: { youtube: { broadcastId: "b", streamName: "k" } },
      obs: { configured: false, streaming: false },
    });
    expect(toRunState(run).needsManualObs).toBe(true);
  });
});
