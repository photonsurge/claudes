import { normalizeEonetEvent, scoreEonetMatch, bestEonetMatch, eonetSource } from "./eonet";

const eonetEvent = (over: Record<string, unknown> = {}) => ({
  id: "EONET_6789",
  title: "Tropical Cyclone Alpha",
  closed: null,
  categories: [{ id: "severeStorms", title: "Severe Storms" }],
  sources: [{ id: "JTWC", url: "https://www.metoc.navy.mil/jtwc/alpha" }],
  geometry: [
    { date: "2026-07-12T00:00:00Z", type: "Point", coordinates: [120, 14] },
    { date: "2026-07-12T06:00:00Z", type: "Point", coordinates: [120.4, 14.3] },
  ],
  ...over,
});

describe("normalizeEonetEvent", () => {
  it("pulls id/title/categories/sources/geometry defensively", () => {
    const n = normalizeEonetEvent(eonetEvent());
    expect(n.eonetId).toBe("EONET_6789");
    expect(n.categories).toEqual(["severeStorms"]);
    expect(n.sources).toHaveLength(1);
    expect(n.geometryDates).toHaveLength(2);
    expect(n.latestPoint).toEqual([120.4, 14.3]); // the last geometry point
    expect(n.closed).toBeNull();
  });

  it("survives an empty payload", () => {
    const n = normalizeEonetEvent({});
    expect(n.sources).toEqual([]);
    expect(n.latestPoint).toBeNull();
  });
});

describe("scoreEonetMatch / bestEonetMatch", () => {
  const event = { type: "CYCLONE", repPoint: { type: "Point", coordinates: [120, 14] } } as any;

  it("scores a nearby same-category event high and a far one zero", () => {
    const near = normalizeEonetEvent(eonetEvent());
    expect(scoreEonetMatch(event, near)).toBeGreaterThan(0.85); // ~55 km apart → ~0.89
    const far = normalizeEonetEvent(
      eonetEvent({ geometry: [{ date: "2026-07-12T00:00:00Z", type: "Point", coordinates: [-50, -20] }] }),
    );
    expect(scoreEonetMatch(event, far)).toBe(0);
  });

  it("rejects a category mismatch outright", () => {
    const flood = normalizeEonetEvent(eonetEvent({ categories: [{ id: "floods" }] }));
    expect(scoreEonetMatch(event, flood)).toBe(0);
  });

  it("picks the best candidate above threshold, else null", () => {
    const cand = [normalizeEonetEvent(eonetEvent())];
    expect(bestEonetMatch(event, cand)?.norm.eonetId).toBe("EONET_6789");
    const noHit = [normalizeEonetEvent(eonetEvent({ geometry: [{ date: "x", type: "Point", coordinates: [0, 0] }] }))];
    expect(bestEonetMatch(event, noHit)).toBeNull();
  });
});

describe("eonetSource.appliesTo", () => {
  it("applies only to events with a repPoint and a mapped category", () => {
    expect(eonetSource.appliesTo({ type: "CYCLONE", repPoint: { type: "Point", coordinates: [0, 0] } } as any)).toBe(true);
    expect(eonetSource.appliesTo({ type: "CYCLONE" } as any)).toBe(false); // no repPoint
    expect(eonetSource.appliesTo({ type: "WEATHER_ALERT", repPoint: { type: "Point", coordinates: [0, 0] } } as any)).toBe(false); // no category
  });
});

describe("eonetSource.acquire", () => {
  const event = { id: "evt-1", type: "CYCLONE", repPoint: { type: "Point", coordinates: [120, 14] }, title: "TC Alpha" } as any;

  function fakeDb(existingLink: boolean, observeChanged: boolean) {
    const calls = { links: 0, revisions: 0, resources: 0, beats: [] as any[] };
    const db = {
      eventLinks: {
        async listForEvent() {
          return existingLink ? [{ source: "eonet", externalId: "EONET_6789" }] : [];
        },
        async upsertLink() {
          calls.links++;
          return { linked: true };
        },
      },
      eventSources: { async observe() { return { changed: observeChanged, firstSeen: !existingLink }; } },
      eventSourceRevisions: { async append() { calls.revisions++; return {}; } },
      eventResources: { async upsertMany(l: any[]) { calls.resources += l.length; return { upserted: l.length, matched: 0 }; } },
      eventTimeline: { async appendMany(l: any[]) { calls.beats.push(...l); return { inserted: l.length }; } },
    } as any;
    return { db, calls };
  }

  const listFetch = async () =>
    ({ ok: true, json: async () => ({ events: [eonetEvent()] }) }) as unknown as Response;

  it("matches a candidate, links it DERIVED and writes the dossier", async () => {
    const { db, calls } = fakeDb(false, true);
    const res = await eonetSource.acquire({ db, event, now: new Date("2026-07-12T15:00:00Z"), fetchImpl: listFetch as any });
    expect(res.changed).toBe(true);
    expect(calls.links).toBe(1);
    expect(calls.revisions).toBe(1);
    expect(calls.resources).toBe(1);
    expect(calls.beats.map((b) => b.type)).toEqual(expect.arrayContaining(["SOURCE_LINKED", "GEOMETRY_REFINED"]));
  });

  it("returns no-op when nothing clears the match threshold", async () => {
    const { db, calls } = fakeDb(false, true);
    const farFetch = async () =>
      ({ ok: true, json: async () => ({ events: [eonetEvent({ geometry: [{ date: "x", type: "Point", coordinates: [0, 0] }] })] }) }) as unknown as Response;
    const res = await eonetSource.acquire({ db, event, now: new Date(), fetchImpl: farFetch as any });
    expect(res.changed).toBe(false);
    expect(calls.links).toBe(0);
    expect(calls.beats).toHaveLength(0);
  });
});
