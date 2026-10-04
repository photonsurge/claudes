// Unit tests for the "notify the world" announcer: hydra blog post (+ social
// fan-out) when a flagged run commits live — idempotent, config-gated, and
// throwing on API failure so the BullMQ attempts drive retries. Mongo, the
// queue, and fetch are all mocked.

jest.mock("@photonsurge/shared/utill/logger", () => ({ log: jest.fn() }));

const queueAdd = jest.fn(async () => ({}));
jest.mock("@photonsurge/shared/bull/bull", () => ({ getQueue: jest.fn(() => ({ add: queueAdd })) }));

const runs = new Map<string, any>();
const updateRun = jest.fn(async (id: string, patch: any) => {
  runs.set(id, { ...(runs.get(id) ?? {}), ...patch });
});
const db = {
  getRun: jest.fn(async (id: string) => (runs.has(id) ? { ...runs.get(id) } : null)),
  updateRun,
  getScene: jest.fn(async () => ({ name: "Wind Channel" })),
  getYoutubeAccount: jest.fn(async () => ({ channelTitle: "Weather HD" })),
};
jest.mock("@photonsurge/shared/db/index", () => ({ getAppDb: jest.fn(async () => db) }));

import { announceRun, buildAnnouncement, queueAnnounce, slugify } from "./announce";

const TOKEN = `hydra_site_aabbccddeeff0011_${"0".repeat(64)}`;
const HYDRA_ENV: Record<string, string> = {
  HYDRA_ENDPOINT: "https://hydra.example",
  HYDRA_SITEID: "photonsurge.uk",
  HYDRA_API_TOKEN: TOKEN,
  HYDRA_BLOG_CATEGORY_ID: "cat-1",
  HYDRA_SOCIAL_PAGE_IDS: "page-1, page-2",
  HYDRA_SOCIAL_MODE: "send",
};

// 2026-08-24 12:00Z — August, so UK time is BST (UTC+1).
const START_AT = Date.UTC(2026, 7, 24, 12, 0, 0);

const liveRun = (over: any = {}) => ({
  id: "r1",
  sceneId: "wind",
  status: "live",
  announce: true,
  title: "Wind 24/7",
  startAt: START_AT,
  platforms: { youtube: { watchUrl: "https://youtu.be/abc" } },
  ...over,
});

const fetchMock = jest.fn();

beforeEach(() => {
  runs.clear();
  jest.clearAllMocks();
  Object.assign(process.env, HYDRA_ENV);
  (global as any).fetch = fetchMock.mockResolvedValue({
    ok: true,
    json: async () => ({ data: { blog: { id: "blog-1" } } }),
    text: async () => "",
  });
});

afterAll(() => {
  for (const key of Object.keys(HYDRA_ENV)) delete process.env[key];
});

