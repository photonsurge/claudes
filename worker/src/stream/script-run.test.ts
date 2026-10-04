// A video render through the REAL run pipeline (lifecycle.ts + script-run.ts):
// live, script start, script end, a stopped play, the go-live deadline, a
// restart, every clean-up path and the finalize-before-chapters order. OBS,
// YouTube, Mongo, the queue and the render queue are mocked in the style of
// lifecycle.test.ts — we assert the ORDER of external calls and the run state.

jest.mock("./monitor", () => ({ startMonitor: jest.fn(), stopMonitor: jest.fn(), stopAllMonitors: jest.fn() }));
jest.mock("../socket", () => ({ emitWorkerEvent: jest.fn() }));
jest.mock("@photonsurge/shared/utill/logger", () => ({ log: jest.fn() }));
jest.mock("./chat", () => ({ startChatPoll: jest.fn(), stopChatPoll: jest.fn() }));
jest.mock("./announce", () => ({ queueAnnounce: jest.fn(async () => {}) }));

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
    ensureOutputStopped: jest.fn(async () => false),
    lastStreamStateFor: jest.fn(() => undefined),
    outputInFlight: jest.fn(() => false),
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

const PROVISIONED = {
  sceneName: "x",
  inputName: "y",
  url: "u",
  width: 1920,
  height: 1080,
  created: false,
  recreated: true,
  switched: true,
  refreshed: true,
  removedInputs: [],
  removedScenes: [],
};
jest.mock("./encoders", () => ({
  watchBaseUrl: () => "http://localhost:10100",
  endpointForRun: jest.fn(async () => ({ url: "ws://obs-test:4455" })),
  provisionEncoderScene: jest.fn(async (_e: string, o?: { sceneId?: string }) => ({ ...PROVISIONED, sceneId: o?.sceneId ?? "default" })),
  restoreEncoderScene: jest.fn(async () => ({ idle: true, url: "about:blank" })),
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
  deleteBroadcast: jest.fn(async () => {}),
  updateVideoMeta: jest.fn(async () => ({ changed: true })),
  addToPlaylist: jest.fn(async () => {}),
}));

jest.mock("./chapters", () => ({ queueChapters: jest.fn(async () => {}), chaptersEnabled: jest.fn(() => true) }));
jest.mock("./thumbnail", () => ({ queueThumbnail: jest.fn(async () => {}), thumbnailsEnabled: () => true }));
jest.mock("./channel-youtube", () => ({
  channelYoutubeSettings: jest.fn(async () => ({ title: "Channel %d", description: "Channel desc", thumbnailUrl: "" })),
}));
jest.mock("./render-queue", () => ({ renderRunLive: jest.fn(async () => {}), renderRunSettled: jest.fn(async () => {}) }));

const jobs: { event: string; data: any; opts: any }[] = [];
const fakeQueue = {
  add: jest.fn(async (_n: string, payload: any, opts: any) => {
    jobs.push({ event: payload.event, data: payload.data, opts });
    return {};
  }),
  getJob: jest.fn(async () => null),
};
jest.mock("@photonsurge/shared/bull/bull", () => ({ getQueue: jest.fn(() => fakeQueue) }));

// In-memory Mongo stand-in.
const runs = new Map<string, any>();
const configs = new Map<string, any>();
const scripts = new Map<string, any>();
const ACTIVE = new Set(["scheduled", "awaiting-ingest", "live", "ending"]);
const db = {
  getRun: jest.fn(async (id: string) => (runs.has(id) ? structuredClone(runs.get(id)) : null)),
  updateRun: jest.fn(async (id: string, patch: any) => {
    const next = { ...(runs.get(id) ?? { id }), ...structuredClone(patch) };
    runs.set(id, next);
    return structuredClone(next);
  }),
  listRuns: jest.fn(async (f: { sceneId?: string; status?: string | string[] } = {}) =>
    [...runs.values()]
      .filter((r) => !f.sceneId || r.sceneId === f.sceneId)
      .filter((r) => !f.status || (Array.isArray(f.status) ? f.status : [f.status]).includes(r.status))
      .map((r) => structuredClone(r)),
  ),
  // Mirrors the real accessor: YouTube runs AND video renders occupy an encoder.
  activeRunForEncoder: jest.fn(
    async (encoderId: string, excludeRunId?: string) =>
      [...runs.values()].find(
        (r) =>
          r.id !== excludeRunId &&
          ACTIVE.has(r.status) &&
          (!!r.platforms?.youtube || !!r.script?.scriptId) &&
          (r.encoderId || "env") === (encoderId || "env"),
      ) ?? null,
  ),
  getOrInitDirectorConfig: jest.fn(async (sceneId: string) => structuredClone(configs.get(sceneId) ?? { mode: "off" })),
  saveDirectorConfig: jest.fn(async (sceneId: string, patch: any) => {
    configs.set(sceneId, { ...(configs.get(sceneId) ?? { mode: "off" }), ...patch });
  }),
  shortScripts: { get: jest.fn(async (id: string) => scripts.get(id) ?? null) },
};
jest.mock("@photonsurge/shared/db/index", () => ({ getAppDb: jest.fn(async () => db) }));

