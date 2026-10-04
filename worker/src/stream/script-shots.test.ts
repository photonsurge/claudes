// OBS screenshots of a video render (short-video plan §7 "Evidence", §6.8
// frame thumbnails): when they are scheduled, what a capture stores and
// records, "latest test per script only", and the frame thumbnail's upload
// through the real thumbnail path (sharp → 1280×720 JPEG → thumbnails.set).

jest.mock("@photonsurge/shared/utill/logger", () => ({ log: jest.fn() }));
jest.mock("../socket", () => ({ emitWorkerEvent: jest.fn() }));
jest.mock("./encoders", () => ({
  watchBaseUrl: () => "http://localhost:10100",
  screenshotRunScene: jest.fn(),
}));
jest.mock("./channel-youtube", () => ({ channelYoutubeSettings: jest.fn(async () => ({})) }));
jest.mock("../youtube/client", () => ({
  getYoutubeClient: jest.fn(async () => ({ youtube: {}, accountId: "acc", channelId: "acc" })),
  setThumbnail: jest.fn(async () => {}),
}));

const jobs: { event: string; data: any; opts: any }[] = [];
const fakeQueue = {
  add: jest.fn(async (_n: string, payload: any, opts: any) => {
    jobs.push({ event: payload.event, data: payload.data, opts });
    return {};
  }),
};
jest.mock("@photonsurge/shared/bull/bull", () => ({ getQueue: jest.fn(() => fakeQueue) }));

const runs = new Map<string, any>();
const blobs = new Map<string, Buffer>();
const db: any = {
  blobFs: {},
  blobs: {
    shortTest: {
      put: jest.fn(async (id: string, data: Buffer) => void blobs.set(id, data)),
      delete: jest.fn(async (ids: string[]) => ids.forEach((id) => blobs.delete(id))),
    },
  },
  getRun: jest.fn(async (id: string) => (runs.has(id) ? structuredClone(runs.get(id)) : null)),
  updateRun: jest.fn(async (id: string, patch: any) => {
    const next = { ...(runs.get(id) ?? { id }), ...structuredClone(patch) };
    runs.set(id, next);
    return structuredClone(next);
  }),
  listRuns: jest.fn(async (f: { sceneId?: string; status?: string[] } = {}) =>
    [...runs.values()]
      .filter((r) => !f.sceneId || r.sceneId === f.sceneId)
      .filter((r) => !f.status || f.status.includes(r.status))
      .map((r) => structuredClone(r)),
  ),
  runsWithShotsForScript: jest.fn(async (scriptId: string, exclude?: string) =>
    [...runs.values()].filter((r) => r.script?.scriptId === scriptId && r.id !== exclude && r.shots?.length).map((r) => structuredClone(r)),
  ),
};
jest.mock("@photonsurge/shared/db/index", () => ({ getAppDb: jest.fn(async () => db) }));

import sharp from "sharp";
import {
  captureFrameThumbnail,
  captureScriptShot,
  frameDueAt,
  liveShotsEnabled,
  onScriptPlayStarted,
  shotSchedule,
  shotsWanted,
} from "./script-shots";
import { screenshotRunScene } from "./encoders";
import * as yt from "../youtube/client";

const shoot = screenshotRunScene as jest.Mock;
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);

const PLAY = {
  sceneId: "shorts",
  playNonce: 42,
  startedAt: 100_000,
  clips: [
    { id: "c1", startMs: 0, durationMs: 10_000 },
    { id: "c3", startMs: 10_000, durationMs: 6_000 },
  ],
  skipped: [{ id: "c2", reason: "alert expired" }],
};

function render(id: string, extra: any = {}) {
  const run = {
    id,
    sceneId: "shorts",
    encoderId: "obs-v1",
    status: "live",
    platforms: {},
    script: { scriptId: "s1", offline: true, publishAs: "unlisted", leadInMs: 3000, leadOutMs: 5000, playNonce: 42 },
    ...extra,
  };
  runs.set(id, run);
  return run;
}

beforeEach(() => {
  runs.clear();
  blobs.clear();
  jobs.length = 0;
  jest.clearAllMocks();
  delete process.env.RENDER_SHOTS_LIVE;
  db.blobFs = {};
  shoot.mockResolvedValue({ mimeType: "image/jpeg", data: JPEG });
});