describe("announceRun", () => {
  it("publishes the blog (+ social fan-out) and stamps announcedAt", async () => {
    runs.set("r1", liveRun());

    await announceRun("r1");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://hydra.example/api/v1/sites/photonsurge.uk/blogs");
    expect(init.headers.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(init.headers["Idempotency-Key"]).toBe("weatherchannel-run-r1");
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({
      name: "Live now: Wind 24/7",
      categoryID: "cat-1",
      slug: "live-wind-24-7-r1",
      publish: true,
      social: { pageIDs: ["page-1", "page-2"], count: 1, mode: "send" },
    });
    // The post carries the link, channel names, and the go-live time.
    expect(body.contentMarkdown).toContain("https://youtu.be/abc");
    expect(body.contentMarkdown).toContain("Wind Channel is live on YouTube on Weather HD");
    expect(body.contentMarkdown).toContain("13:00 UK (12:00 UTC) on 24 Aug 2026");
    expect(body.description).toContain("Wind Channel is live on Weather HD");
    expect(runs.get("r1").announcedAt).toEqual(expect.any(Number));
  });

  it("skips runs that aren't flagged, already announced, dead, or URL-less", async () => {
    runs.set("off", liveRun({ id: "off", announce: false }));
    runs.set("done", liveRun({ id: "done", announcedAt: 123 }));
    runs.set("dead", liveRun({ id: "dead", status: "ended" }));
    runs.set("nourl", liveRun({ id: "nourl", platforms: {} }));

    for (const id of ["off", "done", "dead", "nourl"]) await announceRun(id);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(updateRun).not.toHaveBeenCalled();
  });

  it("skips quietly when hydra isn't configured", async () => {
    delete process.env.HYDRA_ENDPOINT;
    runs.set("r1", liveRun());

    await announceRun("r1");

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("omits social when no page ids are configured (blog only)", async () => {
    process.env.HYDRA_SOCIAL_PAGE_IDS = "";
    runs.set("r1", liveRun());

    await announceRun("r1");

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.social).toBeUndefined();
  });

  it("throws on a hydra error so the BullMQ attempts retry it — without stamping", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500, text: async () => "boom" });
    runs.set("r1", liveRun());

    await expect(announceRun("r1")).rejects.toThrow(/500/);

    expect(runs.get("r1").announcedAt).toBeUndefined();
    expect(runs.get("r1").announceError).toMatchObject({ attempts: 1, status: 500, message: "boom" });
  });

  it("records a network failure (bad host) on the run and rethrows", async () => {
    fetchMock.mockRejectedValueOnce(Object.assign(new Error("fetch failed"), { cause: { code: "ENOTFOUND" } }));
    runs.set("r1", liveRun());

    await expect(announceRun("r1")).rejects.toThrow(/ENOTFOUND/);
    expect(runs.get("r1").announceError.message).toContain("ENOTFOUND");
  });

  it("names the missing env vars and records them when hydra isn't configured", async () => {
    delete process.env.HYDRA_SITEID;
    runs.set("r1", liveRun());

    await announceRun("r1");

    expect(fetchMock).not.toHaveBeenCalled();
    expect(runs.get("r1").announceError.message).toContain("HYDRA_SITEID");
  });

  it("sends HYDRA_IMAGE_ID as imageID and links the watch URL in markdown", async () => {
    process.env.HYDRA_IMAGE_ID = "img-1";
    runs.set("r1", liveRun());
    await announceRun("r1");
    delete process.env.HYDRA_IMAGE_ID;

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.imageID).toBe("img-1");
    expect(body.contentMarkdown).toContain("[Watch live on YouTube](https://youtu.be/abc)");
  });

  it("clears a previous announceError on success", async () => {
    runs.set("r1", liveRun({ announceError: { at: 1, attempts: 2, message: "old" } }));
    await announceRun("r1");
    expect(runs.get("r1").announceError).toBeNull();
  });
});

describe("queueAnnounce", () => {
  it("enqueues the announce job with retry attempts", async () => {
    await queueAnnounce("r9");

    expect(queueAdd).toHaveBeenCalledWith(
      "do",
      { domain: "stream", type: "run-lifecycle", event: "announce", data: { runId: "r9" } },
      expect.objectContaining({ attempts: 5 }),
    );
  });
});

describe("buildAnnouncement", () => {
  const extras = { watchUrl: "https://youtu.be/abc", categoryId: "cat-1" };

  it("falls back to the scene id and skips the channel clause when lookups came up empty", () => {
    const post = buildAnnouncement(liveRun({ title: "" }) as any, extras);
    expect(post.name).toBe("Live now: wind — live weather stream");
    expect(post.contentMarkdown).toContain("wind is live on YouTube, since");
  });

  it("marks always-on slot streams and honours the HYDRA_ANNOUNCE_BLURB override", () => {
    process.env.HYDRA_ANNOUNCE_BLURB = "Custom channel blurb.";
    const slotPost = buildAnnouncement(liveRun({ slotId: "s1", durationMs: null }) as any, extras);
    expect(slotPost.contentMarkdown).toContain("Custom channel blurb. The stream runs around the clock.");

    delete process.env.HYDRA_ANNOUNCE_BLURB;
    const oneOff = buildAnnouncement(liveRun({ durationMs: 60_000 }) as any, extras);
    expect(oneOff.contentMarkdown).not.toContain("around the clock");
    expect(oneOff.contentMarkdown).toContain("live weather globe");
  });
});

describe("slugify", () => {
  it("lowercases and collapses everything else to single hyphens", () => {
    expect(slugify("  Über Wind—24/7!! ")).toBe("ber-wind-24-7");
  });
});
