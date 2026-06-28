import { runsToPrune, runRetention } from "./retention";

const mk = (id: string, run: string, published = true) => ({ id, run, published });

describe("runsToPrune", () => {
  it("keeps the newest N published runs", () => {
    const runs = [
      mk("a", "2026-06-28T00:00:00Z"),
      mk("b", "2026-06-27T18:00:00Z"),
      mk("c", "2026-06-27T12:00:00Z"),
      mk("d", "2026-06-27T06:00:00Z"),
    ];
    const pruned = runsToPrune(runs, 2).map((r) => r.id).sort();
    expect(pruned).toEqual(["c", "d"]);
  });

  it("keeps all when fewer than N", () => {
    const runs = [mk("a", "2026-06-28T00:00:00Z"), mk("b", "2026-06-27T18:00:00Z")];
    expect(runsToPrune(runs, 3)).toEqual([]);
  });

  it("prunes everything published when keep<=0", () => {
    const runs = [mk("a", "2026-06-28T00:00:00Z"), mk("b", "2026-06-27T18:00:00Z")];
    expect(runsToPrune(runs, 0).map((r) => r.id).sort()).toEqual(["a", "b"]);
  });

  it("keep=0 also prunes unpublished runs along with published ones? (only published)", () => {
    // keep<=0 short-circuit prunes only published runs; unpublished are left.
    const runs = [
      mk("p", "2026-06-28T00:00:00Z", true),
      mk("u", "2026-06-27T00:00:00Z", false),
    ];
    expect(runsToPrune(runs, 0).map((r) => r.id).sort()).toEqual(["p"]);
  });

  it("negative keep behaves like keep=0 (prune all published)", () => {
    const runs = [mk("a", "2026-06-28T00:00:00Z"), mk("b", "2026-06-27T18:00:00Z")];
    expect(runsToPrune(runs, -5).map((r) => r.id).sort()).toEqual(["a", "b"]);
  });

  it("empty list prunes nothing for any keep", () => {
    expect(runsToPrune([], 3)).toEqual([]);
    expect(runsToPrune([], 0)).toEqual([]);
  });

  it("keep exactly equal to the number of published runs prunes nothing", () => {
    const runs = [
      mk("a", "2026-06-28T00:00:00Z"),
      mk("b", "2026-06-27T18:00:00Z"),
      mk("c", "2026-06-27T12:00:00Z"),
    ];
    expect(runsToPrune(runs, 3)).toEqual([]);
  });

  it("ignores unpublished runs when counting the keep budget", () => {
    // 2 published + 1 fresh unpublished; keep=2 keeps both published, fresh kept.
    const runs = [
      mk("pub1", "2026-06-28T00:00:00Z", true),
      mk("pub2", "2026-06-27T18:00:00Z", true),
      mk("fresh", "2026-06-28T06:00:00Z", false),
    ];
    expect(runsToPrune(runs, 2)).toEqual([]);
  });

  it("prunes stale unpublished runs older than the cutoff but keeps newer ones", () => {
    const runs = [
      mk("pub1", "2026-06-28T00:00:00Z", true),
      mk("pub2", "2026-06-27T18:00:00Z", true),
      mk("stale", "2026-06-26T00:00:00Z", false), // older than kept cutoff -> prune
      mk("fresh", "2026-06-28T06:00:00Z", false), // newer (still baking) -> keep
    ];
    const pruned = runsToPrune(runs, 2).map((r) => r.id).sort();
    expect(pruned).toEqual(["stale"]);
  });
});

describe("runRetention", () => {
  it("deletes textures then run docs for pruned runs", async () => {
    const runs = [
      { id: "a", run: "2026-06-28T00:00:00Z", published: true },
      { id: "b", run: "2026-06-27T18:00:00Z", published: true },
      { id: "c", run: "2026-06-27T12:00:00Z", published: true },
    ];
    const deleteMany = jest.fn().mockResolvedValue({ success: true, data: { count: 5 } });
    const deleteByID = jest.fn().mockResolvedValue({ success: true });
    const db = {
      weatherRuns: {
        getAll: jest.fn().mockResolvedValue({ success: true, data: runs }),
        deleteByID,
      },
      weatherTextures: { deleteMany },
    };
    const res = await runRetention(db as any, 2);
    expect(res.prunedRunIds).toEqual(["c"]);
    expect(res.deletedTextureCount).toBe(5);
    expect(deleteMany).toHaveBeenCalledWith({ runId: "c" });
    expect(deleteByID).toHaveBeenCalledWith("c");
  });
});