import { goLive, finishRun, rearmLiveRuns } from "./lifecycle";
import {
  finalizeScriptRun,
  onScriptPlayEnded,
  onScriptRunOver,
  scriptGoLiveOverdue,
  startScriptPlay,
} from "./script-run";
import { startMonitor } from "./monitor";
import * as obs from "../obs/client";
import * as yt from "../youtube/client";
import { provisionEncoderScene, restoreEncoderScene } from "./encoders";
import { startChatPoll } from "./chat";
import { queueAnnounce } from "./announce";
import { queueChapters } from "./chapters";
import { renderRunLive, renderRunSettled } from "./render-queue";

/** A render that went live on YouTube: its broadcast exists. */
const AIRED = { youtube: { accountId: "acc", broadcastId: "bcast", streamId: "strm", watchUrl: "https://youtu.be/bcast" } };

const SCRIPT = { scriptId: "s1", renderId: "rd1", offline: false, publishAs: "public", leadInMs: 3000, leadOutMs: 5000, tags: ["weather"], categoryId: "25", chapters: true };

/** A render run as the queue creates it (render-queue.ts startRender). */
function renderRun(id: string, extra: any = {}) {
  const run = {
    id,
    sceneId: "shorts",
    encoderId: "obs-v1",
    status: "scheduled",
    phase: "created",
    title: "Europe round-up · Sunday 4 October",
    description: "Europe today.\n\nWatch the map live: http://localhost:10100",
    privacy: "unlisted",
    durationMs: 75_000 + 8_000 + 120_000,
    platforms: { youtube: { accountId: "acc", monitorStream: false } },
    chat: { enabled: false, promoteToTicker: false },
    announce: false,
    script: { ...SCRIPT },
    ...extra,
  };
  runs.set(id, run);
  return run;
}

/** The monitor tick goLive registered for a run. */
const tickFor = (id: string): (() => Promise<number>) => {
  const call = (startMonitor as jest.Mock).mock.calls.filter((c) => c[0] === id).pop();
  if (!call) throw new Error("monitor not started");
  return call[1];
};

const jobsOf = (event: string) => jobs.filter((j) => j.event === event);
const callOrder = (fn: unknown, i = 0) => (fn as jest.Mock).mock.invocationCallOrder[i];

beforeEach(() => {
  runs.clear();
  configs.clear();
  scripts.clear();
  jobs.length = 0;
  jest.clearAllMocks();
});

