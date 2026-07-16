import { ingestSource } from "./ingest";
import type { AlertSource } from "@photonsurge/shared/alerts/types";
import type { AlertGeometry } from "@photonsurge/shared/db/alert-model";

const NOW = new Date("2026-07-12T14:30:00Z");

const box = (span: number): AlertGeometry => ({
  type: "Polygon",
  coordinates: [[[0, 0], [span, 0], [span, span], [0, span], [0, 0]]],
});

interface AlertOpt {
  id?: string;
  sev?: number;
  sent?: string;
  msgType?: string;
  headline?: string;
  instruction?: string;
  geometry?: AlertGeometry | null;
  translatedHeadline?: string;
  event?: string;
}

function mkAlert(o: AlertOpt = {}): any {
  return {
    id: o.id ?? "alert-1",
    source: "wmo",
    identifier: "cap-1",
    sender: "",
    sent: o.sent ?? "2026-07-12T14:00:00Z",
    msgType: o.msgType ?? "Alert",
    status: "Actual",
    references: [],
    active: true,
    ingestedAt: "2026-07-12T14:00:00Z",
    maxSeverityRank: o.sev ?? 2,
    expiresAt: "2026-07-12T20:00:00Z",
    info: [
      {
        category: [],
        event: o.event ?? "Storm",
        severityRank: o.sev ?? 2,
        headline: o.headline ?? "Storm warning",
        description: "A storm is coming",
        instruction: o.instruction ?? "Take cover",
        translatedHeadline: o.translatedHeadline,
        area: [{ areaDesc: "", geometry: o.geometry ?? null, geocodes: [] }],
      },
    ],
  };
}

/** A source that yields a fixed normalised alert (no network). */
function fakeSource(next: any): AlertSource {
  return {
    id: "wmo",
    region: "global",
    pollIntervalSec: 600,
    enabled: true,
    reconcile: false,
    fetch: async () => [],
    parse: () => [],
    normalise: () => [next],
  } as unknown as AlertSource;
}

/** Fake db whose upsert behaviour is scripted per test; records appended revisions
 * and (for the unified layer) promotions / timeline beats / watch-schedule upserts. */
function fakeDb(upsert: (a: any) => Promise<any>) {
  const revisions: any[] = [];
  const timelineBeats: any[] = [];
  const watchUpserts: any[] = [];
  const promotions: string[] = [];
  const db = {
    alerts: {
      upsert,
      async supersede() {
        return 0;
      },
      async expire() {
        return 0;
      },
      async deactivateMissing() {
        return 0;
      },
    },
    alertRevisions: {
      async append(rev: any) {
        revisions.push(rev);
        return rev;
      },
    },
    watchedEvents: {
      async promoteFromAlert(a: any) {
        promotions.push(a.identifier);
        // `created` true only the first time we see this identifier (idempotency).
        return { eventId: `evt-${a.identifier}`, created: promotions.filter((x) => x === a.identifier).length === 1 };
      },
    },
    eventTimeline: {
      async appendMany(list: any[]) {
        timelineBeats.push(...list);
        return { inserted: list.length };
      },
    },
    eventWatch: {
      async upsert(s: any) {
        watchUpserts.push(s);
      },
    },
  } as any;
  return { db, revisions, timelineBeats, watchUpserts, promotions };
}

describe("ingestSource — revision capture", () => {
  it("writes NO revision on a fresh insert (prev is null)", async () => {
    const next = mkAlert({ sev: 3 });
    const { db, revisions } = fakeDb(async () => ({ inserted: true, prev: null }));
    const res = await ingestSource(fakeSource(next), db, NOW);
    expect(revisions).toHaveLength(0);
    expect(res.revisions).toBe(0);
    expect(res.inserted).toBe(1);
  });

  it("writes ONE revision on a severity change", async () => {
    const prev = mkAlert({ sev: 2 });
    const next = mkAlert({ sev: 3, sent: "2026-07-12T14:20:00Z" });
    const { db, revisions } = fakeDb(async () => ({ inserted: false, prev }));
    const res = await ingestSource(fakeSource(next), db, NOW);
    expect(revisions).toHaveLength(1);
    expect(res.revisions).toBe(1);
    expect(revisions[0].changes.map((c: any) => c.type)).toContain("SEVERITY_CHANGED");
    // Escalation to severe (3) flags it as newly interesting.
    expect(res.newlyInteresting).toEqual(["alert-1"]);
  });

  it("writes EXACTLY ONE revision on the geometry-strip retry path, diffed against real geometry", async () => {
    const prev = mkAlert({ geometry: box(1) }); // ~12k km²
    const next = mkAlert({ geometry: box(3), sent: "2026-07-12T14:20:00Z" }); // ~110k km²
    let calls = 0;
    const { db, revisions } = fakeDb(async () => {
      calls++;
      if (calls === 1) throw new Error("Edges 1 and 3 cross"); // 2dsphere rejection → strip + retry
      return { inserted: false, prev };
    });
    const res = await ingestSource(fakeSource(next), db, NOW);
    expect(calls).toBe(2); // original threw, stripped retry succeeded
    expect(revisions).toHaveLength(1); // NOT double-fired
    // Diffed against the ORIGINAL geometry (a stripped retry couldn't produce this).
    expect(revisions[0].changes.map((c: any) => c.type)).toContain("AREA_CHANGED");
    expect(res.geoDropped).toBe(1);
  });

  it("writes NO revision on a translation-only re-poll", async () => {
    const prev = mkAlert({});
    // Same source text; only a translated field differs, plus a new `sent` so the
    // upsert fast path is bypassed and we reach the diff.
    const next = mkAlert({ sent: "2026-07-12T14:20:00Z", translatedHeadline: "Übersetzt" });
    const { db, revisions } = fakeDb(async () => ({ inserted: false, prev }));
    const res = await ingestSource(fakeSource(next), db, NOW);
    expect(revisions).toHaveLength(0);
    expect(res.revisions).toBe(0);
  });
});

