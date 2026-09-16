/**
 * Thumbnail job: source resolution (run → env → brand logo), the sharp
 * normalisation to a 1280×720 JPEG, and the publish flow's bookkeeping —
 * skips, refusals recorded-not-retried, transient failures thrown for BullMQ.
 */
jest.mock("@photonsurge/shared/utill/logger", () => ({ log: jest.fn() }));
const queueAdd = jest.fn(async () => ({}));
jest.mock("@photonsurge/shared/bull/bull", () => ({ getQueue: jest.fn(() => ({ add: queueAdd })) }));

const runs = new Map<string, any>();
const db = {
  getRun: jest.fn(async (id: string) => (runs.has(id) ? { ...runs.get(id) } : null)),
  updateRun: jest.fn(async (id: string, patch: any) => {
    runs.set(id, { ...(runs.get(id) ?? {}), ...patch });
    return runs.get(id);
  }),
};
jest.mock("@photonsurge/shared/db/index", () => ({ getAppDb: jest.fn(async () => db) }));

const setThumbnail = jest.fn(async () => {});
jest.mock("../youtube/client", () => ({
  getYoutubeClient: jest.fn(async () => ({ accountId: "chan-1" })),
  setThumbnail: (...a: unknown[]) => setThumbnail(...a),
}));
jest.mock("./encoders", () => ({ watchBaseUrl: () => "https://gods.example" }));
let channelThumb = "";
jest.mock("./channel-youtube", () => ({
  channelYoutubeSettings: jest.fn(async () => ({ title: "", description: "", thumbnailUrl: channelThumb })),
}));

const fetchWithTimeout = jest.fn();
jest.mock("../http", () => ({
  fetchWithTimeout: (...a: unknown[]) => fetchWithTimeout(...a),
  discardBody: jest.fn(),
}));

import sharp from "sharp";
import {
  THUMB_HEIGHT,
  THUMB_MAX_BYTES,
  THUMB_WIDTH,
  normalizeThumbnail,
  publishThumbnail,
  queueThumbnail,
  thumbnailSourceFor,
  thumbnailsEnabled,
} from "./thumbnail";

/** A small transparent PNG with a coloured square — stands in for the logo. */
async function samplePng(width = 400, height = 300): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 4, background: { r: 200, g: 40, b: 40, alpha: 0.5 } } })
    .png()
    .toBuffer();
}

const imageResponse = (body: Buffer, status = 200) =>
  ({
    ok: status >= 200 && status < 300,
    status,
    headers: new Map([["content-length", String(body.length)]]),
    arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength),
  }) as unknown as Response;

const gaxiosError = (status: number, reason: string, message = reason) => {
  const err = new Error(message) as Error & { response?: unknown; code?: number };
  err.code = status;
  err.response = { status, data: { error: { errors: [{ reason, message }] } } };
  return err;
};

beforeEach(() => {
  runs.clear();
  channelThumb = "";
  jest.clearAllMocks();
  delete process.env.YOUTUBE_THUMBNAIL_URL;
});

describe("thumbnailSourceFor", () => {
  it("prefers the channel's source, then the deployment default, then the brand logo", () => {
    const site = "https://gods.example";
    expect(thumbnailSourceFor("/thumbs/wind.png", {}, site)).toEqual({
      url: "https://gods.example/thumbs/wind.png",
      source: "/thumbs/wind.png",
    });
    expect(thumbnailSourceFor("https://cdn.example/a.jpg", {}, site)).toEqual({
      url: "https://cdn.example/a.jpg",
      source: "https://cdn.example/a.jpg",
    });
    expect(thumbnailSourceFor("", { YOUTUBE_THUMBNAIL_URL: "/brand/thumb.png" }, site)).toEqual({
      url: "https://gods.example/brand/thumb.png",
      source: "/brand/thumb.png",
    });
    expect(thumbnailSourceFor("  ", {}, site)).toEqual({
      url: "https://gods.example/chan1.png",
      source: "default",
    });
  });

  it("YOUTUBE_THUMBNAILS=off disables the automatic upload", () => {
    expect(thumbnailsEnabled({})).toBe(true);
    expect(thumbnailsEnabled({ YOUTUBE_THUMBNAILS: "off" })).toBe(false);
    expect(thumbnailsEnabled({ YOUTUBE_THUMBNAILS: "On" })).toBe(true);
  });
});

describe("normalizeThumbnail", () => {
  it("letterboxes any image into an opaque 1280×720 JPEG under YouTube's 2 MB cap", async () => {
    const out = await normalizeThumbnail(await samplePng(400, 300));
    const meta = await sharp(out).metadata();
    expect(meta.format).toBe("jpeg");
    expect(meta.width).toBe(THUMB_WIDTH);
    expect(meta.height).toBe(THUMB_HEIGHT);
    expect(meta.hasAlpha).toBeFalsy();
    expect(out.length).toBeLessThan(THUMB_MAX_BYTES);
    // Letterbox bars: a 4:3 source in a 16:9 frame leaves the left edge as background.
    const { data } = await sharp(out).extract({ left: 0, top: 360, width: 1, height: 1 }).raw().toBuffer({ resolveWithObject: true });
    expect(data[0]).toBeLessThan(30); // dark navy, not the red square
  });

  it("rejects bytes that are not an image", async () => {
    await expect(normalizeThumbnail(Buffer.from("not an image"))).rejects.toThrow();
  });
});