describe("live", () => {
  it("goes live on the script's scene with the queue's title as written, no chat, and starts the script after the lead-in", async () => {
    renderRun("v1");
    await goLive("v1");

    // The encoder shows the SCRIPT's scene, not its own binding.
    expect(provisionEncoderScene).toHaveBeenCalledWith("obs-v1", { sceneId: "shorts" });
    // Title and description used as written — never through the channel's template.
    expect(yt.createBroadcast).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ title: "Europe round-up · Sunday 4 October", description: runs.get("v1").description, privacy: "unlisted" }),
    );
    expect(runs.get("v1").script.goLiveAt).toEqual(expect.any(Number));
    expect(runs.get("v1").status).toBe("awaiting-ingest");

    await tickFor("v1")(); // ingest active → transitionToLive
    const run = runs.get("v1");
    expect(run.status).toBe("live");
    // No chat: no chat id lookup, no poller, nothing announced.
    expect(yt.resolveLiveChatId).not.toHaveBeenCalled();
    expect(startChatPoll).not.toHaveBeenCalled();
    expect(queueAnnounce).not.toHaveBeenCalled();
    expect(run.platforms.youtube.liveChatId).toBeUndefined();
    // onScriptRunLive: the render is marked live and the start is queued after the lead-in.
    expect(renderRunLive).toHaveBeenCalledWith(expect.objectContaining({ id: "v1" }));
    expect(jobsOf("scriptStart")).toEqual([
      expect.objectContaining({ data: { runId: "v1" }, opts: expect.objectContaining({ delay: 3000, jobId: "script-start-v1" }) }),
    ]);
  });

  it("starts the play recorded, storing the nonce on the run first; a second start is a no-op", async () => {
    renderRun("v2", { status: "live", startAt: Date.now() });
    configs.set("shorts", { mode: "off", script: { scriptId: "old", fromClip: 0, playNonce: 9e15, record: false } });
    const res = await startScriptPlay("v2");
    expect(res.started).toBe(true);
    expect(res.playNonce).toBe(9e15 + 1); // never one the runner already answered
    expect(runs.get("v2").script.playNonce).toBe(9e15 + 1);
    expect(configs.get("shorts")).toMatchObject({ mode: "script", script: { scriptId: "s1", fromClip: 0, playNonce: 9e15 + 1, record: true } });
    expect(callOrder(db.updateRun)).toBeLessThan(callOrder(db.saveDirectorConfig));
    expect((await startScriptPlay("v2")).skipped).toBe("already started");
  });

  it("an offline render runs the busy guard, provisions the scene and calls onScriptRunLive from goLive's no-YouTube branch", async () => {
    renderRun("busy", { status: "live", sceneId: "default", script: undefined, platforms: { youtube: { broadcastId: "b0" } } });
    renderRun("off1", { platforms: {}, script: { ...SCRIPT, offline: true } });
    await goLive("off1");
    expect(runs.get("off1").status).toBe("failed");
    expect(runs.get("off1").error.message).toMatch(/one OBS instance supports one concurrent stream/);
    expect(provisionEncoderScene).not.toHaveBeenCalled();
    expect(obs.stopStream).not.toHaveBeenCalled(); // never stops the OTHER run's output
    expect(restoreEncoderScene).not.toHaveBeenCalled(); // nor repoints its encoder

    runs.get("busy").status = "ended";
    renderRun("off2", { platforms: {}, script: { ...SCRIPT, offline: true } });
    await goLive("off2");
    expect(runs.get("off2").status).toBe("live");
    expect(provisionEncoderScene).toHaveBeenCalledWith("obs-v1", { sceneId: "shorts" });
    expect(yt.createBroadcast).not.toHaveBeenCalled();
    expect(obs.startStream).not.toHaveBeenCalled();
    expect(renderRunLive).toHaveBeenCalledWith(expect.objectContaining({ id: "off2" }));
    expect(jobsOf("scriptStart").map((j) => j.data.runId)).toEqual(["off2"]);
  });
});

describe("script end", () => {
  it("a finished play ends the run after the lead-out; finishing restores the encoder and queues finalize, not chapters", async () => {
    renderRun("e1", { status: "live", startAt: Date.now(), platforms: AIRED, script: { ...SCRIPT, playNonce: 77 } });
    await onScriptPlayEnded("shorts", { sceneId: "shorts", playNonce: 77, startedAt: 1, endedAt: 2, clips: [{ id: "c", startMs: 0, durationMs: 1 }], skipped: [] });
    expect(runs.get("e1").script.playEnded).toBe("finished");
    const end = jobsOf("end").pop()!;
    expect(end).toMatchObject({ data: { runId: "e1", reason: "auto" }, opts: expect.objectContaining({ delay: 5000, jobId: "run-end-e1" }) });

    await finishRun("e1", "auto"); // the lead-out job fires
    const run = runs.get("e1");
    expect(run.status).toBe("ended");
    expect(yt.transitionBroadcast).toHaveBeenCalledWith(expect.anything(), "bcast", "complete");
    expect(restoreEncoderScene).toHaveBeenCalledWith("obs-v1");
    expect(jobsOf("finalize")).toEqual([expect.objectContaining({ data: { runId: "e1" } })]);
    expect(queueChapters).not.toHaveBeenCalled(); // finalize queues them, after it writes
    expect(yt.deleteBroadcast).not.toHaveBeenCalled();
    expect(renderRunSettled).toHaveBeenCalledWith(expect.objectContaining({ id: "e1", status: "ended" }));
  });

  it("a play on another nonce (a preview) is ignored", async () => {
    renderRun("e2", { status: "live", startAt: 1, script: { ...SCRIPT, playNonce: 5 } });
    await onScriptPlayEnded("shorts", { sceneId: "shorts", playNonce: 6, startedAt: 1, endedAt: 2, clips: [{ id: "c", startMs: 0, durationMs: 1 }], skipped: [] });
    expect(runs.get("e2").status).toBe("live");
    expect(jobs).toEqual([]);
  });
});