describe("ingestSource — event promotion (unified layer)", () => {
  const prevEnv = process.env.EVENTS_UNIFIED_ENABLED;
  beforeEach(() => {
    process.env.EVENTS_UNIFIED_ENABLED = "true";
  });
  afterEach(() => {
    if (prevEnv === undefined) delete process.env.EVENTS_UNIFIED_ENABLED;
    else process.env.EVENTS_UNIFIED_ENABLED = prevEnv;
  });

  it("promotes a severe new alert to a WatchedEvent, seeding the opening beat", async () => {
    const next = mkAlert({ sev: 3 });
    const { db, timelineBeats, promotions } = fakeDb(async () => ({ inserted: true, prev: null }));
    const res = await ingestSource(fakeSource(next), db, NOW);
    expect(res.promoted).toBe(1);
    expect(promotions).toEqual(["cap-1"]);
    expect(timelineBeats.some((b) => b.type === "ISSUED")).toBe(true);
  });

  /**
   * The dossier is always promoted; the ACQUISITION SCHEDULE is not. A schedule
   * with no adapter behind it wakes, matches nothing, reports `changed: false`
   * and sleeps, forever — that was 927 of 1,148 scheduled events (81%), all plain
   * weather alerts whose only candidate adapter was Copernicus, whose lifetime
   * yield was zero links.
   *
   * This test previously asserted the opposite (every promotion gets a schedule),
   * which is exactly how the queue filled with no-ops.
   */
  it("does NOT schedule acquisition for a plain weather alert — nothing can fetch for it", async () => {
    // A storm warning with no geometry: WEATHER_ALERT, no repPoint. GDACS doesn't
    // apply, EONET needs a point and a disaster type, Copernicus needs both.
    const next = mkAlert({ sev: 3 });
    const { db, watchUpserts, promotions } = fakeDb(async () => ({ inserted: true, prev: null }));

    await ingestSource(fakeSource(next), db, NOW);

    expect(promotions).toEqual(["cap-1"]); // still a dossier
    expect(watchUpserts).toHaveLength(0); // just nothing to re-ask
  });

  it("DOES schedule acquisition for a flood with a location — EONET serves it", async () => {
    const next = mkAlert({
      sev: 3,
      event: "Riverine Flood",
      geometry: { type: "Point", coordinates: [12.5, 41.9] },
    });
    const { db, watchUpserts } = fakeDb(async () => ({ inserted: true, prev: null }));

    await ingestSource(fakeSource(next), db, NOW);

    expect(watchUpserts).toHaveLength(1);
    expect(watchUpserts[0]).toMatchObject({ source: "wmo" });
  });

  it("does NOT promote a minor (sub-severe) alert", async () => {
    const next = mkAlert({ sev: 2 });
    const { db, timelineBeats, watchUpserts } = fakeDb(async () => ({ inserted: true, prev: null }));
    const res = await ingestSource(fakeSource(next), db, NOW);
    expect(res.promoted).toBe(0);
    expect(timelineBeats).toHaveLength(0);
    expect(watchUpserts).toHaveLength(0);
  });

  it("mirrors a severity change onto the event timeline and stamps the revision's eventId", async () => {
    const prev = mkAlert({ sev: 2 });
    const next = mkAlert({ sev: 3, sent: "2026-07-12T14:20:00Z" });
    const { db, revisions, timelineBeats } = fakeDb(async () => ({ inserted: false, prev }));
    await ingestSource(fakeSource(next), db, NOW);
    expect(revisions[0].eventId).toBe("evt-cap-1");
    expect(timelineBeats.some((b) => b.type === "SEVERITY_CHANGED")).toBe(true);
  });

  it("is idempotent: a second ingest of the same event does not re-seed the opening beat", async () => {
    const next = mkAlert({ sev: 3 });
    const { db, timelineBeats } = fakeDb(async () => ({ inserted: true, prev: null }));
    await ingestSource(fakeSource(next), db, NOW);
    await ingestSource(fakeSource(next), db, NOW);
    expect(timelineBeats.filter((b) => b.type === "ISSUED")).toHaveLength(1);
  });

  it("does nothing when the flag is off", async () => {
    delete process.env.EVENTS_UNIFIED_ENABLED;
    const next = mkAlert({ sev: 4 });
    const { db, promotions, timelineBeats } = fakeDb(async () => ({ inserted: true, prev: null }));
    const res = await ingestSource(fakeSource(next), db, NOW);
    expect(res.promoted).toBe(0);
    expect(promotions).toHaveLength(0);
    expect(timelineBeats).toHaveLength(0);
  });
});
