/** @jest-environment node */

/**
 * /api/shorts/renders — the Renders list (renders with their run and play,
 * queue headers with pause flags) and queuing a video through the worker.
 */
jest.mock("../../../../lib/api-log", () => ({ withApiLog: (h: unknown) => h }));
jest.mock("../../../../lib/require-admin", () => ({ requireAdmin: jest.fn() }));
jest.mock("@photonsurge/shared/bull/bull-queue", () => ({ sendToQueueAndWait: jest.fn() }));

const mockDb = {
  shortRenders: { list: jest.fn(), pausedEncoders: jest.fn() },
  shortScripts: { get: jest.fn() },
  listStreamEncoders: jest.fn(),
  getRun: jest.fn(),
};
jest.mock("@photonsurge/shared/db/index", () => ({ getAppDb: async () => mockDb }));

import { requireAdmin } from "../../../../lib/require-admin";
import { sendToQueueAndWait } from "@photonsurge/shared/bull/bull-queue";
import { GET, POST } from "./route";

const post = (body: unknown) =>
  POST(new Request("http://x/api/shorts/renders", { method: "POST", body: JSON.stringify(body) }) as never);

beforeEach(() => {
  jest.resetAllMocks();
  (requireAdmin as jest.Mock).mockResolvedValue(true);
});

describe("GET", () => {
  it("401s for non-admins", async () => {
    (requireAdmin as jest.Mock).mockResolvedValue(null);
    expect((await (GET as () => Promise<Response>)()).status).toBe(401);
  });

  it("lists unfinished and recent renders newest first, with run, play and queue headers", async () => {
    const live = { id: "r2", encoderId: "obs-v1", what: { type: "script", scriptId: "s1" }, status: "live", queuedAt: 20, runId: "run1", publishAs: "public", offline: false };
    const queued = { id: "r3", encoderId: "any", what: { type: "generate", formatId: "shorts", scope: { type: "globe" } }, status: "queued", queuedAt: 30, publishAs: "unlisted", offline: false };
    const done = { id: "r1", encoderId: "obs-v1", what: { type: "script", scriptId: "s1" }, status: "done", queuedAt: 10, publishAs: "public", offline: false };
    mockDb.shortRenders.list.mockImplementation(async (f: { status?: string[] }) => (f.status ? [live, queued] : [queued, live, done]));
    mockDb.shortRenders.pausedEncoders.mockResolvedValue(["obs-v1"]);
    mockDb.listStreamEncoders.mockResolvedValue([
      { id: "obs-v1", name: "Video 1", url: "ws://a", enabled: true, use: "videos" },
      { id: "gpu", url: "ws://b", enabled: true },
    ]);
    mockDb.shortScripts.get.mockResolvedValue({
      id: "s1",
      title: "Europe round-up",
      plays: [{ sceneId: "shorts", playNonce: 7, startedAt: 1000, clips: [{ id: "c", startMs: 0, durationMs: 60_000 }], skipped: [] }],
    });
    mockDb.getRun.mockResolvedValue({ id: "run1", sceneId: "shorts", status: "live", platforms: {}, script: { scriptId: "s1", playNonce: 7, offline: false, publishAs: "public" } });

    const res = await (GET as () => Promise<Response>)();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.renders.map((r: { id: string }) => r.id)).toEqual(["r3", "r2", "r1"]);
    expect(body.renders[0].label).toBe("Globe");
    expect(body.renders[1]).toMatchObject({ label: "Europe round-up", run: { id: "run1", status: "live" }, play: { startedAt: 1000, clips: [{ startMs: 0, durationMs: 60_000 }] } });
    expect(mockDb.shortScripts.get).toHaveBeenCalledTimes(1); // one load per script
    expect(body.queues).toEqual([
      { encoderId: "obs-v1", name: "Video 1", use: "videos", paused: true },
      { encoderId: "any", name: "Any video encoder", paused: false },
    ]);
  });

  it("leaves out a play that answered another nonce", async () => {
    const live = { id: "r2", encoderId: "obs-v1", what: { type: "script", scriptId: "s1" }, status: "live", queuedAt: 20, runId: "run1", publishAs: "public", offline: false };
    mockDb.shortRenders.list.mockResolvedValue([live]);
    mockDb.shortRenders.pausedEncoders.mockResolvedValue([]);
    mockDb.listStreamEncoders.mockResolvedValue([]);
    mockDb.shortScripts.get.mockResolvedValue({ id: "s1", title: "T", plays: [{ sceneId: "shorts", playNonce: 3, startedAt: 1, clips: [], skipped: [] }] });
    mockDb.getRun.mockResolvedValue({ id: "run1", sceneId: "shorts", status: "live", platforms: {}, script: { scriptId: "s1", playNonce: 7 } });
    const body = await (await (GET as () => Promise<Response>)()).json();
    expect(body.renders[0].play).toBeUndefined();
  });
});

describe("POST", () => {
  it("400s a body with nothing to make, without enqueueing", async () => {
    const res = await post({ encoderId: "obs-v1" });
    expect(res.status).toBe(400);
    expect(sendToQueueAndWait).not.toHaveBeenCalled();
  });

  it("queues the sanitised request on the worker, never deduplicated", async () => {
    (sendToQueueAndWait as jest.Mock).mockResolvedValue({ ok: true, render: { id: "r9", status: "queued" } });
    const res = await post({
      encoderId: "obs-v1",
      what: { type: "script", scriptId: "s1" },
      publishAs: "public",
      video: { title: " My title " },
      notBefore: 5000,
      startBy: 9000,
      bogus: true,
    });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ ok: true, render: { id: "r9", status: "queued" } });
    expect(sendToQueueAndWait).toHaveBeenCalledWith(
      "stream",
      "run-lifecycle",
      "renderQueue",
      {
        request: {
          encoderId: "obs-v1",
          what: { type: "script", scriptId: "s1" },
          publishAs: "public",
          offline: false,
          video: { title: "My title" },
          notBefore: 5000,
          startBy: 9000,
        },
      },
      expect.any(Number),
      undefined,
      { dedupe: false },
    );
  });

  it("passes the worker's refusal through", async () => {
    (sendToQueueAndWait as jest.Mock).mockResolvedValue({ ok: false, error: "not a render request" });
    const res = await post({ what: { type: "script", scriptId: "s1" } });
    expect(res.status).toBe(422);
    expect((await res.json()).error).toBe("not a render request");
  });

  it("504s when the worker doesn't answer", async () => {
    (sendToQueueAndWait as jest.Mock).mockRejectedValue(new Error("Job wait renderQueue timed out before finishing"));
    const res = await post({ what: { type: "script", scriptId: "s1" } });
    expect(res.status).toBe(504);
  });
});
