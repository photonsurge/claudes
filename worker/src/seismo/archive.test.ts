/**
 * The live `Quake` collection carries a 31-day TTL, so every earthquake older
 * than a month was deleted by Mongo with nothing keeping a copy: there was no
 * long-term seismic record at all (docs/blob-retention-plan.md §9). This job is
 * that copy.
 */
import { runQuakeArchive } from "./archive";

const DAY = 86_400_000;
const NOW = Date.parse("2026-09-10T00:00:00.000Z");

const quake = (quakeId: string, mag: number, ageDays = 1) => ({
  quakeId,
  mag,
  place: "somewhere",
  time: new Date(NOW - ageDays * DAY),
  lng: 1,
  lat: 2,
  depthKm: 10,
  tsunami: false,
});

const buildDb = (all: ReturnType<typeof quake>[]) => {
  const archived: ReturnType<typeof quake>[] = [];
  const calls: { minMag?: number; sinceMs?: number; limit?: number }[] = [];
  return {
    archived,
    calls,
    db: {
      quakes: {
        list: async (o: { minMag?: number; sinceMs?: number; limit?: number }) => {
          calls.push(o);
          return all.filter(
            (q) =>
              (o.minMag === undefined || q.mag >= o.minMag) &&
              (o.sinceMs === undefined || +new Date(q.time) >= o.sinceMs),
          );
        },
      },
      quakeArchive: {
        archiveMany: async (qs: ReturnType<typeof quake>[]) => {
          archived.push(...qs);
          return { archived: qs.length, updated: 0 };
        },
        count: async () => archived.length,
      },
    },
  };
};

describe("runQuakeArchive", () => {
  const prevMag = process.env.QUAKE_ARCHIVE_MIN_MAG;
  const prevLookback = process.env.QUAKE_ARCHIVE_LOOKBACK_DAYS;
  afterEach(() => {
    if (prevMag === undefined) delete process.env.QUAKE_ARCHIVE_MIN_MAG;
    else process.env.QUAKE_ARCHIVE_MIN_MAG = prevMag;
    if (prevLookback === undefined) delete process.env.QUAKE_ARCHIVE_LOOKBACK_DAYS;
    else process.env.QUAKE_ARCHIVE_LOOKBACK_DAYS = prevLookback;
  });

  it("archives events at or above the magnitude floor, skipping the small ones", async () => {
    const { archived, db } = buildDb([quake("big", 6.1), quake("mid", 4.5), quake("small", 2.2)]);

    const res = await runQuakeArchive(db, { now: NOW });

    expect(archived.map((q) => q.quakeId).sort()).toEqual(["big", "mid"]);
    expect(res).toMatchObject({ candidates: 2, archived: 2, dryRun: false });
  });

  it("writes nothing on a dry run but still reports what it found", async () => {
    const { archived, db } = buildDb([quake("big", 6.1)]);

    const res = await runQuakeArchive(db, { dryRun: true, now: NOW });

    expect(archived).toEqual([]);
    expect(res).toMatchObject({ dryRun: true, candidates: 1, archived: 0 });
  });

  it("sweeps a lookback wide enough that missed runs lose nothing", async () => {
    const { calls, db } = buildDb([quake("recent", 5)]);

    await runQuakeArchive(db, { now: NOW });

    // Default lookback is 30 days against a 31-day TTL, so a skipped run is safe.
    expect(NOW - (calls[0].sinceMs ?? 0)).toBe(30 * DAY);
  });

  it("honours a widened magnitude floor and lookback", async () => {
    process.env.QUAKE_ARCHIVE_MIN_MAG = "6";
    process.env.QUAKE_ARCHIVE_LOOKBACK_DAYS = "5";
    const { archived, calls, db } = buildDb([quake("big", 6.1), quake("mid", 4.6)]);

    const res = await runQuakeArchive(db, { now: NOW });

    expect(archived.map((q) => q.quakeId)).toEqual(["big"]);
    expect(NOW - (calls[0].sinceMs ?? 0)).toBe(5 * DAY);
    expect(res).toMatchObject({ minMag: 6, lookbackDays: 5 });
  });

  it("defaults its floor to the magnitude of the feed we ingest, not higher", async () => {
    delete process.env.QUAKE_ARCHIVE_MIN_MAG;
    const { archived, db } = buildDb([quake("big", 6.1), quake("mid", 3.0), quake("tiny", 1.1)]);

    const res = await runQuakeArchive(db, { now: NOW });

    // USGS feed is "2.5_day", so anything it hands us belongs in the record.
    expect(res.minMag).toBe(2.5);
    expect(archived.map((q) => q.quakeId).sort()).toEqual(["big", "mid"]);
  });

  it("treats an explicit floor of 0 as archive-everything, not as unset", async () => {
    process.env.QUAKE_ARCHIVE_MIN_MAG = "0";
    const { archived, db } = buildDb([quake("big", 6.1), quake("tiny", 0.4)]);

    const res = await runQuakeArchive(db, { now: NOW });

    expect(res.minMag).toBe(0);
    expect(archived.map((q) => q.quakeId).sort()).toEqual(["big", "tiny"]);
  });

  it("copes with an empty window", async () => {
    const { archived, db } = buildDb([]);
    const res = await runQuakeArchive(db, { now: NOW });
    expect(archived).toEqual([]);
    expect(res).toMatchObject({ candidates: 0, archived: 0 });
  });
});
