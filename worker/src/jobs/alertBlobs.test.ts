/**
 * The rebuild's memory shape, as the job orchestrates it: one hazard loaded and
 * clipped at a time, its shapes WRITTEN before the next bucket loads, and the
 * previous generation retired only once every bucket has landed.
 *
 * These are the two failures this job has actually had in production — an OOM at
 * the 4GB heap from holding the whole planet, and (had the drop moved earlier) a
 * globe that empties for the length of a rebuild — so they're pinned here rather
 * than left to the repo tests, which can't see the loop.
 */
import type { iAlert } from "@photonsurge/shared/db/alert-model";
import { attachCities } from "../alerts/blob-cities";
import { rebuildAlertBlobs } from "../alerts/rebuildBlobs";

// The rebuild moved into its own module so it can run in a child process; the job
// handler (alertBlobs.ts) now only forks it. These tests drive the rebuild
// directly — that's where the loop's memory-shape invariants live.
jest.mock("../blog", () => ({ blogInfo: jest.fn(), blogErr: jest.fn() }));
jest.mock("../alerts/blob-cities", () => ({
  attachCities: jest.fn(async () => ({ cities: 4, empty: 0, repaired: 0, failures: 0 })),
}));

/** An alert covering one square — the shape of a MeteoAlarm county warning. */
const county = (id: string, rank: number, [w, s, e, n]: number[], cc = "PL"): iAlert =>
  ({
    id,
    // A real CAP alert knows where it came from, and the dissolve decodes the
    // country out of these two to bucket on it. A fixture without them can't
    // notice a projection that forgets to ask for them.
    source: "meteoalarm",
    identifier: `2.49.0.0.${cc}.20260716`,
    maxSeverityRank: rank,
    info: [
      {
        event: "Thunderstorm",
        severityRank: rank,
        area: [
          {
            areaDesc: id,
            geometry: { type: "Polygon", coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]] },
          },
        ],
      },
    ],
  }) as unknown as iAlert;

/**
 * Two hazards' worth of alerts. Severity splits the buckets, so the test doesn't
 * ride on however `classifyHazard` happens to map an event name today.
 */
const twoHazards = () => [
  county("a1", 3, [0, 0, 1, 1]),
  county("a2", 3, [1, 0, 2, 1]), // touches a1 — fuses
  county("b1", 2, [10, 10, 11, 11]),
];

let ALERTS: iAlert[] = [];

function mockDb() {
  /** Every step that matters, in order: which bucket was read, what was written. */
  const trace: string[] = [];
  const alertsModel = {
    find: (filter: any, projection: any) => {
      const ids: string[] | undefined = filter.id?.$in;
      const wantsGeometry = "info.area.geometry" in projection;
      if (ids) trace.push(`load ${ids.join("+")}`);
      const docs = ids ? ALERTS.filter((a) => ids.includes(a.id!)) : ALERTS;
      /**
       * HONOUR THE PROJECTION — Mongo does, and a mock that doesn't cannot see a
       * field the job forgot to ask for.
       *
       * This mock used to hand back whole documents, so both passes got `source`
       * and `identifier` whether they'd asked or not. Pass 2 hadn't, every blob
       * came back stamped "unknown country", and these tests stayed green through
       * all of it while the live globe lost every country label.
       */
      const project = (a: any) => {
        const out: any = {};
        for (const k of Object.keys(a)) {
          if (k === "info") continue;
          if (projection[k]) out[k] = a[k];
        }
        out.info = wantsGeometry ? a.info : [{ ...a.info[0], area: undefined }];
        return out;
      };
      const chain = {
        lean: () => chain,
        // Pass 1 asks WITHOUT the geometry — the whole point of the two-pass
        // read, so hand back what Mongo would and let the job cope.
        exec: async () => docs.map(project),
      };
      return chain;
    },
  };
  const db = {
    alerts: { model: alertsModel },
    cities: { model: {} },
    alertBlobs: {
      addGeneration: jest.fn(async (blobs: any[], builtAt: Date) => {
        trace.push(`write ${blobs.length}@${builtAt.toISOString()}`);
        return blobs.length;
      }),
      commitGeneration: jest.fn(async (builtAt: Date) => {
        trace.push(`commit ${builtAt.toISOString()}`);
        return { live: 2, removed: 9 };
      }),
    },
  };
  return { db, trace };
}

const run = (db: any) => rebuildAlertBlobs(db);

beforeEach(() => {
  jest.clearAllMocks();
  ALERTS = twoHazards();
});

