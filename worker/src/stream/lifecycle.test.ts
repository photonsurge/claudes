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
    lastStreamStateFor: jest.fn(() => undefined),
    outputInFlight: jest.fn((st: any) => !!st && /_(STARTING|RECONNECTING)$/.test(st.outputState)),
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

// Encoder resolution is exercised in its own unit; here every run resolves to a
// reachable test endpoint so the OBS-call mocks above see it as the first arg.
// `encoderOwnScene` is the scene the encoder shows when no run borrows it.
let encoderOwnScene: string | null = "default";
jest.mock("./encoders", () => ({
  watchBaseUrl: () => "http://localhost:10100",
  encoderOwnSceneId: jest.fn(async () => encoderOwnScene),
  idleEncoderScene: jest.fn(async () => ({ url: "about:blank" })),
  withEncoderLock: (_e: unknown, fn: () => Promise<unknown>) => fn(),
  endpointForRun: jest.fn(async () => ({ url: "ws://obs-test:4455" })),
  provisionEncoderScene: jest.fn(async () => ({
    sceneId: "default",
    sceneName: "PhotonSurge — default",
    inputName: "PhotonSurge globe — default",
    url: "https://x/watch/default?token=t",
    width: 1920,
    height: 1080,
    created: false,
    recreated: true,
    switched: true,
    refreshed: true,
    removedInputs: ["PhotonSurge globe — volcano"],
    removedScenes: ["PhotonSurge — volcano"],
  })),
}));

jest.mock("../youtube/client", () => ({
  getYoutubeClient: jest.fn(async () => ({ youtube: {}, accountId: "acc", channelId: "acc" })),
  createBroadcast: jest.fn(async () => ({ broadcastId: "bcast", watchUrl: "https://youtu.be/bcast" })),
  createStream: jest.fn(async () => ({ streamId: "strm", ingestionAddress: "rtmp://ingest", streamName: "secret-key" })),
  bindBroadcast: jest.fn(async () => {}),
  transitionBroadcast: jest.fn(async () => {}),
  getBroadcastLifeCycle: jest.fn(async () => "live"),
  getStreamStatus: jest.fn(async () => ({ streamStatus: "active", health: "good" })),
  getVideoStats: jest.fn(async () => []),
  resolveLiveChatId: jest.fn(async () => "chat-1"),
}));

const queueChapters = jest.fn(async () => {});
jest.mock("./chapters", () => ({ queueChapters: (...a: unknown[]) => queueChapters(...a), chaptersEnabled: () => true }));
const queueThumbnail = jest.fn(async () => {});
jest.mock("./thumbnail", () => ({ queueThumbnail: (...a: unknown[]) => queueThumbnail(...a), thumbnailsEnabled: () => true }));
// The channel's YouTube settings (/admin/scenes/:id) — tests set what the channel says.
// The account pick is the real one (crossword plan §10), over the fake db below.
let channelYoutube: Record<string, unknown> = { title: "", description: "", thumbnailUrl: "" };
jest.mock("./channel-youtube", () => ({
  ...jest.requireActual("./channel-youtube"),
  channelYoutubeSettings: jest.fn(async () => ({ ...channelYoutube })),
}));

const fakeQueue = { add: jest.fn(async () => ({})), getJob: jest.fn(async () => null) };
jest.mock("@photonsurge/shared/bull/bull", () => ({ getQueue: jest.fn(() => fakeQueue) }));

// In-memory run store standing in for the Mongo data-access layer.
const runs = new Map<string, any>();
const accounts = new Map<string, any>();
const slots = new Map<string, any>();
const ACTIVE = new Set(["scheduled", "awaiting-ingest", "live", "ending"]);
const db = {
  getRun: jest.fn(async (id: string) => (runs.has(id) ? { ...runs.get(id) } : null)),
  updateRun: jest.fn(async (id: string, patch: any) => {
    const next = { ...(runs.get(id) ?? { id }), ...patch };
    runs.set(id, next);
    return { ...next };
  }),
  listRuns: jest.fn(async () => [...runs.values()]),
  getYoutubeAccount: jest.fn(async (id?: string) => (id ? accounts.get(id) ?? null : null)),
  getStreamSlot: jest.fn(async (id: string) => slots.get(id) ?? null),
  // Mirrors the real accessor: same-encoder publishing runs conflict ("" → env).
  activeRunForEncoder: jest.fn(async (encoderId: string, excludeRunId?: string) =>
    [...runs.values()].find(
      (r) =>
        r.id !== excludeRunId &&
        ACTIVE.has(r.status) &&
        !!r.platforms?.youtube &&
        (r.encoderId || "env") === (encoderId || "env"),
    ) ?? null,
  ),
};
jest.mock("@photonsurge/shared/db/index", () => ({ getAppDb: jest.fn(async () => db) }));