describe("scheduling", () => {
  it("one shot per clip that aired, at its midpoint on the play's own clock", () => {
    expect(shotSchedule(PLAY)).toEqual([
      { clipIndex: 0, clipId: "c1", at: 105_000 },
      { clipIndex: 1, clipId: "c3", at: 113_000 },
    ]);
  });

  it("a frame offset is clamped inside the play", () => {
    expect(frameDueAt(PLAY, 4_000)).toBe(104_000);
    expect(frameDueAt(PLAY, 999_000)).toBe(100_000 + 16_000 - 500);
    expect(frameDueAt(PLAY, -5)).toBe(100_000);
  });

  it("offline tests always take shots; live renders only with RENDER_SHOTS_LIVE=on", () => {
    expect(shotsWanted({ script: { offline: true, scriptId: "s" } as any })).toBe(true);
    expect(shotsWanted({ script: { offline: false, scriptId: "s" } as any })).toBe(false);
    expect(liveShotsEnabled({ RENDER_SHOTS_LIVE: "on" })).toBe(true);
    expect(shotsWanted({ script: { offline: false, scriptId: "s" } as any }, { RENDER_SHOTS_LIVE: "on" })).toBe(true);
  });

  it("the play-started hook queues a durable delayed job per clip for an offline test", async () => {
    render("t1");
    await onScriptPlayStarted("shorts", PLAY, 101_000);
    expect(jobs.map((j) => [j.event, j.data.clipIndex, j.opts.delay, j.opts.jobId])).toEqual([
      ["scriptShot", 0, 4_000, "script-shot-t1-0"],
      ["scriptShot", 1, 12_000, "script-shot-t1-1"],
    ]);
    expect(jobs[0].data).toEqual({ runId: "t1", playNonce: 42, clipIndex: 0, clipId: "c1" });
  });

  it("ignores a play no live render answers (a preview)", async () => {
    render("t1", { script: { scriptId: "s1", offline: true, playNonce: 41 } });
    await onScriptPlayStarted("shorts", PLAY, 101_000);
    expect(jobs).toEqual([]);
  });

  it("a live render takes no shots by default, but schedules its frame thumbnail", async () => {
    render("v1", {
      platforms: { youtube: { accountId: "acc", broadcastId: "bcast" } },
      script: { scriptId: "s1", offline: false, playNonce: 42, thumbnailFrameAtMs: 4_000 },
    });
    await onScriptPlayStarted("shorts", PLAY, 101_000);
    expect(jobs.map((j) => [j.event, j.opts.delay, j.opts.jobId])).toEqual([["scriptFrame", 3_000, "script-frame-v1"]]);

    jobs.length = 0;
    process.env.RENDER_SHOTS_LIVE = "on";
    await onScriptPlayStarted("shorts", PLAY, 101_000);
    expect(jobs.map((j) => j.event)).toEqual(["scriptShot", "scriptShot", "scriptFrame"]);
  });

  it("an offline test never schedules a frame thumbnail", async () => {
    render("t1", { script: { scriptId: "s1", offline: true, playNonce: 42, thumbnailFrameAtMs: 4_000 } });
    await onScriptPlayStarted("shorts", PLAY, 101_000);
    expect(jobs.map((j) => j.event)).toEqual(["scriptShot", "scriptShot"]);
  });
});

