import type { Model } from "mongoose";
import { makeRegionRepo } from "./region-repo";
import type { iRegionModel } from "./region-model";

describe("makeRegionRepo.pruneExcept", () => {
  it("deletes every region whose regionId is not in the keep list", async () => {
    const deleteMany = jest.fn(async () => ({ deletedCount: 12 }));
    const repo = makeRegionRepo({ deleteMany } as unknown as Model<iRegionModel>);
    const res = await repo.pruneExcept(["uk", "world", "arctic"]);
    expect(res).toEqual({ removed: 12 });
    const [filter] = deleteMany.mock.calls[0] as any[];
    expect(filter).toEqual({ regionId: { $nin: ["uk", "world", "arctic"] } });
  });

  it("is a no-op on an empty keep list (an empty seed must never wipe the catalog)", async () => {
    const deleteMany = jest.fn(async () => ({ deletedCount: 99 }));
    const repo = makeRegionRepo({ deleteMany } as unknown as Model<iRegionModel>);
    const res = await repo.pruneExcept([]);
    expect(res).toEqual({ removed: 0 });
    expect(deleteMany).not.toHaveBeenCalled();
  });
});
