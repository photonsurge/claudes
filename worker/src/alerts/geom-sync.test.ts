import { interleaveByCountry, reconcileCachedGeometry } from "./geom-sync";
import type { EdrFeature } from "./meteogate";

const feat = (cc: string, n: number): EdrFeature =>
  ({ alertId: `${cc}-${n}`, countryCode: cc, bbox: null, indexInfo: 0, indexArea: 0 }) as EdrFeature;

describe("interleaveByCountry", () => {
  it("spreads a budget across countries instead of draining the first", () => {
    // The bug this exists for: Austria offered 450 alerts and sorted first, so a
    // sliced budget resolved Austria only — Poland was never reached.
    const m = new Map([
      ["AT", Array.from({ length: 5 }, (_, i) => feat("AT", i))],
      ["PL", Array.from({ length: 5 }, (_, i) => feat("PL", i))],
    ]);

    const first4 = interleaveByCountry(m).slice(0, 4);

    expect(first4.map((f) => f.countryCode)).toEqual(["AT", "PL", "AT", "PL"]);
  });

  it("keeps going once a short country runs out", () => {
    const m = new Map([
      ["AT", [feat("AT", 0)]],
      ["PL", [feat("PL", 0), feat("PL", 1), feat("PL", 2)]],
    ]);

    expect(interleaveByCountry(m).map((f) => f.alertId)).toEqual(["AT-0", "PL-0", "PL-1", "PL-2"]);
  });

  it("loses nothing — every alert still appears exactly once", () => {
    const m = new Map([
      ["AT", Array.from({ length: 7 }, (_, i) => feat("AT", i))],
      ["PL", Array.from({ length: 3 }, (_, i) => feat("PL", i))],
      ["UK", Array.from({ length: 5 }, (_, i) => feat("UK", i))],
    ]);

    const out = interleaveByCountry(m);

    expect(out).toHaveLength(15);
    expect(new Set(out.map((f) => f.alertId)).size).toBe(15);
  });

  it("handles empty input", () => {
    expect(interleaveByCountry(new Map())).toEqual([]);
    expect(interleaveByCountry(new Map([["AT", []]]))).toEqual([]);
  });
});

/**
 * The reconcile exists because the backfill got exactly ONE attempt per area — on
 * the run that resolved it. Live, 254 areas across 34 EMMA_IDs held an exact
 * cached boundary and no shape on the alert; ES075's was cached at 17:19 for
 * alerts stored at 15:58, and the retro-fit that should have joined them ran and
 * left them empty. Calling the same backfill by hand days later fixed all 22
 * first time.
 */
describe("reconcileCachedGeometry", () => {
  const mkDb = (opts: {
    missing: string[];
    cached: Record<string, unknown>;
    backfill?: (emmaId: string) => Promise<number>;
  }) => {
    const calls: string[] = [];
    const db = {
      alerts: {
        emmaIdsMissingGeometry: async () => opts.missing,
        backfillAreaGeometry: async (emmaId: string) => {
          calls.push(emmaId);
          return opts.backfill ? opts.backfill(emmaId) : 1;
        },
      },
      alertAreaGeom: {
        byEmmaIds: async (ids: string[]) =>
          new Map(
            ids.filter((i) => i in opts.cached).map((i) => [i, { geometry: opts.cached[i], precision: "exact" }]),
          ),
      },
    } as any;
    return { db, calls };
  };

  it("applies a cached boundary to an alert whose one backfill attempt missed", async () => {
    const { db, calls } = mkDb({ missing: ["ES075"], cached: { ES075: { type: "Polygon" } } });
    const res = { reconciled: 0, failures: [] as string[] };

    await reconcileCachedGeometry(db, res);

    expect(calls).toEqual(["ES075"]);
    expect(res.reconciled).toBe(1);
  });

  it("writes nothing when nothing is missing (so it can run every tick)", async () => {
    const { db, calls } = mkDb({ missing: [], cached: { ES075: { type: "Polygon" } } });
    const res = { reconciled: 0, failures: [] as string[] };

    await reconcileCachedGeometry(db, res);

    expect(calls).toEqual([]);
    expect(res.reconciled).toBe(0);
  });

  it("ignores areas we haven't fetched yet — that's the quota's backlog, not a miss", async () => {
    // 201 EMMA_IDs live are simply not in the cache. Nothing to apply, no writes.
    const { db, calls } = mkDb({ missing: ["RS002", "DE806"], cached: {} });
    const res = { reconciled: 0, failures: [] as string[] };

    await reconcileCachedGeometry(db, res);

    expect(calls).toEqual([]);
    expect(res.reconciled).toBe(0);
  });

  it("only applies the boundaries it actually holds", async () => {
    const { db, calls } = mkDb({ missing: ["ES075", "RS002"], cached: { ES075: { type: "Polygon" } } });
    const res = { reconciled: 0, failures: [] as string[] };

    await reconcileCachedGeometry(db, res);

    expect(calls).toEqual(["ES075"]);
  });

  it("one bad polygon does not cost the rest of the run", async () => {
    // Exactly how the original 254 got stranded: a rejected write, swallowed, and
    // never retried. Here the next area must still land.
    const { db, calls } = mkDb({
      missing: ["BAD", "ES075"],
      cached: { BAD: { type: "Polygon" }, ES075: { type: "Polygon" } },
      backfill: async (id) => {
        if (id === "BAD") throw new Error("Can't extract geo keys: bad loop");
        return 22;
      },
    });
    const res = { reconciled: 0, failures: [] as string[] };

    await reconcileCachedGeometry(db, res);

    expect(calls).toEqual(["BAD", "ES075"]);
    expect(res.reconciled).toBe(22);
    expect(res.failures[0]).toContain("reconcile BAD");
  });
});