describe("a stopped play", () => {
  it("fails the run: YouTube completed, OBS stopped, encoder restored, no finalize; the VOD stays unlisted", async () => {
    renderRun("st1", { status: "live", startAt: Date.now(), platforms: AIRED, script: { ...SCRIPT, playNonce: 8 } });
    await onScriptPlayEnded("shorts", { sceneId: "shorts", playNonce: 8, startedAt: 1, endedAt: 2, stopped: true, clips: [{ id: "c", startMs: 0, durationMs: 1 }], skipped: [] });
    const run = runs.get("st1");
    expect(run.status).toBe("failed");
    expect(run.error).toMatchObject({ step: "script", message: expect.stringMatching(/stopped before its end/) });
    expect(run.script.playEnded).toBe("stopped");
    expect(yt.transitionBroadcast).toHaveBeenCalledWith(expect.anything(), "bcast", "complete");
    expect(obs.stopStream).toHaveBeenCalled();
    expect(restoreEncoderScene).toHaveBeenCalledWith("obs-v1");
    expect(yt.deleteBroadcast).not.toHaveBeenCalled(); // it aired; the VOD is kept, unlisted
    expect(jobsOf("finalize")).toEqual([]);
    expect(renderRunSettled).toHaveBeenCalledWith(expect.objectContaining({ id: "st1", status: "failed" }));
  });

  it("a play with nothing to play fails the run with the skip reasons", async () => {
    renderRun("st2", { status: "live", startAt: Date.now(), script: { ...SCRIPT, playNonce: 9 } });
    await onScriptPlayEnded("shorts", { sceneId: "shorts", playNonce: 9, startedAt: 1, endedAt: 1, clips: [], skipped: [{ id: "c", reason: "alert expired" }] });
    expect(runs.get("st2").error.message).toBe("nothing to play: alert expired");
  });

  it("an operator Stop ends a live render as stopped, and stops its play", async () => {
    renderRun("st3", { status: "live", startAt: Date.now(), script: { ...SCRIPT, playNonce: 10 } });
    configs.set("shorts", { mode: "script", script: { scriptId: "s1", playNonce: 10 } });
    await finishRun("st3", "manual");
    expect(runs.get("st3").status).toBe("stopped");
    expect(configs.get("shorts").mode).toBe("off");
    expect(jobsOf("finalize")).toEqual([]);
    expect(renderRunSettled).toHaveBeenCalledWith(expect.objectContaining({ id: "st3", status: "stopped" }));
  });

  it("does not stop another play on the scene (an operator started something else)", async () => {
    renderRun("st4", { status: "live", startAt: Date.now(), script: { ...SCRIPT, playNonce: 10 } });
    configs.set("shorts", { mode: "script", script: { scriptId: "other", playNonce: 11 } });
    await finishRun("st4", "manual");
    expect(configs.get("shorts").mode).toBe("script");
  });
});

describe("the deadline", () => {
  it("fails a render still awaiting ingest past RENDER_GOLIVE_DEADLINE_MS and deletes its never-live broadcast", async () => {
    renderRun("d1");
    await goLive("d1");
    (yt.getStreamStatus as jest.Mock).mockResolvedValue({ streamStatus: "ready" });
    const tick = tickFor("d1");
    expect(await tick()).toBeGreaterThan(0); // inside the deadline: keep confirming

    runs.get("d1").script.goLiveAt = Date.now() - 121_000;
    expect(await tick()).toBe(-1);
    const run = runs.get("d1");
    expect(run.status).toBe("failed");
    expect(run.error.step).toBe("deadline");
    expect(obs.stopStream).toHaveBeenCalled();
    expect(yt.deleteBroadcast).toHaveBeenCalledWith(expect.anything(), "bcast");
    expect(restoreEncoderScene).toHaveBeenCalledWith("obs-v1");
    expect(renderRunSettled).toHaveBeenCalledWith(expect.objectContaining({ id: "d1", status: "failed" }));
    (yt.getStreamStatus as jest.Mock).mockResolvedValue({ streamStatus: "active", health: "good" });
  });

  it("is env-configurable and only applies to video renders waiting to go live", () => {
    const now = 1_000_000;
    const base = { id: "x", sceneId: "s", platforms: {}, status: "awaiting-ingest", script: { ...SCRIPT, goLiveAt: now - 61_000 } } as any;
    expect(scriptGoLiveOverdue(base, now)).toBe(false);
    process.env.RENDER_GOLIVE_DEADLINE_MS = "60000";
    try {
      expect(scriptGoLiveOverdue(base, now)).toBe(true);
      expect(scriptGoLiveOverdue({ ...base, status: "live" }, now)).toBe(false);
      expect(scriptGoLiveOverdue({ ...base, script: undefined }, now)).toBe(false);
    } finally {
      delete process.env.RENDER_GOLIVE_DEADLINE_MS;
    }
  });
});