import { goLive, finishRun, rearmLiveRuns } from "./lifecycle";
import { startMonitor } from "./monitor";
import * as obs from "../obs/client";
import * as yt from "../youtube/client";
import { idleEncoderScene, provisionEncoderScene } from "./encoders";

const OBS_IDLE = {
  outputActive: false,
  outputReconnecting: false,
  outputBytes: 0,
  outputSkippedFrames: 0,
  outputTotalFrames: 0,
  outputDurationMs: 0,
  outputCongestion: 0,
};
const OBS_ACTIVE = { ...OBS_IDLE, outputActive: true };

/** goLive a fresh run and hand back the monitor tick the orchestrator registered for it. */
async function goLiveAndGetTick(id: string): Promise<() => Promise<number>> {
  runs.set(id, { id, sceneId: "default", status: "scheduled", phase: "created", platforms: { youtube: {} }, durationMs: null });
  await goLive(id);
  const call = (startMonitor as jest.Mock).mock.calls.find((c) => c[0] === id);
  if (!call) throw new Error("monitor not started");
  return call[1];
}

const setRun = (r: any) => runs.set(r.id, r);

beforeEach(() => {
  runs.clear();
  accounts.clear();
  slots.clear();
  encoderOwnScene = "default";
  channelYoutube = { title: "", description: "", thumbnailUrl: "" };
  jest.clearAllMocks();
});

