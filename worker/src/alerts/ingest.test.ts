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
        event: "Storm",
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

/** Fake db whose upsert behaviour is scripted per test; records appended revisions. */
function fakeDb(upsert: (a: any) => Promise<any>) {
  const revisions: any[] = [];
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
  } as any;
  return { db, revisions };
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