describe("clean-up paths", () => {
  it("a YouTube step failing in goLive deletes the broadcast it made, stops OBS and restores the encoder", async () => {
    (yt.bindBroadcast as jest.Mock).mockRejectedValueOnce(new Error("bind failed"));
    renderRun("c1");
    await goLive("c1");
    expect(runs.get("c1").status).toBe("failed");
    expect(yt.deleteBroadcast).toHaveBeenCalledWith(expect.anything(), "bcast");
    expect(obs.stopStream).toHaveBeenCalled();
    expect(restoreEncoderScene).toHaveBeenCalledWith("obs-v1");
    expect(renderRunSettled).toHaveBeenCalled();
  });

  it("a Stop before the render went live deletes the broadcast instead of completing it", async () => {
    renderRun("c2", { status: "awaiting-ingest", platforms: { youtube: { accountId: "acc", broadcastId: "bcast" } } });
    await finishRun("c2", "manual");
    expect(yt.transitionBroadcast).not.toHaveBeenCalled();
    expect(yt.deleteBroadcast).toHaveBeenCalledWith(expect.anything(), "bcast");
    expect(runs.get("c2").status).toBe("stopped");
  });

  it("the safety cap ending a render mid-play records it unfinished: no finalize", async () => {
    renderRun("c3", { status: "live", startAt: Date.now(), script: { ...SCRIPT, playNonce: 3 } });
    await finishRun("c3", "auto");
    expect(runs.get("c3").status).toBe("ended");
    expect(jobsOf("finalize")).toEqual([]);
  });

  it("clean-up is best-effort: a failing delete or restore never throws", async () => {
    (yt.deleteBroadcast as jest.Mock).mockRejectedValueOnce(new Error("gone"));
    (restoreEncoderScene as jest.Mock).mockRejectedValueOnce(new obs.ObsUnavailableError("down"));
    renderRun("c4", { status: "failed", platforms: { youtube: { accountId: "acc", broadcastId: "bcast" } } });
    await expect(onScriptRunOver(runs.get("c4"))).resolves.toBeUndefined();
    expect(renderRunSettled).toHaveBeenCalled();
  });

  it("a channel run is not touched by any of it", async () => {
    runs.set("ch", { id: "ch", sceneId: "default", status: "live", platforms: { youtube: { broadcastId: "b" } }, startAt: 1 });
    await finishRun("ch", "manual");
    expect(restoreEncoderScene).not.toHaveBeenCalled();
    expect(queueChapters).toHaveBeenCalledWith("ch"); // as before
    expect(renderRunSettled).not.toHaveBeenCalled();
  });
});