describe("goLive", () => {
  it("resolves the title once, stores it and reuses it when resuming", async () => {
    jest.useFakeTimers().setSystemTime(new Date("2026-09-08T13:05:00Z"));
    try {
      setRun({ id: "title", sceneId: "default", status: "scheduled", title: "Weather %d/%m/%Y %H:%M %%d", platforms: { youtube: {} } });
      await goLive("title");
      const title = "Weather 08/09/2026 14:05 %d";
      expect(yt.createBroadcast).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ title }));
      expect(yt.createStream).toHaveBeenCalledWith(expect.anything(), { title });
      expect(runs.get("title").title).toBe(title);
      jest.advanceTimersByTime(60_000);
      await goLive("title");
      expect(yt.createBroadcast).toHaveBeenCalledTimes(1);
      expect(runs.get("title").title).toBe(title);
    } finally { jest.useRealTimers(); }
  });
  it("takes title + description from the CHANNEL's YouTube settings, resolves them once and queues the thumbnail once", async () => {
    jest.useFakeTimers().setSystemTime(new Date("2026-09-08T13:05:00Z"));
    try {
      channelYoutube = { title: "Wind live %d/%m", description: "Wind on %A", thumbnailUrl: "" };
      setRun({ id: "desc", sceneId: "default", status: "scheduled", platforms: { youtube: {} } });
      await goLive("desc");
      const description = "Wind on Tuesday\n\nWatch the map live: http://localhost:10100";
      expect(yt.createBroadcast).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ title: "Wind live 08/09", description }),
      );
      expect(runs.get("desc")).toMatchObject({ title: "Wind live 08/09", description });
      expect(queueThumbnail).toHaveBeenCalledWith("desc");
      // Resuming a run that already has its broadcast neither re-creates nor re-queues.
      await goLive("desc");
      expect(yt.createBroadcast).toHaveBeenCalledTimes(1);
      expect(queueThumbnail).toHaveBeenCalledTimes(1);

      // A run/slot title still wins over the channel's.
      setRun({ ...runs.get("desc"), status: "ended" }); // free the (single, env) encoder
      setRun({ id: "own", sceneId: "default", status: "scheduled", title: "Slot %d", platforms: { youtube: {} } });
      await goLive("own");
      expect((yt.createBroadcast as jest.Mock).mock.calls[1][1].title).toBe("Slot 08");

      // Nothing on the channel → automatic title + built-in description copy.
      channelYoutube = { title: "", description: "", thumbnailUrl: "" };
      setRun({ ...runs.get("own"), status: "ended" });
      setRun({ id: "nodesc", sceneId: "default", status: "scheduled", platforms: { youtube: {} } });
      await goLive("nodesc");
      expect((yt.createBroadcast as jest.Mock).mock.calls[2][1].title).toMatch(/^Live — default — 2026-09-08$/);
      const dflt = (yt.createBroadcast as jest.Mock).mock.calls[2][1].description as string;
      expect(dflt).toMatch(/^This is our live weather globe/);
      expect(dflt).toContain("Streaming since Tuesday 8 September 2026, 14:05 BST.");
      expect(dflt.endsWith("Watch the map live: http://localhost:10100")).toBe(true);
    } finally { jest.useRealTimers(); }
  });
  it("creates + binds YouTube, points OBS at the key, and lands in awaiting-ingest", async () => {
    setRun({ id: "r1", sceneId: "default", status: "scheduled", phase: "created", platforms: { youtube: {} }, durationMs: null });
    await goLive("r1");

    // YouTube: broadcast → stream → bind, in order.
    expect(yt.createBroadcast).toHaveBeenCalledTimes(1);
    expect(yt.createStream).toHaveBeenCalledTimes(1);
    expect(yt.bindBroadcast).toHaveBeenCalledWith(expect.anything(), "bcast", "strm");
    // OBS pointed at the YouTube ingestion address + key, then started.
    expect(obs.setStreamKey).toHaveBeenCalledWith(expect.objectContaining({ url: expect.any(String) }), "rtmp://ingest", "secret-key");
    expect(obs.startStream).toHaveBeenCalledTimes(1);

    const run = runs.get("r1");
    expect(run.status).toBe("awaiting-ingest");
    expect(run.phase).toBe("obs-start");
    expect(run.platforms.youtube).toMatchObject({ broadcastId: "bcast", streamId: "strm", streamName: "secret-key" });
    expect(run.obs).toMatchObject({ configured: true, streaming: true });
  });

  // The provision step is also the instance SWEEP (other channels' globes and
  // duplicate /watch sources are removed there), so "does every launch provision?"
  // is the same question as "does every launch sweep?". One-off runs and the
  // constant-stream slots share this one path — a slot's scheduled recycle ends
  // its run and the next reconcile sweep creates a NEW run through goLive.
  it("provisions (and so sweeps) OBS on a one-off run, before the key is set", async () => {
    setRun({ id: "one-off", sceneId: "default", status: "scheduled", encoderId: "gpu-1", platforms: { youtube: {} }, durationMs: 3_600_000 });
    await goLive("one-off");

    expect(provisionEncoderScene).toHaveBeenCalledWith("gpu-1", { sceneId: "default" });
    const provisionedAt = (provisionEncoderScene as jest.Mock).mock.invocationCallOrder[0];
    const keyedAt = (obs.setStreamKey as jest.Mock).mock.invocationCallOrder[0];
    expect(provisionedAt).toBeLessThan(keyedAt);
  });

  it("provisions (and so sweeps) again for a slot relaunch — every recycle is a fresh run", async () => {
    // What a constant slot enqueues after a restart-interval recycle: a brand new
    // unbounded run on the same encoder.
    setRun({ id: "slot-run-2", sceneId: "default", status: "scheduled", encoderId: "gpu-1", slotId: "slot-1", createdBy: "slot:slot-1", platforms: { youtube: {} }, durationMs: null });
    await goLive("slot-run-2");

    expect(provisionEncoderScene).toHaveBeenCalledWith("gpu-1", { sceneId: "default" });
    expect(obs.startStream).toHaveBeenCalledTimes(1);
    expect(runs.get("slot-run-2").status).toBe("awaiting-ingest");
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

  it("refuses a second publishing run on the SAME encoder instead of hijacking it", async () => {
    // Run A already owns this OBS instance's single streaming output (both runs
    // have no encoderId, so both collapse onto the env encoder).
    setRun({ id: "live-a", sceneId: "atlantic", status: "live", platforms: { youtube: { broadcastId: "b-a" } } });
    setRun({ id: "r7", sceneId: "default", status: "scheduled", platforms: { youtube: {} }, durationMs: null });

    await goLive("r7");

    const run = runs.get("r7");
    expect(run.status).toBe("failed");
    expect(run.error.message).toMatch(/one OBS instance supports one concurrent stream/i);
    // Critically: no YouTube resources created and OBS never touched.
    expect(yt.createBroadcast).not.toHaveBeenCalled();
    expect(obs.setStreamKey).not.toHaveBeenCalled();
    expect(obs.startStream).not.toHaveBeenCalled();
    // Run A is untouched.
    expect(runs.get("live-a").status).toBe("live");
  });

  it("allows concurrent publishing runs on DIFFERENT encoders (the multi-view case)", async () => {
    setRun({ id: "live-a", sceneId: "atlantic", status: "live", platforms: { youtube: { broadcastId: "b-a" } } });
    setRun({
      id: "r8",
      sceneId: "pacific",
      encoderId: "obs-2",
      status: "scheduled",
      platforms: { youtube: {} },
      durationMs: null,
    });

    await goLive("r8");

    const run = runs.get("r8");
    expect(run.status).toBe("awaiting-ingest"); // NOT refused
    expect(yt.createBroadcast).toHaveBeenCalledTimes(1);
    expect(obs.startStream).toHaveBeenCalledTimes(1);
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

describe("confirm tick (awaiting-ingest)", () => {
  it("commits live once YouTube reports active ingest", async () => {
    const tick = await goLiveAndGetTick("c1");
    (obs.getStatus as jest.Mock).mockResolvedValue(OBS_ACTIVE);
    (yt.getStreamStatus as jest.Mock).mockResolvedValue({ streamStatus: "active", health: "good" });
    await tick();
    expect(runs.get("c1").status).toBe("live");
    expect(runs.get("c1").error).toBeNull();
  });

  it("flags an OBS output that never came up after StartStream — after a grace, run stays awaiting", async () => {
    const tick = await goLiveAndGetTick("c2");
    (obs.getStatus as jest.Mock).mockResolvedValue(OBS_IDLE); // StartStream was accepted, output never started
    (yt.getStreamStatus as jest.Mock).mockResolvedValue({ streamStatus: "ready" });

    // Within grace: RTMP connect / encoder init still plausible → no verdict yet.
    await tick();
    await tick();
    await tick();
    expect(runs.get("c2").error).toBeUndefined();
    expect(runs.get("c2").obs).toMatchObject({ configured: true, streaming: true });

    await tick();
    const run = runs.get("c2");
    expect(run.status).toBe("awaiting-ingest"); // NOT failed — operator can still fix OBS
    expect(run.obs).toMatchObject({ configured: true, streaming: false });
    expect(run.error).toMatchObject({ step: "obs-output" });
    expect(run.error.message).toMatch(/not running/);
  });

  it("flags immediately when OBS itself reported the output STOPPED", async () => {
    const tick = await goLiveAndGetTick("c3");
    (obs.getStatus as jest.Mock).mockResolvedValue(OBS_IDLE);
    (obs.lastStreamStateFor as jest.Mock).mockReturnValue({
      outputActive: false,
      outputState: "OBS_WEBSOCKET_OUTPUT_STOPPED",
      at: Date.now(),
    });
    (yt.getStreamStatus as jest.Mock).mockResolvedValue({ streamStatus: "ready" });
    await tick();
    expect(runs.get("c3").error).toMatchObject({ step: "obs-output" });
    expect(runs.get("c3").error.message).toContain("OBS_WEBSOCKET_OUTPUT_STOPPED");
  });

  it("waits while OBS says the output is still STARTING, and clears the flag once it runs", async () => {
    const tick = await goLiveAndGetTick("c4");
    (obs.getStatus as jest.Mock).mockResolvedValue(OBS_IDLE);
    (obs.lastStreamStateFor as jest.Mock).mockReturnValue({
      outputActive: false,
      outputState: "OBS_WEBSOCKET_OUTPUT_STARTING",
      at: Date.now(),
    });
    (yt.getStreamStatus as jest.Mock).mockResolvedValue({ streamStatus: "ready" });
    for (let i = 0; i < 6; i++) await tick();
    expect(runs.get("c4").error).toBeUndefined(); // in flight — never flagged

    // Now it dies…
    (obs.lastStreamStateFor as jest.Mock).mockReturnValue({
      outputActive: false,
      outputState: "OBS_WEBSOCKET_OUTPUT_STOPPED",
      at: Date.now(),
    });
    await tick();
    expect(runs.get("c4").error).toMatchObject({ step: "obs-output" });

    // …and the operator presses Start Streaming in OBS by hand.
    (obs.getStatus as jest.Mock).mockResolvedValue(OBS_ACTIVE);
    await tick();
    expect(runs.get("c4").error).toBeNull();
    expect(runs.get("c4").obs).toMatchObject({ streaming: true });
    expect(runs.get("c4").status).toBe("awaiting-ingest"); // YouTube still hasn't seen bytes
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
    expect(queueChapters).toHaveBeenCalledWith("r5");
  });

  it("stamps YouTube's actual start/end instants (the VOD time base) on finish, and shrugs if they fail", async () => {
    setRun({ id: "r7", sceneId: "default", status: "live", platforms: { youtube: { broadcastId: "bcast", streamName: "k" } } });
    (yt.getVideoStats as jest.Mock).mockResolvedValueOnce([
      { id: "bcast", liveStreamingDetails: { actualStartTime: "2026-09-01T10:00:03Z", actualEndTime: "2026-09-01T11:00:00Z" } },
    ]);
    await finishRun("r7", "auto");
    expect(yt.getVideoStats).toHaveBeenCalledWith(expect.anything(), ["bcast"]);
    const run = runs.get("r7");
    expect(run.status).toBe("ended");
    expect(run.platforms.youtube).toMatchObject({
      streamName: "k",
      actualStartTime: Date.parse("2026-09-01T10:00:03Z"),
      actualEndTime: Date.parse("2026-09-01T11:00:00Z"),
    });

    setRun({ id: "r8", sceneId: "default", status: "live", platforms: { youtube: { broadcastId: "b2" } } });
    (yt.getVideoStats as jest.Mock).mockRejectedValueOnce(new Error("quota"));
    await finishRun("r8", "auto");
    expect(runs.get("r8").status).toBe("ended");
  });

  it("is idempotent — a second finish on an ended run does nothing external", async () => {
    setRun({ id: "r6", sceneId: "default", status: "ended", platforms: { youtube: { broadcastId: "bcast" } } });
    await finishRun("r6", "auto");
    expect(yt.transitionBroadcast).not.toHaveBeenCalled();
    expect(runs.get("r6").status).toBe("ended");
    expect(queueChapters).not.toHaveBeenCalled();
  });
});

// Going live on a crossword channel (crossword plan §10, §6.3).
describe("going live on a crossword channel", () => {
  const crossword = (extra: Record<string, unknown> = {}) => ({
    title: "",
    description: "",
    thumbnailUrl: "",
    surface: "crossword",
    name: "Daily Crossword",
    ...extra,
  });
  const ytRun = (id: string, sceneId: string, youtube: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) =>
    setRun({ id, sceneId, status: "scheduled", phase: "created", platforms: { youtube }, durationMs: null, ...extra });

  it("asks for low latency on a crossword broadcast", async () => {
    channelYoutube = crossword({ accountId: "UC-cw" });
    accounts.set("UC-cw", { id: "UC-cw", refreshTokenEnc: "v1.x" });
    ytRun("cw", "daily");
    await goLive("cw");
    expect(yt.createBroadcast).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ latency: "low" }));
  });

  it("leaves a weather broadcast at YouTube's default latency", async () => {
    ytRun("wx", "default");
    await goLive("wx");
    expect((yt.createBroadcast as jest.Mock).mock.calls[0][1]).not.toHaveProperty("latency");
  });

  it("publishes to the channel record's account when the run names none", async () => {
    channelYoutube = crossword({ accountId: "UC-cw" });
    accounts.set("UC-cw", { id: "UC-cw", refreshTokenEnc: "v1.x" });
    ytRun("cw", "daily");
    await goLive("cw");
    expect(yt.getYoutubeClient).toHaveBeenCalledWith("UC-cw");
  });

  it("publishes to the run's own pick over the channel's", async () => {
    channelYoutube = crossword({ accountId: "UC-cw" });
    accounts.set("UC-cw", { id: "UC-cw", refreshTokenEnc: "v1.x" });
    accounts.set("UC-other", { id: "UC-other", refreshTokenEnc: "v1.y" });
    ytRun("cw", "daily", { accountId: "UC-other" });
    await goLive("cw");
    expect(yt.getYoutubeClient).toHaveBeenCalledWith("UC-other");
  });

  it("refuses a crossword channel with no YouTube channel, before any YouTube call", async () => {
    channelYoutube = crossword();
    ytRun("cw", "daily");
    await goLive("cw");
    const run = runs.get("cw");
    expect(run.status).toBe("failed");
    expect(run.error.message).toMatch(/has no YouTube channel/);
    expect(yt.getYoutubeClient).not.toHaveBeenCalled();
    expect(yt.createBroadcast).not.toHaveBeenCalled();
  });

  it("refuses a crossword account that needs reconnecting", async () => {
    channelYoutube = crossword({ accountId: "UC-cw" });
    accounts.set("UC-cw", { id: "UC-cw", refreshTokenEnc: "v1.x", authError: { kind: "auth-revoked", message: "x", at: 1 } });
    ytRun("cw", "daily");
    await goLive("cw");
    expect(runs.get("cw").status).toBe("failed");
    expect(runs.get("cw").error.message).toMatch(/needs reconnecting/);
    expect(yt.createBroadcast).not.toHaveBeenCalled();
  });

  it("keeps today's fallback for a weather channel with no account anywhere", async () => {
    ytRun("wx", "default");
    await goLive("wx");
    expect(yt.getYoutubeClient).toHaveBeenCalledWith(undefined);
    expect(runs.get("wx").status).toBe("awaiting-ingest");
  });

  it("defaults the title and description to crossword copy, with no weather blurb or map link", async () => {
    channelYoutube = crossword({ accountId: "UC-cw" });
    accounts.set("UC-cw", { id: "UC-cw", refreshTokenEnc: "v1.x" });
    ytRun("cw", "daily");
    await goLive("cw");
    const { title, description } = (yt.createBroadcast as jest.Mock).mock.calls[0][1];
    expect(title).toMatch(/^Daily Crossword — Live crossword — \d{4}-\d{2}-\d{2}$/);
    expect(description).toMatch(/^A live crossword/);
    expect(description).not.toMatch(/weather|Watch the map/);
  });

  it("uses the channel's own title template and description when set", async () => {
    channelYoutube = crossword({ accountId: "UC-cw", title: "Crossword %Y", description: "Play along" });
    accounts.set("UC-cw", { id: "UC-cw", refreshTokenEnc: "v1.x" });
    ytRun("cw", "daily");
    await goLive("cw");
    const { title, description } = (yt.createBroadcast as jest.Mock).mock.calls[0][1];
    expect(title).toMatch(/^Crossword \d{4}$/);
    expect(description).toBe("Play along");
  });

  it("shows the run's channel on a borrowed encoder and gives the encoder back when the run ends", async () => {
    channelYoutube = crossword({ accountId: "UC-cw" });
    accounts.set("UC-cw", { id: "UC-cw", refreshTokenEnc: "v1.x" });
    encoderOwnScene = "volcano";
    ytRun("cw", "daily", {}, { encoderId: "gpu-1" });
    await goLive("cw");
    expect(provisionEncoderScene).toHaveBeenCalledWith("gpu-1", { sceneId: "daily" });
    setRun({ ...runs.get("cw"), status: "live", startAt: Date.now() });
    (provisionEncoderScene as jest.Mock).mockClear();
    await finishRun("cw", "manual");
    expect(provisionEncoderScene).toHaveBeenCalledWith("gpu-1"); // its own scene, no override
  });

  it("leaves an encoder alone after a run on its own channel", async () => {
    ytRun("wx", "default", {}, { encoderId: "gpu-1" });
    await goLive("wx");
    setRun({ ...runs.get("wx"), status: "live", startAt: Date.now() });
    (provisionEncoderScene as jest.Mock).mockClear();
    await finishRun("wx", "manual");
    expect(provisionEncoderScene).not.toHaveBeenCalled();
    expect(idleEncoderScene).not.toHaveBeenCalled();
  });

  it("hands the encoder back when the run fails after provisioning (stream key refused)", async () => {
    channelYoutube = crossword({ accountId: "UC-cw" });
    accounts.set("UC-cw", { id: "UC-cw", refreshTokenEnc: "v1.x" });
    encoderOwnScene = "volcano";
    (obs.setStreamKey as jest.Mock).mockRejectedValueOnce(new Error("OBS said no"));
    ytRun("cw", "daily", {}, { encoderId: "gpu-1" });
    await goLive("cw");
    expect(runs.get("cw").status).toBe("failed");
    const calls = (provisionEncoderScene as jest.Mock).mock.calls;
    expect(calls[0]).toEqual(["gpu-1", { sceneId: "daily" }]);
    expect(calls.at(-1)).toEqual(["gpu-1"]);
  });

  it("an encoder bound to no channel goes idle, not to the main channel", async () => {
    channelYoutube = crossword({ accountId: "UC-cw" });
    accounts.set("UC-cw", { id: "UC-cw", refreshTokenEnc: "v1.x" });
    encoderOwnScene = null;
    ytRun("cw", "daily", {}, { encoderId: "gpu-spare" });
    await goLive("cw");
    (provisionEncoderScene as jest.Mock).mockClear();
    await finishRun("cw", "manual");
    expect(idleEncoderScene).toHaveBeenCalledWith("gpu-spare");
    expect(provisionEncoderScene).not.toHaveBeenCalled();
  });

  it("skips the hand-back while the run's standing slot is still on (the recycle shows it again)", async () => {
    encoderOwnScene = "volcano";
    slots.set("slot-1", { id: "slot-1", enabled: true });
    ytRun("wx", "atlantic", {}, { encoderId: "gpu-1", slotId: "slot-1" });
    await goLive("wx");
    (provisionEncoderScene as jest.Mock).mockClear();
    await finishRun("wx", "auto");
    expect(provisionEncoderScene).not.toHaveBeenCalled();

    // Slot turned off: the last run hands the encoder back.
    slots.set("slot-1", { id: "slot-1", enabled: false });
    ytRun("wx2", "atlantic", {}, { encoderId: "gpu-1", slotId: "slot-1" });
    await goLive("wx2");
    (provisionEncoderScene as jest.Mock).mockClear();
    await finishRun("wx2", "auto");
    expect(provisionEncoderScene).toHaveBeenCalledWith("gpu-1");
  });

  it("escapes a % in the channel name in the default title", async () => {
    channelYoutube = crossword({ accountId: "UC-cw", name: "Top %A Puzzles" });
    accounts.set("UC-cw", { id: "UC-cw", refreshTokenEnc: "v1.x" });
    ytRun("cw", "daily");
    await goLive("cw");
    expect((yt.createBroadcast as jest.Mock).mock.calls[0][1].title).toMatch(/^Top %A Puzzles — Live crossword — /);
  });
});

describe("rearmLiveRuns", () => {
  it("finishes a run a restart left \"ending\", and hands its encoder back", async () => {
    encoderOwnScene = "volcano";
    setRun({
      id: "half",
      sceneId: "daily",
      encoderId: "gpu-1",
      status: "ending",
      phase: "live",
      startAt: Date.now() - 60_000,
      platforms: { youtube: { broadcastId: "b1", accountId: "UC-cw" } },
    });
    await rearmLiveRuns();
    expect(runs.get("half").status).toBe("ended");
    expect(obs.stopStream).toHaveBeenCalled();
    expect(provisionEncoderScene).toHaveBeenCalledWith("gpu-1");
  });
});
