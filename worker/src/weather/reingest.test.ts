import { runReingest } from "./reingest";
import { runCheck } from "./check";

jest.mock("@photonsurge/shared/utill/logger", () => ({ log: jest.fn() }));
jest.mock("../blog", () => ({ blogInfo: jest.fn(), blogErr: jest.fn() }));
jest.mock("./check", () => ({ runCheck: jest.fn() }));
jest.mock("./config", () => ({ cfg: () => ({ model: "gfs" }) }));

const mockCheck = runCheck as jest.Mock;

describe("runReingest", () => {
  beforeEach(() => jest.clearAllMocks());

  it("forces a rebake via check WITHOUT deleting the live run (bake-then-swap)", async () => {
    mockCheck.mockResolvedValue({ enqueued: true, date: "20260712", cycle: "18", force: true });
    const job = { id: "j1" } as any;

    const res = await runReingest(job);

    // Delegates to check with force:true — no clearModelRuns, so the current run
    // stays live and on the map until the freshly baked one publishes.
    expect(mockCheck).toHaveBeenCalledWith(job, { force: true });
    expect(res).toEqual({ check: { enqueued: true, date: "20260712", cycle: "18", force: true } });
  });

  it("surfaces a no-op when a bake for the cycle is already in flight", async () => {
    mockCheck.mockResolvedValue({ inFlight: true, latest: "2026-07-12T18:00:00.000Z", force: true });
    const res = await runReingest({} as any);
    expect(res).toEqual({ check: { inFlight: true, latest: "2026-07-12T18:00:00.000Z", force: true } });
  });

  it("propagates a check failure", async () => {
    mockCheck.mockRejectedValue(new Error("boom"));
    await expect(runReingest({} as any)).rejects.toThrow("boom");
  });
});
