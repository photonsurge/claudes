/**
 * The stored-data sweeps are GLOBAL and live in their own job.
 *
 * They were originally bolted onto `alerts.ingest`, which is registered once per
 * SOURCE (see index.ts) — so with WMO, MeteoAlarm and GDACS each polling on their
 * own interval, every sweep ran three times over, concurrently, racing itself:
 * four `alerts.ingest` visible at once in /admin/queue, the GDACS tick re-ranking
 * MeteoAlarm's awareness levels. Idempotent, so nothing corrupted — just three
 * times the scans, on a job that already runs for minutes.
 *
 * These tests pin the split: reconcile does the sweeps, ingest does not.
 */
const mockDeactivateGreens = jest.fn();
const mockResync = jest.fn();
const mockClose = jest.fn();
const mockRetire = jest.fn();

jest.mock("@photonsurge/shared/db/index", () => ({
  getAppDb: async () => ({
    alerts: {
      deactivateMeteoalarmGreens: () => mockDeactivateGreens(),
      resyncMeteoalarmRanks: () => mockResync(),
    },
  }),
}));
jest.mock("../events/close", () => ({
  closeEndedAlertEvents: (...a: unknown[]) => mockClose(...a),
  retireUnservableSchedules: (...a: unknown[]) => mockRetire(...a),
}));
jest.mock("../blog", () => ({ blogInfo: jest.fn(), blogErr: jest.fn() }));
jest.mock("../socket", () => ({ emitWorkerEvent: jest.fn() }));
jest.mock("sharp", () => ({}));

import { reconcile } from "./alerts";

describe("alerts.reconcile", () => {
  const prevEnv = process.env.EVENTS_UNIFIED_ENABLED;
  beforeEach(() => {
    mockDeactivateGreens.mockReset().mockResolvedValue({ scanned: 10, deactivated: 3 });
    mockResync.mockReset().mockResolvedValue({ scanned: 10, changed: 2 });
    mockClose.mockReset().mockResolvedValue({ candidates: 5, closed: 1, schedulesRetired: 4 });
    mockRetire.mockReset().mockResolvedValue(7);
    process.env.EVENTS_UNIFIED_ENABLED = "true";
  });
  afterEach(() => {
    if (prevEnv === undefined) delete process.env.EVENTS_UNIFIED_ENABLED;
    else process.env.EVENTS_UNIFIED_ENABLED = prevEnv;
  });

  it("runs every stored-data sweep exactly once", async () => {
    const r = await reconcile({} as never);

    expect(mockDeactivateGreens).toHaveBeenCalledTimes(1);
    expect(mockResync).toHaveBeenCalledTimes(1);
    expect(mockClose).toHaveBeenCalledTimes(1);
    expect(mockRetire).toHaveBeenCalledTimes(1);
    expect(r).toMatchObject({
      greensRetired: 3,
      reranked: 2,
      eventsClosed: 1,
      schedulesRetired: 4,
      unservableRetired: 7,
    });
  });

  it("skips the event sweeps when the unified layer is off", async () => {
    delete process.env.EVENTS_UNIFIED_ENABLED;

    await reconcile({} as never);

    // The alert-side sweeps are unconditional; the event ones are behind the gate.
    expect(mockResync).toHaveBeenCalledTimes(1);
    expect(mockClose).not.toHaveBeenCalled();
    expect(mockRetire).not.toHaveBeenCalled();
  });

  it("an event-sweep failure does not lose the alert sweeps that already landed", async () => {
    mockClose.mockRejectedValue(new Error("mongo went away"));

    const r = await reconcile({} as never);

    expect(r).toMatchObject({ greensRetired: 3, reranked: 2 });
    expect(r.eventsError).toContain("mongo went away");
  });
});
