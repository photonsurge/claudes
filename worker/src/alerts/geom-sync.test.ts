import { interleaveByCountry, interleavePages, planCrawl, reconcileCachedGeometry } from "./geom-sync";
import type { CrawlCursor } from "@photonsurge/shared/db/alert-area-geom-repo";
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

describe("interleavePages", () => {
  it("spreads a page budget across countries instead of draining the biggest", () => {
    // Live: DE has 281 unread pages to AT's 40, and countries sweep
    // alphabetically. Drained in order, DE eats the run and AT waits for Germany.
    const m = new Map([
      ["DE", [2, 3, 4, 5, 6]],
      ["AT", [2, 3]],
    ]);

    expect(interleavePages(m).slice(0, 4)).toEqual([
      { cc: "DE", page: 2 },
      { cc: "AT", page: 2 },
      { cc: "DE", page: 3 },
      { cc: "AT", page: 3 },
    ]);
  });

  it("keeps a country's pages in ascending order, so a cursor can resume", () => {
    // advanceCrawl records the highest page reached and assumes everything below
    // it was read. Out-of-order interleaving would silently skip pages forever.
    const m = new Map([
      ["DE", [2, 3, 4]],
      ["AT", [2]],
    ]);

    const de = interleavePages(m).filter((x) => x.cc === "DE").map((x) => x.page);

    expect(de).toEqual([2, 3, 4]);
  });

  it("handles empty input", () => {
    expect(interleavePages(new Map())).toEqual([]);
    expect(interleavePages(new Map([["AT", []]]))).toEqual([]);
  });
});

/**
 * The crawl exists because the sweep read three pages per country — page 1, the
 * last, and the second-to-last — and never the middle. Measured live that is 492
 * of 565 pages (87%) permanently unread: DE 281 pages, AT 42. Reading all 42 of
 * Austria's turned up 7 EMMA_IDs we lack, every one on page 2.
 *
 * The window is the whole subtlety. It must be PINNED for the length of a crawl,
 * because the feed's default is "the last 23 hours" and it moves — so page 5 next
 * run is not page 5 this run, and a naive cursor would skip areas exactly as the
 * page cap does.
 */
describe("planCrawl", () => {
  const now = new Date("2026-07-16T12:00:00Z");
  const WEEK = 7 * 24 * 60 * 60 * 1000;
  // The pinned window is deliberately NOT the rolling window at `now` — an
  // earlier version of this fixture used now-23h/now, which is exactly what a
  // re-derived window would produce, so the pin assertion below couldn't fail.
  const cursor = (o: Partial<CrawlCursor>): CrawlCursor => ({
    countryCode: "AT",
    windowFrom: new Date("2026-07-10T02:00:00Z"),
    windowTo: new Date("2026-07-11T01:00:00Z"),
    nextPage: 2,
    totalPages: 42,
    ...o,
  });

  it("opens a crawl over every unread page when there is no cursor", () => {
    const p = planCrawl("AT", 42, undefined, now);

    expect(p.action).toBe("start");
    // Page 1 is the freshness read's job; the crawl owns 2..42 — the 39 pages
    // that were never read at all.
    expect(p.pages).toEqual(Array.from({ length: 41 }, (_, i) => i + 2));
    expect(p.window.to).toEqual(now);
  });

  it("resumes an open crawl on its PINNED window, not a fresh one", () => {
    // The whole reason the cursor stores a window. Re-deriving it from `now`
    // would renumber the pages under the crawl.
    const c = cursor({ nextPage: 20 });

    const p = planCrawl("AT", 42, c, now);

    expect(p.action).toBe("resume");
    expect(p.pages[0]).toBe(20);
    expect(p.window.from).toEqual(c.windowFrom);
    expect(p.window.to).toEqual(c.windowTo);
  });

  it("resumes against the cursor's totalPages, not the live one", () => {
    // The feed has moved on (live says 50) but this crawl's pinned window still
    // has 42. Walking to 50 would read pages that don't exist in that query.
    const p = planCrawl("AT", 50, cursor({ nextPage: 40 }), now);

    expect(p.pages).toEqual([40, 41, 42]);
  });

  it("skips a country whose crawl finished recently — the middle is known", () => {
    const p = planCrawl("AT", 42, cursor({ completedAt: new Date("2026-07-15T12:00:00Z") }), now);

    expect(p.action).toBe("skip");
    expect(p.pages).toEqual([]);
  });

  it("re-crawls once a completed crawl is stale, to find areas that had no warning", () => {
    // An area only teaches us its boundary when a warning appears over it, so a
    // finished crawl is not final — it's just current.
    const old = new Date(now.getTime() - WEEK - 1000);

    const p = planCrawl("AT", 42, cursor({ completedAt: old }), now);

    expect(p.action).toBe("start");
    expect(p.window.to).toEqual(now);
  });

  it("re-pins a crawl that ran off the end of its window", () => {
    // nextPage past totalPages with no completedAt means the record is
    // inconsistent; re-pin rather than walk pages that aren't there.
    const p = planCrawl("AT", 42, cursor({ nextPage: 99, totalPages: 42 }), now);

    expect(p.action).toBe("start");
  });

  it("never hands page 1 to the crawl, even from a corrupt cursor", () => {
    // The freshness read owns page 1. A cursor claiming otherwise would spend a
    // gateway request re-reading a page this run already has.
    const p = planCrawl("AT", 42, cursor({ nextPage: 1 }), now);

    expect(p.pages[0]).toBe(2);
  });

  it("asks for nothing when a country is a single page", () => {
    // 20 of the 39 countries are one page — the freshness read already has it.
    const p = planCrawl("RS", 1, undefined, now);

    expect(p.pages).toEqual([]);
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
