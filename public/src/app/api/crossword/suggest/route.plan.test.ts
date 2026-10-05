/** @jest-environment node */

/**
 * POST /api/crossword/suggest, from the plan (§8.4, §7.4, §8.3 Suggest): admin
 * gate, wrapped in withApiLog, enqueues `crossword.suggest` on the background
 * tier for one word or a batch, and caps the batch. It only enqueues: it never
 * decides an approval or a tag itself.
 */
jest.mock("../../../../lib/api-log", () => ({ withApiLog: jest.fn((h: unknown) => h) }));
jest.mock("../../../../lib/require-admin", () => ({ requireAdmin: jest.fn() }));
jest.mock("@photonsurge/shared/bull/bull-queue", () => ({
  sendToBack: jest.fn(async () => ({ id: "j1" })),
  sendToFore: jest.fn(async () => ({ id: "j1" })),
  sendToMid: jest.fn(async () => ({ id: "j1" })),
  sendToQueue: jest.fn(async () => ({ id: "j1" })),
  sendToQueueAndWait: jest.fn(async () => ({})),
  enqueueTo: jest.fn(async () => ({ id: "j1" })),
}));

import { withApiLog } from "../../../../lib/api-log";
import { requireAdmin } from "../../../../lib/require-admin";
import * as bull from "@photonsurge/shared/bull/bull-queue";
import * as route from "./route";

const wrapCalls = (withApiLog as jest.Mock).mock.calls.length;
const post = (body: unknown) =>
  route.POST(new Request("http://x/api/crossword/suggest", { method: "POST", headers: { "Content-Type": "application/json" }, body: typeof body === "string" ? body : JSON.stringify(body) }));

const otherLanes = () => [bull.sendToFore, bull.sendToMid, bull.sendToQueue, bull.sendToQueueAndWait] as jest.Mock[];
const enqueued = () => (bull.sendToBack as jest.Mock).mock.calls;

beforeEach(() => {
  (bull.sendToBack as jest.Mock).mockClear();
  for (const m of otherLanes()) m.mockClear();
  (requireAdmin as jest.Mock).mockReset().mockResolvedValue({ email: "op@example.com" });
});

it("is wrapped in withApiLog", () => {
  expect(wrapCalls).toBeGreaterThanOrEqual(1);
  expect(typeof route.POST).toBe("function");
});

it("only offers POST", () => {
  expect((route as any).GET).toBeUndefined();
  expect((route as any).PATCH).toBeUndefined();
});

it("refuses a caller who is not an admin, and queues nothing", async () => {
  (requireAdmin as jest.Mock).mockResolvedValue(null);
  const res = await post({ wordId: "64b000000000000000000001" });
  expect([401, 403]).toContain(res.status);
  expect(enqueued()).toHaveLength(0);
});

it("queues crossword.suggest for one word on the background tier", async () => {
  const res = await post({ wordId: "64b000000000000000000001" });
  expect(res.status).toBeGreaterThanOrEqual(200);
  expect(res.status).toBeLessThan(300);
  expect(enqueued()).toHaveLength(1);
  const [domain, type, event, data] = enqueued()[0];
  expect(domain).toBe("crossword");
  expect(type).toBe("crossword");
  expect(event).toBe("suggest");
  expect(data.wordIds).toEqual(["64b000000000000000000001"]);
  for (const m of otherLanes()) expect(m).not.toHaveBeenCalled();
});

it("queues a batch in one job", async () => {
  const ids = ["a1", "a2", "a3"];
  const res = await post({ wordIds: ids });
  expect(res.ok).toBe(true);
  expect(enqueued()).toHaveLength(1);
  expect(enqueued()[0][2]).toBe("suggest");
  expect([...enqueued()[0][3].wordIds].sort()).toEqual(ids);
});

it("caps the batch: a request far over the cap never queues more than the cap", async () => {
  const ids = Array.from({ length: 1000 }, (_, i) => `w${i}`);
  const res = await post({ wordIds: ids });
  if (res.ok) {
    expect(enqueued()).toHaveLength(1);
    expect(enqueued()[0][3].wordIds.length).toBeLessThanOrEqual(50);
  } else {
    expect(res.status).toBe(400);
    expect(enqueued()).toHaveLength(0);
  }
});

it("accepts a batch at the queue's size (50)", async () => {
  const res = await post({ wordIds: Array.from({ length: 50 }, (_, i) => `w${i}`) });
  expect(res.ok).toBe(true);
  expect(enqueued()[0][3].wordIds).toHaveLength(50);
});

it("refuses a request with no words, and queues nothing", async () => {
  for (const body of [{}, "not json", { wordIds: [] }, { wordId: 7 }, { wordIds: [null] }]) {
    const res = await post(body);
    expect(res.status).toBe(400);
  }
  expect(enqueued()).toHaveLength(0);
});

it("does not run the model itself: it answers at once with the job queued", async () => {
  const res = await post({ wordId: "a1" });
  const body = await res.json();
  expect(body).not.toHaveProperty("suggestion");
  expect(body).not.toHaveProperty("approval");
  expect(res.headers.get("Cache-Control") ?? "").toMatch(/no-store/);
});