describe("a restart", () => {
  const record = (extra: any) => ({ id: "s1", plays: [{ sceneId: "shorts", playNonce: 50, startedAt: 1, clips: [{ id: "c", startMs: 0, durationMs: 1 }], skipped: [], ...extra }] });

  it("fails a live render whose play the restart cut short", async () => {
    renderRun("r1", { status: "live", startAt: Date.now() - 30_000, script: { ...SCRIPT, playNonce: 50 } });
    scripts.set("s1", record({})); // never ended
    await rearmLiveRuns();
    const run = runs.get("r1");
    expect(run.status).toBe("failed");
    expect(run.error).toMatchObject({ step: "restart" });
    expect(restoreEncoderScene).toHaveBeenCalled();
    expect(startMonitor).not.toHaveBeenCalledWith("r1", expect.anything());
  });

  it("also fails one the runner already closed as stopped at boot", async () => {
    renderRun("r2", { status: "live", startAt: Date.now() - 30_000, script: { ...SCRIPT, playNonce: 50 } });
    scripts.set("s1", record({ endedAt: 5, stopped: true }));
    await rearmLiveRuns();
    expect(runs.get("r2").status).toBe("failed");
  });

  it("ends (not fails) one whose play finished just before the restart, and finalizes it", async () => {
    renderRun("r3", { status: "live", startAt: Date.now() - 90_000, platforms: AIRED, script: { ...SCRIPT, playNonce: 50 } });
    scripts.set("s1", record({ endedAt: 5 }));
    await rearmLiveRuns();
    expect(runs.get("r3").status).toBe("ended");
    expect(jobsOf("finalize").map((j) => j.data.runId)).toEqual(["r3"]);
  });

  it("re-queues the start of one still inside its lead-in, and rearms it as usual", async () => {
    renderRun("r4", { status: "live", startAt: Date.now() - 1_000 });
    await rearmLiveRuns();
    const start = jobsOf("scriptStart")[0];
    expect(start.opts.jobId).toBe("script-start-r4");
    expect(start.opts.delay).toBeGreaterThan(1_000);
    expect(start.opts.delay).toBeLessThanOrEqual(2_000);
    expect(startMonitor).toHaveBeenCalledWith("r4", expect.any(Function));
    expect(runs.get("r4").status).toBe("live");
  });

  it("rearms one awaiting ingest so its deadline still applies", async () => {
    renderRun("r5", { status: "awaiting-ingest", script: { ...SCRIPT, goLiveAt: Date.now() } });
    await rearmLiveRuns();
    expect(startMonitor).toHaveBeenCalledWith("r5", expect.any(Function));
  });
});

describe("finalize", () => {
  it("writes tags, category and privacy, then the playlist, and only then queues chapters", async () => {
    renderRun("f1", { status: "ended", startAt: 1, platforms: { youtube: { accountId: "acc", broadcastId: "bcast" } }, script: { ...SCRIPT, playlistId: "PL1", playEnded: "finished" } });
    const res = await finalizeScriptRun("f1");
    expect(res).toMatchObject({ ok: true, playlist: true, chapters: true });
    expect(yt.updateVideoMeta).toHaveBeenCalledWith(expect.anything(), "bcast", { tags: ["weather"], categoryId: "25", privacy: "public" });
    expect(yt.addToPlaylist).toHaveBeenCalledWith(expect.anything(), "PL1", "bcast");
    expect(queueChapters).toHaveBeenCalledWith("f1");
    expect(callOrder(yt.updateVideoMeta)).toBeLessThan(callOrder(yt.addToPlaylist));
    expect(callOrder(yt.addToPlaylist)).toBeLessThan(callOrder(queueChapters));
    expect(runs.get("f1").script).toMatchObject({ finalizedAt: expect.any(Number), playlistAddedAt: expect.any(Number), finalizeError: null });
    // Idempotent.
    expect((await finalizeScriptRun("f1")).skipped).toBe("already finalized");
    expect(yt.updateVideoMeta).toHaveBeenCalledTimes(1);
  });

  it("a failure records the error, throws for a retry, queues no chapters — and the retry never re-adds the playlist", async () => {
    renderRun("f2", { status: "ended", startAt: 1, platforms: { youtube: { accountId: "acc", broadcastId: "bcast" } }, script: { ...SCRIPT, playlistId: "PL1", playlistAddedAt: 123 } });
    (yt.updateVideoMeta as jest.Mock).mockRejectedValueOnce(new Error("videos.update: 500"));
    await expect(finalizeScriptRun("f2")).rejects.toThrow("500");
    expect(runs.get("f2").script.finalizeError).toMatch(/500/);
    expect(queueChapters).not.toHaveBeenCalled();
    await finalizeScriptRun("f2");
    expect(yt.addToPlaylist).not.toHaveBeenCalled();
    expect(queueChapters).toHaveBeenCalledWith("f2");
  });

  it("queues no chapters when the format has them off", async () => {
    renderRun("f3", { status: "ended", startAt: 1, platforms: { youtube: { accountId: "acc", broadcastId: "bcast" } }, script: { ...SCRIPT, chapters: false } });
    expect((await finalizeScriptRun("f3")).chapters).toBe(false);
    expect(queueChapters).not.toHaveBeenCalled();
  });
});

