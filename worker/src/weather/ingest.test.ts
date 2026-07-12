import { runIngest } from "./ingest";
import { getAppDb } from "@photonsurge/shared/db/index";
import { VARIABLE_REGISTRY } from "@photonsurge/shared/variables";
import { recentPendingRun } from "./inflight";
import { bakeSteps, runDateFor } from "./config";
import { bakeVariableStep } from "./bakeVariableStep";
import { bustManifestCache } from "./manifestCache";

// Heavy bake/publish deps are stubbed — these tests exercise the control flow
// (concurrency guard, force-vs-idempotency, progressive per-variable publish),
// not a real bake.
jest.mock("@photonsurge/shared/db/index", () => ({ getAppDb: jest.fn() }));
jest.mock("@photonsurge/shared/utill/logger", () => ({ log: jest.fn() }));
jest.mock("../socket", () => ({ emitWorkerEvent: jest.fn() }));
jest.mock("../grib/bake", () => ({
  GFS_GRID: { width: 1440, height: 721, res: 0.25 },
  GFS_BOUNDS: [-180, -90, 180, 90],
}));
jest.mock("./retention", () => ({ runRetention: jest.fn().mockResolvedValue({ prunedRunIds: [] }) }));
jest.mock("./archive", () => ({ archiveRun: jest.fn().mockResolvedValue(undefined) }));
jest.mock("./archiveForecast", () => ({ archiveForecastRun: jest.fn().mockResolvedValue(undefined) }));
jest.mock("./download", () => ({ cleanupTemp: jest.fn() }));
jest.mock("./config", () => ({
  cfg: () => ({ model: "gfs", stepHours: 3, retainRuns: 3 }),
  bakeSteps: jest.fn(() => []),
  runDateFor: jest.fn(() => new Date("2026-07-12T18:00:00.000Z")),
}));
jest.mock("./bakeVariableStep", () => ({ bakeVariableStep: jest.fn() }));
jest.mock("../blog", () => ({ blogInfo: jest.fn(), blogWarn: jest.fn(), blogErr: jest.fn() }));
jest.mock("./debug", () => ({ dbg: jest.fn() }));
jest.mock("./manifestCache", () => ({ bustManifestCache: jest.fn().mockResolvedValue(undefined) }));
jest.mock("./inflight", () => ({ recentPendingRun: jest.fn() }));

const mockGetDb = getAppDb as jest.Mock;
const mockPending = recentPendingRun as jest.Mock;
const mockBakeStep = bakeVariableStep as jest.Mock;
const mockBust = bustManifestCache as jest.Mock;

const JOB = { data: { data: { date: "20260712", cycle: "18", model: "gfs" } } } as any;
const FORCE_JOB = { data: { data: { date: "20260712", cycle: "18", model: "gfs", force: true } } } as any;
const GFS_VAR_COUNT = Object.values(VARIABLE_REGISTRY).filter((v) => v.gfs).length;

function makeDb(overrides: any = {}) {
  return {
    weatherRuns: {
      getByQuery: jest.fn().mockResolvedValue({ success: false, data: null }),
      create: jest.fn().mockResolvedValue({ success: true, data: { id: "new-run" } }),
      updateByID: jest.fn().mockResolvedValue({ success: true }),
      ...overrides.weatherRuns,
    },
    weatherTextures: {
      create: jest.fn().mockResolvedValue({ success: true, data: { id: "tex-1" } }),
      deleteMany: jest.fn().mockResolvedValue({ success: true, data: { count: 0 } }),
      ...overrides.weatherTextures,
    },
  };
}

describe("runIngest — gating", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (bakeSteps as jest.Mock).mockReturnValue([]);
    (runDateFor as jest.Mock).mockReturnValue(new Date("2026-07-12T18:00:00.000Z"));
    mockPending.mockResolvedValue(null);
  });

  it("skips (no run doc created) when another bake for the cycle is in flight", async () => {
    const db = makeDb();
    mockGetDb.mockResolvedValue(db);
    mockPending.mockResolvedValue({ id: "inflight-run" });

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

  it("FORCE rebakes an already-published cycle: bypasses idempotency and creates a fresh run", async () => {
    const db = makeDb({ weatherRuns: { getByQuery: jest.fn().mockResolvedValue({ success: true, data: { id: "pub" } }) } });
    mockGetDb.mockResolvedValue(db);

    // No forecast hours mocked → nothing bakes → throws, but still proves force
    // got past idempotency and created the run doc.
    await expect(runIngest(FORCE_JOB)).rejects.toThrow(/no variables baked/);
    expect(db.weatherRuns.getByQuery).not.toHaveBeenCalled();
    expect(db.weatherRuns.create).toHaveBeenCalled();
  });
});

describe("runIngest — progressive publish", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (runDateFor as jest.Mock).mockReturnValue(new Date("2026-07-12T18:00:00.000Z"));
    mockPending.mockResolvedValue(null);
    (bakeSteps as jest.Mock).mockReturnValue([0]); // one forecast hour, so every var bakes
    mockBakeStep.mockResolvedValue({
      buffer: Buffer.from("png"),
      imageUnscale: [0, 1],
      domain: [0, 1],
      encoding: "scalar",
      gribPath: "/tmp/x.grib2",
    });
  });

  it("creates the run doc up front and publishes each variable as it bakes", async () => {
    const db = makeDb();
    mockGetDb.mockResolvedValue(db);

    const res = await runIngest(JOB);

    // Run doc created BEFORE baking → visible in /admin/weather from the start.
    expect(db.weatherRuns.create).toHaveBeenCalledTimes(1);
    expect(db.weatherRuns.create.mock.calls[0][0]).toMatchObject({ status: "pending", published: false });

    // Each variable is written incrementally via an atomic `variables.<id>` $set.
    const perVarWrites = db.weatherRuns.updateByID.mock.calls.filter(([, patch]: [string, any]) =>
      Object.keys(patch).some((k) => k.startsWith("variables.")),
    );
    expect(perVarWrites.length).toBe(GFS_VAR_COUNT);

    // The first published variable flips the run live (published:true).
    expect(
      db.weatherRuns.updateByID.mock.calls.some(([, patch]: [string, any]) => patch.published === true),
    ).toBe(true);

    // Manifest cache busted as maps go live (per variable + the finalise).
    expect(mockBust.mock.calls.length).toBeGreaterThanOrEqual(GFS_VAR_COUNT);

    // Finalised complete, and the result reflects everything published.
    expect(
      db.weatherRuns.updateByID.mock.calls.some(([, patch]: [string, any]) => patch.status === "complete"),
    ).toBe(true);
    expect(res).toMatchObject({ published: true, baked: GFS_VAR_COUNT });
  });

  it("keeps the run published even if some variables fail (partial run survives)", async () => {
    const db = makeDb();
    mockGetDb.mockResolvedValue(db);
    // First variable fails every hour, the rest succeed.
    let call = 0;
    mockBakeStep.mockImplementation(async () => {
      call += 1;
      if (call === 1) throw new Error("download failed 404");
      return { buffer: Buffer.from("png"), imageUnscale: [0, 1], domain: [0, 1], encoding: "scalar", gribPath: "/tmp/x" };
    });

    const res = await runIngest(JOB);
    expect(res).toMatchObject({ published: true });
    // Fewer than all vars baked, but still published.
    expect((res as any).baked).toBeGreaterThan(0);
    expect((res as any).baked).toBeLessThanOrEqual(GFS_VAR_COUNT);
  });
});
