/** @jest-environment node */

/**
 * The schedule API (docs/short-video-plan.md §8): list, create, edit, delete,
 * the enable switch and Run batch now. Edits recompute `nextAt`; the server's
 * fields never come from a body; Run batch now hands the worker the optional
 * privacy override.
 */
jest.mock("../../../../lib/api-log", () => ({ withApiLog: (h: unknown) => h }));
jest.mock("../../../../lib/require-admin", () => ({ requireAdmin: jest.fn() }));
jest.mock("@photonsurge/shared/bull/bull-queue", () => ({ sendToQueueAndWait: jest.fn() }));

const store = new Map<string, any>();
const mockDb = {
  shortSchedules: {
    list: jest.fn(async () => [...store.values()]),
    get: jest.fn(async (id: string) => store.get(id) ?? null),
    create: jest.fn(async (s: any) => {
      const out = { ...s, id: "new-id" };
      store.set(out.id, out);
      return out;
    }),
    save: jest.fn(async (s: any) => (store.has(s.id) ? (store.set(s.id, s), s) : null)),
    remove: jest.fn(async (id: string) => store.delete(id)),
  },
  shortFormats: { get: jest.fn(async (id: string) => (["europe", "uk"].includes(id) ? { id } : null)) },
};
jest.mock("@photonsurge/shared/db/index", () => ({ getAppDb: async () => mockDb }));

import { requireAdmin } from "../../../../lib/require-admin";
import { sendToQueueAndWait } from "@photonsurge/shared/bull/bull-queue";
import { defaultShortSchedule } from "@photonsurge/shared/short-schedule";
import { GET, POST } from "./route";
import { DELETE, GET as GET_ONE, PUT } from "./[id]/route";
import { POST as ENABLE } from "./[id]/enabled/route";
import { POST as RUN } from "./[id]/run/route";

const req = (method: string, body?: unknown) =>
  new Request("http://x/api/shorts/schedules", { method, body: body === undefined ? undefined : JSON.stringify(body) });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const video = (formatId: string, scope: unknown = { type: "area", id: "europe" }) => ({ formatId, what: { type: "template", scope } });
const morningBody = {
  name: "Morning batch",
  enabled: true,
  when: { type: "weekly", days: [0, 1, 2, 3, 4, 5, 6], time: "07:00", tz: "Europe/London" },
  encoderId: "obs-v1",
  videos: [video("europe"), video("uk", { type: "country", id: "uk" }), video("shorts", { type: "auto", of: "area" })],
};

beforeEach(() => {
  jest.clearAllMocks();
  store.clear();
  (requireAdmin as jest.Mock).mockResolvedValue(true);
});

it("401s for non-admins on every route", async () => {
  (requireAdmin as jest.Mock).mockResolvedValue(null);
  expect((await GET()).status).toBe(401);
  expect((await POST(req("POST", morningBody))).status).toBe(401);
  expect((await GET_ONE(req("GET"), ctx("a"))).status).toBe(401);
  expect((await PUT(req("PUT", {}), ctx("a"))).status).toBe(401);
  expect((await DELETE(req("DELETE"), ctx("a"))).status).toBe(401);
  expect((await ENABLE(req("POST", { enabled: true }), ctx("a"))).status).toBe(401);
  expect((await RUN(req("POST", {}), ctx("a"))).status).toBe(401);
  expect(mockDb.shortSchedules.create).not.toHaveBeenCalled();
  expect(sendToQueueAndWait).not.toHaveBeenCalled();
});

it("POST creates a schedule with defaults filled and nextAt computed; the server's fields are its own", async () => {
  const res = await POST(req("POST", { ...morningBody, fireCount: 99, nextAt: 1, lastFire: { at: 1, outcome: "missed" } }));
  expect(res.status).toBe(201);
  const s = await res.json();
  expect(s).toMatchObject({ id: "new-id", name: "Morning batch", enabled: true, encoderId: "obs-v1", startByMs: 3_600_000, fireCount: 0, offline: false });
  expect(s.lastFire).toBeUndefined();
  expect(s.nextAt).toBeGreaterThan(Date.now());
  // 07:00 London is 06:00 or 07:00 UTC.
  expect([6, 7]).toContain(new Date(s.nextAt).getUTCHours());
  expect(s.videos[0].roundup).toEqual({ maxAgeHours: 14, ifStale: "refresh" });
  expect((await (await GET()).json()).schedules).toHaveLength(1);
});

