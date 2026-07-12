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

  it("does NOT prune unpublished runs when the group has NO published run (protects the in-flight first bake)", () => {
    // The GFS-appears-then-vanishes bug: first bake after a clear has no published
    // run, so cutoff was Infinity and the pending run being baked got pruned.
    const runs = [
      mk("baking", "2026-06-28T00:00:00Z", false),
      mk("alsoUnpub", "2026-06-28T06:00:00Z", false),
    ];
    expect(runsToPrune(runs, 3)).toEqual([]);
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

  const mkDb = (runs: any[]) => {
    const deleteByID = jest.fn().mockResolvedValue({ success: true });
    const deleteMany = jest.fn().mockResolvedValue({ success: true, data: { count: 0 } });
    const db = {
      weatherRuns: { getAll: jest.fn().mockResolvedValue({ success: true, data: runs }), deleteByID },
      weatherTextures: { deleteMany },
    };
    return { db, deleteByID };
  };

  it("never prunes a recently-created pending run mid-bake, even below the cutoff", async () => {
    const nowIso = new Date().toISOString();
    const runs = [
      { id: "pub1", model: "gfs", run: "2026-07-12T18:00:00Z", published: true, status: "complete" },
      { id: "pub2", model: "gfs", run: "2026-07-12T12:00:00Z", published: true, status: "complete" },
      // an in-flight bake of an older cycle: below the cutoff, but created just now
      { id: "baking", model: "gfs", run: "2026-07-11T00:00:00Z", published: false, status: "pending", created: nowIso },
    ];
    const { db, deleteByID } = mkDb(runs);
    const res = await runRetention(db as any, 2);
    expect(res.prunedRunIds).not.toContain("baking");
    expect(deleteByID).not.toHaveBeenCalledWith("baking");
  });

  it("still prunes a STALE pending run (crashed bake older than the in-flight window)", async () => {
    const oldIso = new Date(Date.now() - 60 * 60 * 1000).toISOString(); // 1h ago
    const runs = [
      { id: "pub1", model: "gfs", run: "2026-07-12T18:00:00Z", published: true, status: "complete" },
      { id: "pub2", model: "gfs", run: "2026-07-12T12:00:00Z", published: true, status: "complete" },
      { id: "crashed", model: "gfs", run: "2026-07-11T00:00:00Z", published: false, status: "pending", created: oldIso },
    ];
    const { db, deleteByID } = mkDb(runs);
    const res = await runRetention(db as any, 2);
    expect(res.prunedRunIds).toContain("crashed");
    expect(deleteByID).toHaveBeenCalledWith("crashed");
  });

  it("does NOT prune the sole in-flight run when no published run exists yet (first bake)", async () => {
    const nowIso = new Date().toISOString();
    const runs = [{ id: "firstBake", model: "gfs", run: "2026-07-12T18:00:00Z", published: false, status: "pending", created: nowIso }];
    const { db, deleteByID } = mkDb(runs);
    const res = await runRetention(db as any, 3);
    expect(res.prunedRunIds).toEqual([]);
    expect(deleteByID).not.toHaveBeenCalled();
  });
});
