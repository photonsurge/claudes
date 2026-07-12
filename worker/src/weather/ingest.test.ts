import { runIngest } from "./ingest";
import { getAppDb } from "@photonsurge/shared/db/index";
import { recentPendingRun } from "./inflight";
import { bakeSteps, runDateFor } from "./config";

// Heavy bake/publish deps are stubbed — these tests exercise ONLY the early
// control flow (concurrency guard + force-vs-idempotency), not a real bake.
jest.mock("@photonsurge/shared/db/index", () => ({ getAppDb: jest.fn() }));
jest.mock("@photonsurge/shared/utill/logger", () => ({ log: jest.fn() }));
jest.mock("../socket", () => ({ emitWorkerEvent: jest.fn() }));
jest.mock("../grib/bake", () => ({
  GFS_GRID: { width: 1440, height: 721, res: 0.25 },
  GFS_BOUNDS: [-180, -90, 180, 90],
}));
jest.mock("./retention", () => ({ runRetention: jest.fn() }));
jest.mock("./archive", () => ({ archiveRun: jest.fn().mockResolvedValue(undefined) }));
jest.mock("./archiveForecast", () => ({ archiveForecastRun: jest.fn().mockResolvedValue(undefined) }));
jest.mock("./download", () => ({ cleanupTemp: jest.fn() }));
jest.mock("./config", () => ({
  cfg: () => ({ model: "gfs", stepHours: 3, retainRuns: 3 }),
  bakeSteps: jest.fn(() => []), // no forecast hours → bakes nothing (stops before real work)
  runDateFor: jest.fn(() => new Date("2026-07-12T18:00:00.000Z")),
}));
jest.mock("./bakeVariableStep", () => ({ bakeVariableStep: jest.fn() }));
jest.mock("../blog", () => ({ blogInfo: jest.fn(), blogWarn: jest.fn(), blogErr: jest.fn() }));
jest.mock("./debug", () => ({ dbg: jest.fn() }));
jest.mock("./manifestCache", () => ({ bustManifestCache: jest.fn() }));
jest.mock("./inflight", () => ({ recentPendingRun: jest.fn() }));

const mockGetDb = getAppDb as jest.Mock;
const mockPending = recentPendingRun as jest.Mock;

const JOB = { data: { data: { date: "20260712", cycle: "18", model: "gfs" } } } as any;
const FORCE_JOB = { data: { data: { date: "20260712", cycle: "18", model: "gfs", force: true } } } as any;

function makeDb(overrides: any = {}) {
  return {
    weatherRuns: {
      getByQuery: jest.fn().mockResolvedValue({ success: false, data: null }),
      create: jest.fn().mockResolvedValue({ success: true, data: { id: "new-run" } }),
      updateByID: jest.fn().mockResolvedValue({ success: true }),
      ...overrides.weatherRuns,
    },
    weatherTextures: {
      deleteMany: jest.fn().mockResolvedValue({ success: true, data: { count: 0 } }),
      ...overrides.weatherTextures,
    },
  };
}

describe("runIngest early control flow", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (bakeSteps as jest.Mock).mockReturnValue([]);
    (runDateFor as jest.Mock).mockReturnValue(new Date("2026-07-12T18:00:00.000Z"));
    mockPending.mockResolvedValue(null);
  });

  it("skips (no run doc created) when another bake for the cycle is in flight", async () => {
    const db = makeDb();
    mockGetDb.mockResolvedValue(db);
    mockPending.mockResolvedValue({ id: "inflight-run" }); // duplicate guard trips

    const res = await runIngest(JOB);

    expect(res).toMatchObject({ skipped: true, reason: "in-flight" });
    expect(db.weatherRuns.create).not.toHaveBeenCalled();
    expect(db.weatherRuns.getByQuery).not.toHaveBeenCalled();
  });

  it("skips a non-force ingest when the cycle is already published (idempotency)", async () => {
    const db = makeDb({ weatherRuns: { getByQuery: jest.fn().mockResolvedValue({ success: true, data: { id: "pub" } }) } });
    mockGetDb.mockResolvedValue(db);

    const res = await runIngest(JOB);

    expect(res).toMatchObject({ skipped: true });
    expect(db.weatherRuns.create).not.toHaveBeenCalled();
  });

  it("FORCE rebakes an already-published cycle: bypasses the idempotency check and creates a fresh run", async () => {
    // getByQuery would report a published run, but force must not consult it.
    const db = makeDb({ weatherRuns: { getByQuery: jest.fn().mockResolvedValue({ success: true, data: { id: "pub" } }) } });
    mockGetDb.mockResolvedValue(db);

    // With no forecast hours mocked, the bake produces nothing and throws — which
    // still proves force got PAST the idempotency skip and created a new run doc.
    await expect(runIngest(FORCE_JOB)).rejects.toThrow(/no variables baked/);
    expect(db.weatherRuns.getByQuery).not.toHaveBeenCalled(); // idempotency skipped under force
    expect(db.weatherRuns.create).toHaveBeenCalled(); // a fresh run doc was created
  });
});
