/**
 * A blob whose metadata doc is gone is invisible to every read path and nothing
 * would ever delete it, so a prune that died between its two writes leaks bytes
 * permanently. There was no sweeper at all (docs/blob-retention-plan.md §10).
 *
 * The safety properties are what these pin: report by default, never touch a
 * namespace with no owning collection, and never delete a just-written file.
 */
import { runOrphanSweep } from "./orphans";

const NOW = Date.parse("2026-09-10T12:00:00.000Z");
const MIN = 60_000;

/** A db whose only registered owner namespace is `alert-snapshot`. */
const buildDb = (
  disk: Record<string, { key: string; bytes: number; mtimeMs: number }[]>,
  referenced: string[],
) => {
  const deleted: { ns: string; keys: string[] }[] = [];
  return {
    deleted,
    db: {
      blobFs: {
        listNamespaces: async () => Object.keys(disk),
        listKeys: async (ns: string) => disk[ns] ?? [],
        delete: async (ns: string, keys: string[]) => {
          deleted.push({ ns, keys });
        },
      },
      // Only the fields namespaceOwners reads; `distinct` answers for all of them.
      ...Object.fromEntries(
        [
          "weatherTextures",
          "weatherFrames",
          "weatherForecastFrames",
          "adminImages",
          "ads",
          "alertSnapshots",
          "eventSnapshots",
          "volcanoMedia",
        ].map((k) => [k, { model: { distinct: () => ({ exec: async () => referenced }) } }]),
      ),
      aurora: { auroraModel: { distinct: () => ({ exec: async () => referenced }) } },
      geomag: { geomagModel: { distinct: () => ({ exec: async () => referenced }) } },
      satimg: { satImgModel: { distinct: () => ({ exec: async () => referenced }) } },
    },
  };
};

const file = (key: string, bytes = 100, ageMin = 120) => ({
  key,
  bytes,
  mtimeMs: NOW - ageMin * MIN,
});

describe("runOrphanSweep", () => {
  it("reports orphans without deleting anything by default", async () => {
    const { deleted, db } = buildDb({ "alert-snapshot": [file("live"), file("ghost", 500)] }, ["live"]);

    const res = await runOrphanSweep(db, { now: NOW });

    expect(deleted).toEqual([]);
    expect(res).toMatchObject({ apply: false, orphans: 1, orphanBytes: 500, deleted: 0 });
  });

  it("deletes only the unreferenced keys when applied", async () => {
    const { deleted, db } = buildDb({ "alert-snapshot": [file("live"), file("ghost")] }, ["live"]);

    const res = await runOrphanSweep(db, { apply: true, now: NOW });

    expect(deleted).toEqual([{ ns: "alert-snapshot", keys: ["ghost"] }]);
    expect(res).toMatchObject({ deleted: 1 });
  });

  it("spares a file written moments ago, whose doc may still be in flight", async () => {
    const { deleted, db } = buildDb(
      { "alert-snapshot": [file("justWritten", 100, 1)] },
      [], // nothing referenced yet
    );

    const res = await runOrphanSweep(db, { apply: true, now: NOW });

    expect(deleted).toEqual([]);
    expect(res).toMatchObject({ orphans: 0 });
  });

  it("skips a namespace with no owning collection instead of guessing", async () => {
    const { deleted, db } = buildDb({ basemap: [file("satellite"), file("terrain")] }, []);

    const res = await runOrphanSweep(db, { apply: true, now: NOW });

    expect(deleted).toEqual([]);
    expect(res.orphans).toBe(0);
    expect(res.namespaces[0].skipped).toMatch(/no metadata collection/);
    expect(res.namespaces[0].files).toBe(2);
  });

  it("skips an unrecognised namespace directory too", async () => {
    const { deleted, db } = buildDb({ "some-future-thing": [file("x")] }, []);

    const res = await runOrphanSweep(db, { apply: true, now: NOW });

    expect(deleted).toEqual([]);
    expect(res.namespaces[0].skipped).toMatch(/no owning collection/);
  });

  it("no-ops without a blob folder", async () => {
    const res = await runOrphanSweep({ blobFs: null }, { apply: true, now: NOW });
    expect(res).toMatchObject({ orphans: 0, deleted: 0, namespaces: [] });
  });
});
