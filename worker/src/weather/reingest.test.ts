import { runReingest } from "./reingest";
import { clearModelRuns } from "./clear";
import { runCheck } from "./check";
import { getAppDb } from "@photonsurge/shared/db/index";

jest.mock("@photonsurge/shared/db/index", () => ({ getAppDb: jest.fn() }));
jest.mock("@photonsurge/shared/utill/logger", () => ({ log: jest.fn() }));
jest.mock("../blog", () => ({ blogInfo: jest.fn(), blogErr: jest.fn() }));
jest.mock("./clear", () => ({ clearModelRuns: jest.fn() }));
jest.mock("./check", () => ({ runCheck: jest.fn() }));

const mockClear = clearModelRuns as jest.Mock;
const mockCheck = runCheck as jest.Mock;
const mockGetDb = getAppDb as jest.Mock;

describe("runReingest", () => {
  beforeEach(() => jest.clearAllMocks());

  it("clears the GFS runs first, THEN checks — so the rebake fires even when the cycle was published", async () => {
    const db = { weatherRuns: {}, weatherTextures: {} };
    mockGetDb.mockResolvedValue(db);
    mockClear.mockResolvedValue({ clearedRunIds: ["a", "b"], deletedTextureCount: 5 });
    mockCheck.mockResolvedValue({ enqueued: true, date: "20260712", cycle: "06" });

    const job = { id: "j1" } as any;
    const res = await runReingest(job);

    // Clears the configured base model (gfs), not a blanket wipe of every model.
    expect(mockClear).toHaveBeenCalledWith(db, "gfs");
    // Order matters: check must run AFTER the clear (else it sees the still-
    // published run and no-ops as "up to date").
    expect(mockClear.mock.invocationCallOrder[0]).toBeLessThan(mockCheck.mock.invocationCallOrder[0]);
    expect(mockCheck).toHaveBeenCalledWith(job);
    expect(res).toEqual({
      cleared: { clearedRunIds: ["a", "b"], deletedTextureCount: 5 },
      check: { enqueued: true, date: "20260712", cycle: "06" },
    });
  });

  it("propagates a clear failure without ever calling check", async () => {
    mockGetDb.mockResolvedValue({});
    mockClear.mockRejectedValue(new Error("boom"));

    await expect(runReingest({} as any)).rejects.toThrow("boom");
    expect(mockCheck).not.toHaveBeenCalled();
  });
});