describe("capture and storage", () => {
  it("screenshots the render's scene, stores the JPEG in short-tests and records it on the run", async () => {
    render("t1");
    const res = await captureScriptShot("t1", 42, 0, "c1", { now: 105_000 });
    expect(res.ok).toBe(true);
    expect(shoot).toHaveBeenCalledWith(expect.objectContaining({ id: "t1", sceneId: "shorts" }), { imageFormat: "jpg", imageWidth: 1280 });
    expect(blobs.get("t1-0.jpg")).toEqual(JPEG);
    await captureScriptShot("t1", 42, 1, "c3", { now: 113_000 });
    expect(runs.get("t1").shots).toEqual([
      { clipIndex: 0, clipId: "c1", at: 105_000, blobId: "t1-0.jpg" },
      { clipIndex: 1, clipId: "c3", at: 113_000, blobId: "t1-1.jpg" },
    ]);
  });

  it("keeps only the latest test per script: the older test's blobs and records are deleted", async () => {
    render("old", { status: "ended", shots: [{ clipIndex: 0, clipId: "c1", at: 1, blobId: "old-0.jpg" }] });
    blobs.set("old-0.jpg", JPEG);
    render("other", { status: "ended", script: { scriptId: "s2" }, shots: [{ clipIndex: 0, clipId: "x", at: 1, blobId: "other-0.jpg" }] });
    blobs.set("other-0.jpg", JPEG);
    render("t1");

    await captureScriptShot("t1", 42, 0, "c1");
    expect(blobs.has("old-0.jpg")).toBe(false);
    expect(runs.get("old").shots).toBeNull();
    expect(blobs.has("other-0.jpg")).toBe(true); // another script's test is kept
    expect(runs.get("other").shots).toHaveLength(1);
    expect(blobs.has("t1-0.jpg")).toBe(true);
  });

  it("two captures close together both land (serialised per run)", async () => {
    render("t1");
    await Promise.all([captureScriptShot("t1", 42, 0, "c1"), captureScriptShot("t1", 42, 1, "c3")]);
    expect(runs.get("t1").shots.map((s: any) => s.clipIndex)).toEqual([0, 1]);
  });

  it("skips a run that is over or playing another nonce, without touching OBS", async () => {
    render("t1", { status: "ended" });
    expect((await captureScriptShot("t1", 42, 0, "c1")).skipped).toBe("run is ended");
    render("t2", { script: { scriptId: "s1", offline: true, playNonce: 43 } });
    expect((await captureScriptShot("t2", 42, 0, "c1")).skipped).toBe("another play");
    expect(shoot).not.toHaveBeenCalled();
  });

  it("an OBS failure is retried once, then recorded as a shot with its reason", async () => {
    render("t1");
    shoot.mockRejectedValue(new Error("cannot reach OBS"));
    await expect(captureScriptShot("t1", 42, 0, "c1")).rejects.toThrow(/cannot reach OBS/);
    const res = await captureScriptShot("t1", 42, 0, "c1", { final: true, now: 7 });
    expect(res.ok).toBe(false);
    expect(runs.get("t1").shots).toEqual([{ clipIndex: 0, clipId: "c1", at: 7, error: "cannot reach OBS" }]);
  });

  it("with no blob folder the shot is recorded as not stored", async () => {
    db.blobFs = null;
    render("t1");
    await captureScriptShot("t1", 42, 0, "c1");
    expect(runs.get("t1").shots[0]).toMatchObject({ error: expect.stringMatching(/BLOB_DIR/) });
    expect(db.blobs.shortTest.put).not.toHaveBeenCalled();
  });
});

describe("frame thumbnail", () => {
  const live = (extra: any = {}) =>
    render("v1", {
      platforms: { youtube: { accountId: "acc", broadcastId: "bcast" } },
      script: { scriptId: "s1", offline: false, playNonce: 42, thumbnailFrameAtMs: 4_000 },
      ...extra,
    });

  it("screenshots OBS as PNG, normalises it to a 1280×720 JPEG and sets it on the video", async () => {
    const png = await sharp({ create: { width: 640, height: 360, channels: 3, background: { r: 200, g: 10, b: 10 } } }).png().toBuffer();
    shoot.mockResolvedValue({ mimeType: "image/png", data: png });
    live();
    const res = await captureFrameThumbnail("v1", 42);
    expect(res).toMatchObject({ ok: true, source: "frame at 4.0 s" });
    expect(shoot).toHaveBeenCalledWith(expect.objectContaining({ id: "v1" }), { imageFormat: "png", imageWidth: 1280 });
    const [, videoId, media] = (yt.setThumbnail as jest.Mock).mock.calls[0];
    expect(videoId).toBe("bcast");
    expect(media.mimeType).toBe("image/jpeg");
    const meta = await sharp(media.body).metadata();
    expect([meta.format, meta.width, meta.height]).toEqual(["jpeg", 1280, 720]);
    expect(runs.get("v1").thumbnail).toMatchObject({ setAt: expect.any(Number), source: "frame at 4.0 s", error: null });
  });

  it("does nothing for an offline test, an ended run or one already set", async () => {
    render("t1", { script: { scriptId: "s1", offline: true, playNonce: 42, thumbnailFrameAtMs: 0 } });
    expect((await captureFrameThumbnail("t1", 42)).skipped).toBe("run has no YouTube video");
    live({ status: "ended" });
    expect((await captureFrameThumbnail("v1", 42)).skipped).toBe("run is ended");
    live({ thumbnail: { setAt: 5, source: "frame at 4.0 s" } });
    expect((await captureFrameThumbnail("v1", 42)).skipped).toBe("already set");
    expect(shoot).not.toHaveBeenCalled();
    expect(yt.setThumbnail).not.toHaveBeenCalled();
  });
});
