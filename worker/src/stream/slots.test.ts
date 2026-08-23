// Unit tests for the persistent-slot reconciler: desired state (enabled slots
// stream, disabled slots don't) driven purely through the run-lifecycle queue.
// Mongo + the queue are mocked; time is injected via reconcileSlots(now).

jest.mock("@photonsurge/shared/utill/logger", () => ({ log: jest.fn() }));

const queueAdd = jest.fn(async () => ({}));
jest.mock("@photonsurge/shared/bull/bull", () => ({ getQueue: jest.fn(() => ({ add: queueAdd })) }));

const slots = new Map<string, any>();
const runs = new Map<string, any>();
const db = {
  listStreamSlots: jest.fn(async () => [...slots.values()]),
  saveStreamSlot: jest.fn(async (patch: any) => {
    const next = { ...(slots.get(patch.id) ?? {}), ...patch };
    slots.set(patch.id, next);
    return { ...next };
  }),
  getRun: jest.fn(async (id: string) => (runs.has(id) ? { ...runs.get(id) } : null)),
  createRun: jest.fn(async (input: any) => {
    const run = { id: `run-${runs.size + 1}`, ...input };
    runs.set(run.id, run);
    return { ...run };
  }),
  getYoutubeAccount: jest.fn(async () => ({ id: "chan-1" })),
  encoderForScene: jest.fn(async () => null),
};
jest.mock("@photonsurge/shared/db/index", () => ({ getAppDb: jest.fn(async () => db) }));

import { SLOT_HEALTHY_AFTER_MS, SLOT_RESTART_MIN_MS, SLOT_RETRY_BASE_MS } from "@photonsurge/shared/runs";
import { reconcileSlots } from "./slots";

const NOW = 1_700_000_000_000;
const enqueued = (event: string) =>
  queueAdd.mock.calls.filter((c: any[]) => c[1]?.event === event).map((c: any[]) => c[1].data);

beforeEach(() => {
  slots.clear();
  runs.clear();
  jest.clearAllMocks();
});

