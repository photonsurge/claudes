import { clearModelRuns } from "./clear";

describe("clearModelRuns", () => {
  it("deletes each matching run's textures then the run doc, and reports totals", async () => {
    const runs = [
      { id: "a", run: "2026-06-28T00:00:00Z" },
      { id: "b", run: "2026-06-27T18:00:00Z" },
    ];
    const getAll = jest.fn().mockResolvedValue({ success: true, data: runs });
    const deleteMany = jest.fn().mockResolvedValue({ success: true, data: { count: 12 } });
    const deleteByID = jest.fn().mockResolvedValue({ success: true });
    const db = {
      weatherRuns: { getAll, deleteByID },
      weatherTextures: { deleteMany },
    };

    const res = await clearModelRuns(db as any, "gfs");

    expect(getAll).toHaveBeenCalledWith({ model: "gfs" }, { sort: { run: -1 } });
    expect(res.clearedRunIds).toEqual(["a", "b"]);
    expect(res.deletedTextureCount).toBe(24);
    // textures always deleted before the owning run doc
    expect(deleteMany).toHaveBeenNthCalledWith(1, { runId: "a" });
    expect(deleteByID).toHaveBeenNthCalledWith(1, "a");
    expect(deleteMany).toHaveBeenNthCalledWith(2, { runId: "b" });
    expect(deleteByID).toHaveBeenNthCalledWith(2, "b");
  });

  it("no-ops cleanly when the model has no stored runs", async () => {
    const db = {
      weatherRuns: {
        getAll: jest.fn().mockResolvedValue({ success: true, data: [] }),
        deleteByID: jest.fn(),
      },
      weatherTextures: { deleteMany: jest.fn() },
    };

    const res = await clearModelRuns(db as any, "gfs");

    expect(res).toEqual({ clearedRunIds: [], deletedTextureCount: 0 });
    expect(db.weatherTextures.deleteMany).not.toHaveBeenCalled();
    expect(db.weatherRuns.deleteByID).not.toHaveBeenCalled();
  });
});
