import { makeAdminAreaGeomRepo, adminKey } from "./admin-area-geom-repo";

const POLY = { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] } as any;

describe("adminKey", () => {
  it("upper-cases both halves so the join is case-insensitive", () => {
    expect(adminKey("nuts3", "fr715")).toBe("NUTS3:FR715");
    expect(adminKey("NUTS3", "FR715")).toBe("NUTS3:FR715");
  });
});

describe("adminAreaGeom repo", () => {
  it("byCodes queries each (scheme,code) once and keys the result by adminKey", async () => {
    let filter: any;
    const model = {
      find(f: any) {
        filter = f;
        return {
          lean: () => ({
            exec: async () => [{ scheme: "NUTS3", code: "FR715", geometry: POLY }],
          }),
        };
      },
    } as any;

    const map = await makeAdminAreaGeomRepo(model).byCodes([
      { scheme: "NUTS3", code: "FR715" },
      { scheme: "nuts3", code: "fr715" }, // dup after upper-casing — must not double-query
      { scheme: "NUTS2", code: "HU33" },
    ]);

    // Deduped to two $or clauses, upper-cased.
    expect(filter.$or).toEqual([
      { scheme: "NUTS3", code: "FR715" },
      { scheme: "NUTS2", code: "HU33" },
    ]);
    expect(map.get("NUTS3:FR715")).toEqual(POLY);
  });

  it("byCodes returns an empty map (and no query) for no pairs", async () => {
    const model = { find: jest.fn() } as any;
    expect((await makeAdminAreaGeomRepo(model).byCodes([])).size).toBe(0);
    expect(model.find).not.toHaveBeenCalled();
  });

  it("byNameKeys groups candidates by nameKey (a name can repeat)", async () => {
    let filter: any;
    const model = {
      find(f: any) {
        filter = f;
        return {
          lean: () => ({
            exec: async () => [
              { code: "CHN.JX", nameKey: "pingxiang", centroid: [113.8, 27.6], geometry: POLY },
              { code: "CHN.GX", nameKey: "pingxiang", centroid: [106.6, 22.1], geometry: POLY },
              { code: "CHN.NC", nameKey: "nanchang", centroid: [115, 28], geometry: POLY },
            ],
          }),
        };
      },
    } as any;

    const map = await makeAdminAreaGeomRepo(model).byNameKeys("gadm3", ["pingxiang", "pingxiang", "nanchang"]);

    // Deduped keys, scheme upper-cased.
    expect(filter).toEqual({ scheme: "GADM3", nameKey: { $in: ["pingxiang", "nanchang"] } });
    expect(map.get("pingxiang")).toHaveLength(2);
    expect(map.get("pingxiang")!.map((c) => c.code)).toEqual(["CHN.JX", "CHN.GX"]);
    expect(map.get("nanchang")).toHaveLength(1);
  });

  it("byNameKeys returns an empty map (and no query) for no keys", async () => {
    const model = { find: jest.fn() } as any;
    expect((await makeAdminAreaGeomRepo(model).byNameKeys("GADM3", [])).size).toBe(0);
    expect(model.find).not.toHaveBeenCalled();
  });

  it("upsertMany keys the upsert on (scheme,code), upper-cased", async () => {
    let ops: any[] = [];
    const model = {
      bulkWrite: async (o: any[]) => {
        ops = o;
        return { upsertedCount: 1, modifiedCount: 0 };
      },
    } as any;

    const r = await makeAdminAreaGeomRepo(model).upsertMany([
      { scheme: "NUTS3", code: "fr715", geometry: POLY, name: "Loire" },
    ]);

    expect(ops[0].updateOne.filter).toEqual({ scheme: "NUTS3", code: "FR715" });
    expect(ops[0].updateOne.upsert).toBe(true);
    expect(r.upserted).toBe(1);
  });

  it("upsertMany is a no-op for an empty import", async () => {
    const model = { bulkWrite: jest.fn() } as any;
    expect((await makeAdminAreaGeomRepo(model).upsertMany([])).upserted).toBe(0);
    expect(model.bulkWrite).not.toHaveBeenCalled();
  });
});