describe("the offline rehearsal (§7, WP8)", () => {
  /** Every function of the YouTube client mock that was called: none may be, offline. */
  const youtubeCalls = () =>
    Object.entries(yt)
      .filter(([, fn]) => jest.isMockFunction(fn) && (fn as jest.Mock).mock.calls.length > 0)
      .map(([name]) => name);

  it("holds the encoder, plays on the format's /watch page, finishes and restores the encoder — never contacting YouTube", async () => {
    renderRun("t1", { platforms: {}, script: { ...SCRIPT, offline: true } });
    await goLive("t1");

    // Live straight away, on the script's scene, with nothing streamed.
    let run = runs.get("t1");
    expect(run.status).toBe("live");
    expect(run.platforms.youtube).toBeUndefined();
    expect(run.script.offline).toBe(true);
    expect(provisionEncoderScene).toHaveBeenCalledWith("obs-v1", { sceneId: "shorts" });
    expect(obs.setStreamKey).not.toHaveBeenCalled();
    expect(obs.startStream).not.toHaveBeenCalled();
    // The busy guard counts it: a second render on the same encoder is refused.
    expect(await db.activeRunForEncoder("obs-v1", "other")).toMatchObject({ id: "t1" });
    renderRun("t2", { platforms: {}, script: { ...SCRIPT, offline: true } });
    await goLive("t2");
    expect(runs.get("t2").status).toBe("failed");
    expect(runs.get("t2").error.message).toMatch(/already streaming run t1/);
    expect(restoreEncoderScene).not.toHaveBeenCalled(); // the refused one leaves t1's encoder alone

    // The lead-in job starts the play; the runner reports it finished.
    expect(jobsOf("scriptStart").map((j) => j.data.runId)).toEqual(["t1"]);
    const { playNonce } = await startScriptPlay("t1");
    expect(configs.get("shorts")).toMatchObject({ mode: "script", script: { scriptId: "s1", record: true } });
    await onScriptPlayEnded("shorts", {
      sceneId: "shorts",
      playNonce: playNonce!,
      startedAt: 1,
      endedAt: 2,
      clips: [{ id: "c", startMs: 0, durationMs: 1 }],
      skipped: [],
    });
    expect(jobsOf("end").pop()).toMatchObject({ data: { runId: "t1" }, opts: expect.objectContaining({ delay: 5000 }) });
    await finishRun("t1", "auto");

    run = runs.get("t1");
    expect(run.status).toBe("ended");
    expect(run.script.playEnded).toBe("finished");
    expect(restoreEncoderScene).toHaveBeenCalledWith("obs-v1"); // video encoder → idle blank page
    expect(obs.stopStream).not.toHaveBeenCalled(); // it never started an output
    expect(jobsOf("finalize")).toEqual([]);
    expect(renderRunSettled).toHaveBeenCalledWith(expect.objectContaining({ id: "t1", status: "ended" }));
    expect(youtubeCalls()).toEqual([]);
  });

  it("an OBS that can't be provisioned fails the test (nobody is watching it), still without YouTube", async () => {
    (provisionEncoderScene as jest.Mock).mockRejectedValueOnce(new obs.ObsUnavailableError("cannot reach OBS at ws://obs-v1"));
    renderRun("t3", { platforms: {}, script: { ...SCRIPT, offline: true } });
    await goLive("t3");
    const run = runs.get("t3");
    expect(run.status).toBe("failed");
    expect(run.error).toMatchObject({ step: "goLive", message: expect.stringMatching(/cannot reach OBS/) });
    expect(jobsOf("scriptStart")).toEqual([]);
    expect(renderRunSettled).toHaveBeenCalledWith(expect.objectContaining({ id: "t3", status: "failed" }));
    expect(youtubeCalls()).toEqual([]);
  });

  it("an operator Stop of an offline test ends it as stopped, without touching an OBS output or YouTube", async () => {
    renderRun("t4", { status: "live", startAt: Date.now(), platforms: {}, script: { ...SCRIPT, offline: true, playNonce: 12 } });
    configs.set("shorts", { mode: "script", script: { scriptId: "s1", playNonce: 12 } });
    await finishRun("t4", "manual");
    expect(runs.get("t4").status).toBe("stopped");
    expect(configs.get("shorts").mode).toBe("off");
    expect(obs.stopStream).not.toHaveBeenCalled();
    expect(restoreEncoderScene).toHaveBeenCalledWith("obs-v1");
    expect(youtubeCalls()).toEqual([]);
  });
});