describe("queueThumbnail", () => {
  it("enqueues a retried run-lifecycle.thumbnail job", async () => {
    await queueThumbnail("r1");
    expect(queueAdd).toHaveBeenCalledWith(
      "do",
      { domain: "stream", type: "run-lifecycle", event: "thumbnail", data: { runId: "r1" } },
      expect.objectContaining({ attempts: 4 }),
    );
  });
});

describe("publishThumbnail", () => {
  const liveRun = (over: any = {}) => ({
    id: "r1",
    sceneId: "wind",
    status: "live",
    platforms: { youtube: { accountId: "chan-1", broadcastId: "vid-1" } },
    ...over,
  });

  it("fetches the channel's image, normalises and uploads it, then stamps the run", async () => {
    channelThumb = "/thumbs/wind.png";
    runs.set("r1", liveRun());
    fetchWithTimeout.mockResolvedValueOnce(imageResponse(await samplePng()));

    const res = await publishThumbnail("r1");

    expect(res).toMatchObject({ ok: true, source: "/thumbs/wind.png" });
    expect(fetchWithTimeout).toHaveBeenCalledWith("https://gods.example/thumbs/wind.png", expect.anything());
    expect(setThumbnail).toHaveBeenCalledWith(expect.anything(), "vid-1", expect.objectContaining({ mimeType: "image/jpeg" }));
    const uploaded = (setThumbnail.mock.calls[0] as any)[2].body as Buffer;
    expect((await sharp(uploaded).metadata()).width).toBe(THUMB_WIDTH);
    expect(runs.get("r1").thumbnail).toMatchObject({ source: "/thumbs/wind.png", error: null });
    expect(runs.get("r1").thumbnail.setAt).toEqual(expect.any(Number));
  });

  it("skips runs without a video, finished runs, and already-set thumbnails (unless forced)", async () => {
    runs.set("novid", liveRun({ id: "novid", platforms: {} }));
    expect(await publishThumbnail("novid")).toMatchObject({ ok: false, skipped: "run has no YouTube video" });

    runs.set("done", liveRun({ id: "done", status: "ended" }));
    expect(await publishThumbnail("done")).toMatchObject({ ok: false, skipped: "run is ended" });

    runs.set("set", liveRun({ id: "set", thumbnail: { setAt: 1, source: "default" } }));
    expect(await publishThumbnail("set")).toMatchObject({ ok: true, skipped: "already set", source: "default" });
    expect(setThumbnail).not.toHaveBeenCalled();

    fetchWithTimeout.mockResolvedValueOnce(imageResponse(await samplePng()));
    expect(await publishThumbnail("set", { force: true })).toMatchObject({ ok: true });
    expect(setThumbnail).toHaveBeenCalledTimes(1);
    expect(await publishThumbnail("missing")).toMatchObject({ ok: false, error: "no such run" });
  });

  it("records a YouTube refusal (unverified channel) on the run and does NOT throw", async () => {
    runs.set("r1", liveRun());
    fetchWithTimeout.mockResolvedValueOnce(imageResponse(await samplePng()));
    setThumbnail.mockRejectedValueOnce(gaxiosError(403, "forbidden", "The authenticated user doesn't have permissions to upload and set custom video thumbnails."));

    const res = await publishThumbnail("r1");

    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/custom video thumbnails/);
    expect(runs.get("r1").thumbnail).toMatchObject({ setAt: null, source: "default", error: expect.stringMatching(/thumbnails/) });
  });

  it("throws on a transient upload failure so BullMQ retries, keeping the error on the run", async () => {
    runs.set("r1", liveRun());
    fetchWithTimeout.mockResolvedValueOnce(imageResponse(await samplePng()));
    setThumbnail.mockRejectedValueOnce(gaxiosError(503, "backendError", "Backend Error"));

    await expect(publishThumbnail("r1")).rejects.toThrow(/Backend Error/);
    expect(runs.get("r1").thumbnail).toMatchObject({ setAt: null, error: expect.stringMatching(/Backend Error/) });
  });

  it("throws when the source can't be fetched, recording why", async () => {
    channelThumb = "https://cdn.example/missing.png";
    runs.set("r1", liveRun());
    fetchWithTimeout.mockResolvedValueOnce(imageResponse(Buffer.alloc(0), 404));

    await expect(publishThumbnail("r1")).rejects.toThrow(/HTTP 404/);
    expect(runs.get("r1").thumbnail.error).toMatch(/HTTP 404/);
    expect(setThumbnail).not.toHaveBeenCalled();
  });
});