it("POST refuses an invalid video, a bad when, an unknown format, and a once time already past", async () => {
  expect((await POST(req("POST", { ...morningBody, videos: [{ what: { type: "template" } }] }))).status).toBe(400);
  expect((await POST(req("POST", { ...morningBody, when: { type: "weekly", time: "7am" } }))).status).toBe(400);
  const unknown = await POST(req("POST", { ...morningBody, videos: [video("nope")] }));
  expect(unknown.status).toBe(400);
  expect((await unknown.json()).error).toBe('no format "nope"');
  const past = await POST(req("POST", { ...morningBody, when: { type: "once", at: Date.now() - 60_000 } }));
  expect(past.status).toBe(400);
  // Off, a past once time is fine (it just never fires).
  expect((await POST(req("POST", { ...morningBody, enabled: false, when: { type: "once", at: Date.now() - 60_000 } }))).status).toBe(201);
  expect(mockDb.shortSchedules.create).toHaveBeenCalledTimes(1);
});

it("PUT patches onto the stored schedule, keeps the URL's id, and recomputes nextAt", async () => {
  store.set("s1", { ...defaultShortSchedule("s1", "Morning"), enabled: true, fireCount: 5, nextAt: 123, videos: [{ ...video("europe"), roundup: { maxAgeHours: 14, ifStale: "refresh" } }] });
  const at = Date.now() + 3 * 3_600_000;
  const res = await PUT(req("PUT", { id: "hijack", when: { type: "once", at }, fireCount: 0 }), ctx("s1"));
  expect(res.status).toBe(200);
  const s = await res.json();
  expect(s).toMatchObject({ id: "s1", name: "Morning", fireCount: 5, when: { type: "once", at }, nextAt: at });
  expect(s.videos).toHaveLength(1);
  expect((await PUT(req("PUT", {}), ctx("nope"))).status).toBe(404);
  expect((await PUT(new Request("http://x", { method: "PUT", body: "{" }), ctx("s1"))).status).toBe(400);
});

it("GET one, DELETE one, 404 when unknown", async () => {
  store.set("s1", defaultShortSchedule("s1"));
  expect((await (await GET_ONE(req("GET"), ctx("s1"))).json()).id).toBe("s1");
  expect((await GET_ONE(req("GET"), ctx("nope"))).status).toBe(404);
  expect((await DELETE(req("DELETE"), ctx("s1"))).status).toBe(200);
  expect(store.has("s1")).toBe(false);
  expect((await DELETE(req("DELETE"), ctx("s1"))).status).toBe(404);
});

it("the enable switch sets nextAt on, clears it off", async () => {
  store.set("s1", { ...defaultShortSchedule("s1"), videos: [] });
  const on = await (await ENABLE(req("POST", { enabled: true }), ctx("s1"))).json();
  expect(on.enabled).toBe(true);
  expect(on.nextAt).toBeGreaterThan(Date.now());
  const off = await (await ENABLE(req("POST", { enabled: false }), ctx("s1"))).json();
  expect(off).toMatchObject({ enabled: false, nextAt: null });
  expect((await ENABLE(req("POST", { enabled: "yes" }), ctx("s1"))).status).toBe(400);
  expect((await ENABLE(req("POST", { enabled: true }), ctx("nope"))).status).toBe(404);
});

describe("Run batch now", () => {
  it("asks the worker to queue the batch with the privacy override for the whole batch", async () => {
    (sendToQueueAndWait as jest.Mock).mockResolvedValue({ ok: true, scheduleId: "s1", batchId: "b1", n: 7, renders: [{ id: "r1" }] });
    const res = await RUN(req("POST", { publishAs: "unlisted" }), ctx("s1"));
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ ok: true, batchId: "b1", n: 7 });
    expect(sendToQueueAndWait).toHaveBeenCalledWith("shorts", "short-video", "runBatch", { scheduleId: "s1", publishAs: "unlisted" }, 30_000);
  });

  it("without an override each video keeps its own privacy; a bad override is refused", async () => {
    (sendToQueueAndWait as jest.Mock).mockResolvedValue({ ok: true, scheduleId: "s1", batchId: "b", n: 1, renders: [] });
    await RUN(new Request("http://x", { method: "POST" }), ctx("s1"));
    expect(sendToQueueAndWait).toHaveBeenCalledWith("shorts", "short-video", "runBatch", { scheduleId: "s1" }, 30_000);
    expect((await RUN(req("POST", { publishAs: "everyone" }), ctx("s1"))).status).toBe(400);
  });

  it("maps the worker's answers: unknown schedule 404, empty batch 400, no answer 504", async () => {
    (sendToQueueAndWait as jest.Mock).mockResolvedValueOnce({ ok: false, error: "no such schedule" });
    expect((await RUN(req("POST", {}), ctx("x"))).status).toBe(404);
    (sendToQueueAndWait as jest.Mock).mockResolvedValueOnce({ ok: false, error: "the schedule has no videos" });
    expect((await RUN(req("POST", {}), ctx("x"))).status).toBe(400);
    (sendToQueueAndWait as jest.Mock).mockRejectedValueOnce(new Error("Job wait runBatch timed out before finishing"));
    expect((await RUN(req("POST", {}), ctx("x"))).status).toBe(504);
  });
});