describe("alert blobs rebuild", () => {
  /**
   * Both passes must ask for `source`/`identifier`. The country is decoded from
   * them and it's part of the bucket key, so a projection that omits them doesn't
   * fail — it silently buckets the whole planet as "unknown". Pass 2 forgot, and
   * nothing complained: the job's own log line prints PASS 1's key, so the console
   * cheerfully read `heat|2|PL` while every blob written was stamped with no
   * country at all.
   */
  it("stamps each shape with its country", async () => {
    const { db } = mockDb();

    await run(db);

    const written = (db.alertBlobs.addGeneration as jest.Mock).mock.calls.flatMap((c) => c[0]);
    expect(written.length).toBeGreaterThan(0);
    for (const b of written) expect(b.country).toBe("PL");
  });

  it("asks for the country fields in EVERY pass, not just the first", async () => {
    const { db } = mockDb();
    const find = jest.spyOn(db.alerts.model, "find");

    await run(db);

    expect(find.mock.calls.length).toBeGreaterThan(1);
    for (const [, projection] of find.mock.calls) {
      expect(projection).toMatchObject({ source: 1, identifier: 1 });
    }
  });

  it("keeps two countries' touching counties in separate shapes", async () => {
    ALERTS = [county("pl", 3, [0, 0, 1, 1], "PL"), county("de", 3, [1, 0, 2, 1], "DE")];
    const { db } = mockDb();

    await run(db);

    const written = (db.alertBlobs.addGeneration as jest.Mock).mock.calls.flatMap((c) => c[0]);
    expect(written.map((b: any) => b.country).sort()).toEqual(["DE", "PL"]);
  });

  it("writes each hazard's shapes before loading the next one", async () => {
    // Accumulating instead meant carrying ~1.9M vertices of finished output on
    // top of whatever bucket was mid-clip. Any write drifting to the end of the
    // loop puts the OOM back.
    const { db, trace } = mockDb();

    await run(db);

    expect(trace).toEqual([
      "load a1+a2",
      expect.stringMatching(/^write 1@/),
      "load b1",
      expect.stringMatching(/^write 1@/),
      expect.stringMatching(/^commit /),
    ]);
  });

  it("commits only after the last bucket has landed", async () => {
    // Everything written before this is `live: false` and invisible, so the
    // commit IS the moment the globe changes. A rebuild that dies before it
    // changes nothing on air — which is the whole point: when the old code put
    // shapes live as they landed and only retired the previous set on this line,
    // a killed job left both generations live forever and the globe drew every
    // shape twice.
    const { db, trace } = mockDb();

    await run(db);

    expect(trace[trace.length - 1]).toMatch(/^commit /);
  });

  it("stamps every instalment and the commit with ONE generation", async () => {
    // A second `new Date()` anywhere in the loop and the commit would put only
    // part of the rebuild on air and sweep the rest away.
    const { db } = mockDb();

    await run(db);

    const stamps = db.alertBlobs.addGeneration.mock.calls.map(([, at]) => at);
    const committed = db.alertBlobs.commitGeneration.mock.calls[0][0];
    expect(new Set(stamps.map((d) => d.getTime())).size).toBe(1);
    expect(committed).toEqual(stamps[0]);
  });

  it("counts the shapes it actually wrote", async () => {
    const { db, trace } = mockDb();

    const r = await run(db);

    expect(r).toMatchObject({ alerts: 3, blobs: 2 });
    expect(trace.filter((t) => t.startsWith("write"))).toHaveLength(2);
  });

  it("reports the vertex saving across all hazards, not just the last", async () => {
    const { db } = mockDb();

    const r = await run(db);

    expect(r.verticesBefore).toBeGreaterThan(0);
    expect(r.verticesAfter).toBeGreaterThan(0);
    expect(r.saved).toMatch(/^\d+%$/);
  });

  it("resolves cities while the bucket is the only geometry in memory", async () => {
    // Once per bucket, before the next load — deferring it to the end would need
    // every shape held, which is the thing the streaming write avoids.
    const { db, trace } = mockDb();

    await run(db);

    expect(attachCities).toHaveBeenCalledTimes(2);
    expect(trace.filter((t) => t.startsWith("load"))).toHaveLength(2);
  });

  it("clears the old shapes even when nothing is active", async () => {
    // No buckets, no writes — but the globe must not keep drawing expired
    // warnings, so the commit still has to run and sweep the old generation.
    const { db, trace } = mockDb();
    ALERTS.length = 0;

    const r = await run(db);

    expect(r).toMatchObject({ alerts: 0, blobs: 0, saved: "0%" });
    expect(db.alertBlobs.commitGeneration).toHaveBeenCalledTimes(1);
    expect(trace).toEqual([expect.stringMatching(/^commit /)]);
  });
});
