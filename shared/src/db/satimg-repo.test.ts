import type { Model } from "mongoose";
import { makeSatImgRepo } from "./satimg-repo";
import type { iSatImgModel } from "./satimg-model";
import { makeInlineBlobStore } from "./inline-blob";

describe("makeSatImgRepo.pruneExcept", () => {
  it("deletes every frame whose satId is not in the keep list", async () => {
    const deleteMany = jest.fn(async () => ({ deletedCount: 3 }));
    const repo = makeSatImgRepo({ deleteMany } as unknown as Model<iSatImgModel>, makeInlineBlobStore("satimg", null));
    const res = await repo.pruneExcept(["global", "goes-east:geocolor", "lightning"]);
    expect(res).toEqual({ removed: 3 });
    const [filter] = deleteMany.mock.calls[0] as any[];
    expect(filter).toEqual({ satId: { $nin: ["global", "goes-east:geocolor", "lightning"] } });
  });

  it("is a no-op on an empty keep list (a failed bake must never wipe the cache)", async () => {
    const deleteMany = jest.fn(async () => ({ deletedCount: 99 }));
    const repo = makeSatImgRepo({ deleteMany } as unknown as Model<iSatImgModel>, makeInlineBlobStore("satimg", null));
    const res = await repo.pruneExcept([]);
    expect(res).toEqual({ removed: 0 });
    expect(deleteMany).not.toHaveBeenCalled();
  });
});