describe("reconcileSlots", () => {
  it("starts an unbounded run for an enabled slot with no active run", async () => {
    slots.set("s1", { id: "s1", sceneId: "wind", encoderId: "obs-2", privacy: "public", enabled: true });

    await reconcileSlots(NOW);

    expect(db.createRun).toHaveBeenCalledTimes(1);
    const created = [...runs.values()][0];
    expect(created).toMatchObject({ sceneId: "wind", encoderId: "obs-2", slotId: "s1", durationMs: null });
    expect(created.platforms.youtube.accountId).toBe("chan-1");
    expect(enqueued("goLive")).toEqual([{ runId: created.id }]);
    // The slot now points at its run and has burned one attempt.
    expect(slots.get("s1")).toMatchObject({ runId: created.id, failCount: 1, lastAttemptAt: NOW });
  });

  it("defaults chat ON for slot runs — only an explicit opt-out disables it", async () => {
    slots.set("s1", { id: "s1", sceneId: "wind", enabled: true }); // no chat sub-doc at all
    slots.set("s2", { id: "s2", sceneId: "temp", enabled: true, chat: { enabled: false } });

    await reconcileSlots(NOW);

    const bySlot = Object.fromEntries([...runs.values()].map((r) => [r.slotId, r]));
    expect(bySlot.s1.chat).toEqual({ enabled: true, promoteToTicker: false });
    expect(bySlot.s2.chat).toEqual({ enabled: false, promoteToTicker: false });
  });

  it("falls back to the scene-bound encoder when the slot doesn't pin one", async () => {
    db.encoderForScene.mockResolvedValueOnce({ id: "obs-temp" } as any);
    slots.set("s1", { id: "s1", sceneId: "temp", enabled: true });

    await reconcileSlots(NOW);

    expect([...runs.values()][0].encoderId).toBe("obs-temp");
  });

  it("does nothing while the slot's run is active", async () => {
    runs.set("r1", { id: "r1", status: "live", startAt: NOW - 1000 });
    slots.set("s1", { id: "s1", sceneId: "wind", enabled: true, runId: "r1" });

    await reconcileSlots(NOW);

    expect(db.createRun).not.toHaveBeenCalled();
    expect(queueAdd).not.toHaveBeenCalled();
  });

  it("respects the backoff window after a failed attempt", async () => {
    slots.set("s1", {
      id: "s1",
      sceneId: "wind",
      enabled: true,
      runId: "r-dead",
      failCount: 2,
      lastAttemptAt: NOW - SLOT_RETRY_BASE_MS, // < the 4x-base delay owed after 2 failures
    });
    runs.set("r-dead", { id: "r-dead", status: "failed" });

    await reconcileSlots(NOW);
    expect(db.createRun).not.toHaveBeenCalled();

    // Once the window has passed, it retries.
    await reconcileSlots(NOW + SLOT_RETRY_BASE_MS * 4);
    expect(db.createRun).toHaveBeenCalledTimes(1);
  });

  it("resets the backoff counter after the run has been live long enough", async () => {
    runs.set("r1", { id: "r1", status: "live", startAt: NOW - SLOT_HEALTHY_AFTER_MS - 1 });
    slots.set("s1", { id: "s1", sceneId: "wind", enabled: true, runId: "r1", failCount: 3 });

    await reconcileSlots(NOW);

    expect(slots.get("s1").failCount).toBe(0);
  });

  it("recycles a live run past the slot's restart interval, relaunching next sweep", async () => {
    const HOUR = 3_600_000;
    runs.set("r1", { id: "r1", status: "live", startAt: NOW - 12 * HOUR - 1 });
    slots.set("s1", { id: "s1", sceneId: "wind", enabled: true, runId: "r1", restartEveryMs: 12 * HOUR });

    await reconcileSlots(NOW);

    // Ended, not replaced yet — the relaunch waits for the end to drain.
    expect(enqueued("end")).toEqual([{ runId: "r1", reason: "auto" }]);
    expect(db.createRun).not.toHaveBeenCalled();

    // Once the run is dead the next sweep starts the replacement immediately.
    runs.set("r1", { id: "r1", status: "ended", startAt: NOW - 12 * HOUR - 1 });
    await reconcileSlots(NOW + 60_000);
    expect(db.createRun).toHaveBeenCalledTimes(1);
    expect(enqueued("goLive")).toHaveLength(1);
  });

  it("leaves live runs alone before the interval — and always without one", async () => {
    const HOUR = 3_600_000;
    slots.set("s1", { id: "s1", sceneId: "wind", enabled: true, runId: "r1", restartEveryMs: 12 * HOUR });
    runs.set("r1", { id: "r1", status: "live", startAt: NOW - HOUR });
    slots.set("s2", { id: "s2", sceneId: "temp", enabled: true, runId: "r2" }); // no interval set
    runs.set("r2", { id: "r2", status: "live", startAt: NOW - 400 * HOUR });

    await reconcileSlots(NOW);

    expect(queueAdd).not.toHaveBeenCalled();
  });

  it("clamps a too-small restart interval to the floor", async () => {
    runs.set("r1", { id: "r1", status: "live", startAt: NOW - 60_000 });
    slots.set("s1", { id: "s1", sceneId: "wind", enabled: true, runId: "r1", restartEveryMs: 30_000 });

    await reconcileSlots(NOW); // only a minute old — under the floor, kept alive
    expect(enqueued("end")).toEqual([]);

    await reconcileSlots(NOW + SLOT_RESTART_MIN_MS);
    expect(enqueued("end")).toEqual([{ runId: "r1", reason: "auto" }]);
  });

  it("ends the run of a slot that was disabled", async () => {
    runs.set("r1", { id: "r1", status: "live", startAt: NOW - 1000 });
    slots.set("s1", { id: "s1", sceneId: "wind", enabled: false, runId: "r1" });

    await reconcileSlots(NOW);

    expect(enqueued("end")).toEqual([{ runId: "r1", reason: "auto" }]);
    expect(db.createRun).not.toHaveBeenCalled();
  });

  it("waits (with backoff bookkeeping) when no YouTube account is connected", async () => {
    db.getYoutubeAccount.mockResolvedValueOnce(null as any);
    slots.set("s1", { id: "s1", sceneId: "wind", enabled: true });

    await reconcileSlots(NOW);

    expect(db.createRun).not.toHaveBeenCalled();
    expect(slots.get("s1")).toMatchObject({ failCount: 1, lastAttemptAt: NOW });
  });

  it("keeps sweeping other slots when one throws", async () => {
    slots.set("s-bad", { id: "s-bad", sceneId: "x", enabled: true, runId: "boom" });
    slots.set("s-ok", { id: "s-ok", sceneId: "wind", enabled: true });
    db.getRun.mockRejectedValueOnce(new Error("mongo hiccup"));

    await reconcileSlots(NOW);

    // s-bad failed, s-ok still got its run.
    expect(db.createRun).toHaveBeenCalledTimes(1);
    expect([...runs.values()][0].slotId).toBe("s-ok");
  });
});
