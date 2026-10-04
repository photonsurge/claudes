/** @jest-environment node */

/**
 * /api/admin/presenters/tests — POST makes a take from the presenter's saved
 * voice (or the draft voice sent), waits for the worker, and returns the take;
 * a take the worker never picked up is marked as an error, not left queued.
 */
jest.mock("../../../../../lib/api-log", () => ({ withApiLog: (h: unknown) => h }));
jest.mock("../../../../../lib/require-admin", () => ({ getSession: async () => ({ email: "op@x" }) }));

const mockWait = jest.fn();
jest.mock("@photonsurge/shared/bull/bull-queue", () => ({ sendToQueueAndWait: (...a: unknown[]) => mockWait(...a) }));

const takes: Record<string, any> = {};
const mockDb = {
  presenters: { get: jest.fn() },
  voiceTests: {
    create: jest.fn(async (input: any) => {
      takes.t1 = { ...input, id: "t1", status: "queued", createdAt: "x" };
      return takes.t1;
    }),
    get: jest.fn(async (id: string) => takes[id] ?? null),
    update: jest.fn(async (id: string, patch: any) => {
      takes[id] = { ...takes[id], ...patch };
    }),
    list: jest.fn(async () => []),
    delete: jest.fn(async () => true),
  },
};
jest.mock("@photonsurge/shared/db/index", () => ({ getAppDb: async () => mockDb }));

import { DEFAULT_PRESENTER } from "@photonsurge/shared/presenter";
import { POST } from "./route";

const post = (body: unknown) =>
  POST(new Request("http://x/api/admin/presenters/tests", { method: "POST", body: JSON.stringify(body) }));

beforeEach(() => {
  jest.clearAllMocks();
  for (const k of Object.keys(takes)) delete takes[k];
  mockDb.presenters.get.mockResolvedValue({ ...DEFAULT_PRESENTER, voice: { ...DEFAULT_PRESENTER.voice, voice: "af_heart" } });
  mockWait.mockImplementation(async () => {
    takes.t1 = { ...takes.t1, status: "ready" };
    return { status: "ready" };
  });
});

it("speaks with the presenter's saved voice and returns the finished take", async () => {
  const res = await post({ text: " Hello ", presenterId: "house" });
  expect(res.status).toBe(200);
  const created = mockDb.voiceTests.create.mock.calls[0][0];
  expect(created).toMatchObject({ text: "Hello", presenterId: "house", label: "House voice", createdBy: "op@x" });
  expect(created.voice.voice).toBe("af_heart");
  expect(mockWait).toHaveBeenCalledWith("presenter", "presenter", "test", { testId: "t1" }, expect.any(Number), undefined, { dedupe: false });
  expect((await res.json()).take.status).toBe("ready");
});

it("uses a draft voice when one is sent", async () => {
  await post({ text: "Hi", presenterId: "house", voice: { model: "x/y", voice: "v2", speed: 1.2 } });
  expect(mockDb.voiceTests.create.mock.calls[0][0].voice).toMatchObject({ model: "x/y", voice: "v2", speed: 1.2 });
});

it("rejects empty text and an unknown presenter", async () => {
  expect((await post({ text: "  " })).status).toBe(400);
  mockDb.presenters.get.mockResolvedValue(null);
  expect((await post({ text: "Hi", presenterId: "nope" })).status).toBe(404);
  expect(mockDb.voiceTests.create).not.toHaveBeenCalled();
});

it("marks a take the worker never picked up as an error (202)", async () => {
  mockWait.mockRejectedValue(new Error("timed out"));
  const res = await post({ text: "Hi", presenterId: "house" });
  expect(res.status).toBe(202);
  expect(takes.t1.status).toBe("error");
  expect(takes.t1.error).toMatch(/timed out/);
});

it("leaves a still-speaking take for the page to poll", async () => {
  mockWait.mockImplementation(async () => {
    takes.t1 = { ...takes.t1, status: "speaking" };
    throw new Error("timed out");
  });
  const res = await post({ text: "Hi", presenterId: "house" });
  expect(res.status).toBe(202);
  expect(takes.t1.status).toBe("speaking");
});
