/**
 * The hourly compare job re-stored a byte-identical side-by-side every hour per
 * alert, so the same picture sits on disk many times over. This is the one-off
 * reclaim (docs/blob-retention-plan.md §10).
 *
 * The cheapness matters as much as the correctness: two identical files have
 * identical size, so a still with a unique size must never be opened.
 */
import { planDedupCandidates, runSnapshotDedup, type DedupSnapMeta } from "./snapshot-dedup";

const T0 = Date.parse("2026-09-01T00:00:00.000Z");
const HOUR = 3_600_000;

const snap = (id: string, ms: number, over: Partial<DedupSnapMeta> = {}): DedupSnapMeta => ({
  id,
  source: "wmo",
  identifier: "i1",
  kind: "compare",
  layer: "satellite",
  capturedAt: new Date(ms).toISOString(),
  ...over,
});

describe("planDedupCandidates", () => {
  it("only proposes groups where more than one still shares a size", () => {
    const snaps = [snap("a", T0), snap("b", T0 + HOUR), snap("unique", T0 + 2 * HOUR)];
    const sizes = new Map([
      ["a", 1000],
      ["b", 1000],
      ["unique", 2222],
    ]);
    const groups = planDedupCandidates(snaps, sizes);
    expect(groups).toHaveLength(1);
    expect(groups[0].map((s) => s.id).sort()).toEqual(["a", "b"]);
  });

  it("never groups across different alerts, kinds or layers", () => {
    const snaps = [
      snap("a", T0),
      snap("otherAlert", T0, { identifier: "i2" }),
      snap("otherKind", T0, { kind: "satellite" }),
      snap("otherLayer", T0, { layer: "ir" }),
    ];
    const sizes = new Map(snaps.map((s) => [s.id, 1000] as const));
    expect(planDedupCandidates(snaps, sizes)).toEqual([]);
  });

  it("orders each group newest-first so the keeper is the newest copy", () => {
    const snaps = [snap("old", T0), snap("new", T0 + 5 * HOUR), snap("mid", T0 + 2 * HOUR)];
    const sizes = new Map(snaps.map((s) => [s.id, 900] as const));
    expect(planDedupCandidates(snaps, sizes)[0].map((s) => s.id)).toEqual(["new", "mid", "old"]);
  });

  it("skips a still with no blob on disk", () => {
    const snaps = [snap("a", T0), snap("ghost", T0 + HOUR)];
    expect(planDedupCandidates(snaps, new Map([["a", 100]]))).toEqual([]);
  });
});

describe("runSnapshotDedup", () => {
  const buildDb = (
    snaps: DedupSnapMeta[],
    bytesById: Record<string, string>,
  ) => {
    const deleted: string[] = [];
    const opened: string[] = [];
    return {
      deleted,
      opened,
      db: {
        blobFs: {
          listKeys: async () =>
            Object.entries(bytesById).map(([key, v]) => ({
              key,
              bytes: Buffer.from(v).length,
              mtimeMs: 0,
            })),
        },
        alertSnapshots: {
          listAllMeta: async () => snaps,
          getPng: async (id: string) => {
            opened.push(id);
            const v = bytesById[id];
            return v ? { data: Buffer.from(v) } : null;
          },
          deleteMany: async (ids: string[]) => {
            deleted.push(...ids);
            return { removed: ids.length };
          },
        },
      },
    };
  };

  it("drops the older copies of an identical image and keeps the newest", async () => {
    const snaps = [snap("old", T0), snap("mid", T0 + HOUR), snap("new", T0 + 2 * HOUR)];
    const { deleted, db } = buildDb(snaps, { old: "SAME", mid: "SAME", new: "SAME" });

    const res = await runSnapshotDedup(db);

    expect(deleted.sort()).toEqual(["mid", "old"]);
    expect(res).toMatchObject({ duplicates: 2, removed: 2 });
  });

  it("keeps stills that merely share a size but differ in bytes", async () => {
    const snaps = [snap("a", T0), snap("b", T0 + HOUR)];
    const { deleted, db } = buildDb(snaps, { a: "AAAA", b: "BBBB" });

    const res = await runSnapshotDedup(db);

    expect(deleted).toEqual([]);
    expect(res).toMatchObject({ duplicates: 0, hashed: 2 });
  });

  it("never opens a still whose size is unique", async () => {
    const snaps = [snap("a", T0), snap("b", T0 + HOUR), snap("loner", T0 + 2 * HOUR)];
    const { opened, db } = buildDb(snaps, { a: "SAME", b: "SAME", loner: "A_DIFFERENT_LENGTH" });

    await runSnapshotDedup(db);

    expect(opened.sort()).toEqual(["a", "b"]);
    expect(opened).not.toContain("loner");
  });

  it("deletes nothing on a dry run but still reports the reclaim", async () => {
    const snaps = [snap("old", T0), snap("new", T0 + HOUR)];
    const { deleted, db } = buildDb(snaps, { old: "SAME", new: "SAME" });

    const res = await runSnapshotDedup(db, { dryRun: true });

    expect(deleted).toEqual([]);
    expect(res).toMatchObject({ dryRun: true, duplicates: 1, removed: 0 });
    expect(res.reclaimedBytes).toBe(4);
  });

  it("no-ops without a blob folder rather than reading every image", async () => {
    const snaps = [snap("a", T0)];
    const { db } = buildDb(snaps, { a: "SAME" });
    const res = await runSnapshotDedup({ ...db, blobFs: null });
    expect(res).toMatchObject({ scanned: 0, duplicates: 0 });
  });
});
