import {
  ENV_ENCODER_ID,
  SLOT_RETRY_BASE_MS,
  SLOT_RETRY_MAX_MS,
  encoderKeyForRun,
  slotRetryDelayMs,
  toEncoderInfo,
  toRunState,
  runIsActive,
  runIsFinished,
  type Run,
  type StreamEncoder,
} from "./runs";

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

  it("carries encoderId + slotId into the projection", () => {
    const state = toRunState(baseRun({ encoderId: "obs-2", slotId: "slot-wind" }));
    expect(state.encoderId).toBe("obs-2");
    expect(state.slotId).toBe("slot-wind");
  });
});

describe("encoderKeyForRun", () => {
  it("collapses legacy runs (no encoderId) onto the env encoder", () => {
    expect(encoderKeyForRun(baseRun())).toBe(ENV_ENCODER_ID);
    expect(encoderKeyForRun(baseRun({ encoderId: "" }))).toBe(ENV_ENCODER_ID);
    expect(encoderKeyForRun(baseRun({ encoderId: "obs-2" }))).toBe("obs-2");
  });
});

describe("toEncoderInfo", () => {
  it("replaces password material with a hasPassword flag", () => {
    const enc: StreamEncoder = { id: "obs-1", url: "ws://127.0.0.1:4455", passwordEnc: "v1.a.b.c", enabled: true };
    const info = toEncoderInfo(enc);
    expect(JSON.stringify(info)).not.toContain("v1.a.b.c");
    expect(info.hasPassword).toBe(true);
    expect(toEncoderInfo({ ...enc, passwordEnc: undefined }).hasPassword).toBe(false);
  });
});

describe("slotRetryDelayMs", () => {
  it("doubles from the base and caps at the max", () => {
    expect(slotRetryDelayMs(0)).toBe(SLOT_RETRY_BASE_MS);
    expect(slotRetryDelayMs(1)).toBe(SLOT_RETRY_BASE_MS * 2);
    expect(slotRetryDelayMs(2)).toBe(SLOT_RETRY_BASE_MS * 4);
    expect(slotRetryDelayMs(99)).toBe(SLOT_RETRY_MAX_MS);
    expect(slotRetryDelayMs(-3)).toBe(SLOT_RETRY_BASE_MS); // clamped
  });
});
