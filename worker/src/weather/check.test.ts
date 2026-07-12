import { runCheck } from "./check";
import { getAppDb } from "@photonsurge/shared/db/index";
import { sendToQueue } from "@photonsurge/shared/bull/bull-queue";
import { latestAvailableRun } from "../sources/gfs";
import { recentPendingRun } from "./inflight";

jest.mock("@photonsurge/shared/db/index", () => ({ getAppDb: jest.fn() }));
jest.mock("@photonsurge/shared/bull/bull-queue", () => ({
  sendToQueue: jest.fn(),
  QUEUE_PRIORITY: { HIGH: 1, NORMAL: 5, LOW: 10 },
}));
jest.mock("@photonsurge/shared/utill/logger", () => ({ log: jest.fn() }));
jest.mock("../sources/gfs", () => ({ latestAvailableRun: jest.fn() }));
jest.mock("./download", () => ({ headOk: jest.fn() }));
jest.mock("./config", () => ({ cfg: () => ({ model: "gfs" }) }));
jest.mock("./inflight", () => ({ recentPendingRun: jest.fn() }));

const mockGetDb = getAppDb as jest.Mock;
const mockSend = sendToQueue as jest.Mock;
const mockLatest = latestAvailableRun as jest.Mock;
const mockPending = recentPendingRun as jest.Mock;

const LATEST = { date: "20260712", cycle: "18", runDate: new Date("2026-07-12T18:00:00.000Z") };

function dbWithPublished(runIso: string | null) {
  return {
    latestPublishedRunForModel: jest.fn().mockResolvedValue(runIso ? { run: new Date(runIso) } : null),
  };
}

describe("runCheck", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockLatest.mockResolvedValue(LATEST);
    mockPending.mockResolvedValue(null); // no bake in flight by default
  });

  it("no-ops when the latest available cycle is already published", async () => {
    mockGetDb.mockResolvedValue(dbWithPublished("2026-07-12T18:00:00.000Z"));
    const res = await runCheck({} as any);
    expect(res).toEqual({ upToDate: true, latest: "2026-07-12T18:00:00.000Z" });
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("enqueues an ingest (force:false) when a newer cycle is available", async () => {
    mockGetDb.mockResolvedValue(dbWithPublished("2026-07-12T12:00:00.000Z"));
    const res = await runCheck({} as any);
    expect(mockSend).toHaveBeenCalledWith("weather", "weather", "ingest", {
      date: "20260712",
      cycle: "18",
      model: "gfs",
      force: false,
    });
    expect(res).toMatchObject({ enqueued: true, force: false });
  });

  it("force rebakes an already-published cycle, passing force:true to the ingest", async () => {
    mockGetDb.mockResolvedValue(dbWithPublished("2026-07-12T18:00:00.000Z")); // same cycle already published
    const res = await runCheck({} as any, { force: true });
    expect(mockSend).toHaveBeenCalledWith("weather", "weather", "ingest", {
      date: "20260712",
      cycle: "18",
      model: "gfs",
      force: true,
    });
    expect(res).toMatchObject({ enqueued: true, force: true });
  });

  it("does NOT enqueue a duplicate when a bake for the cycle is already in flight", async () => {
    mockGetDb.mockResolvedValue(dbWithPublished("2026-07-12T12:00:00.000Z"));
    mockPending.mockResolvedValue({ id: "inflight-run" });
    const res = await runCheck({} as any);
    expect(mockSend).not.toHaveBeenCalled();
    expect(res).toMatchObject({ inFlight: true, latest: "2026-07-12T18:00:00.000Z" });
  });

  it("in-flight dedup applies to forced rebakes too (one bake at a time)", async () => {
    mockGetDb.mockResolvedValue(dbWithPublished("2026-07-12T18:00:00.000Z"));
    mockPending.mockResolvedValue({ id: "inflight-run" });
    const res = await runCheck({} as any, { force: true });
    expect(mockSend).not.toHaveBeenCalled();
    expect(res).toMatchObject({ inFlight: true });
  });
});
