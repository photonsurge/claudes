import { resolveClip, refreshClipLabel } from "./script-resolve";
import { DEFAULT_DIRECTOR_CONFIG, type DirectorConfig, type Segment } from "@photonsurge/shared/director";
import { TARGET_WORLD_ROUNDUP, TARGET_WORLD_SPIN, type ShortClip } from "@photonsurge/shared/short-script";
import { QUAKE_LIVE_WINDOW_MS } from "@photonsurge/shared/seismic";
import type { AppDb } from "@photonsurge/shared/db/index";

const NOW = Date.parse("2026-10-04T12:00:00Z");

const cfg = (over: Partial<DirectorConfig> = {}): DirectorConfig => ({ ...DEFAULT_DIRECTOR_CONFIG, ...over });

const clip = (target: string, over: Partial<ShortClip> = {}): ShortClip => ({
  id: `c-${target}`,
  target,
  durationMs: 9_000,
  label: { title: target },
  ...over,
});

const alertDoc = (over: Record<string, any> = {}) => ({
  source: "meteoalarm",
  identifier: "2.49.0.0.276:1",
  active: true,
  expiresAt: new Date(NOW + 60 * 60 * 1000).toISOString(),
  maxSeverityRank: 3,
  created: new Date(NOW - 60 * 60 * 1000),
  info: [
    {
      event: "Wind warning",
      area: [{ areaDesc: "Bavaria", geometry: { type: "Polygon", coordinates: [[[10, 47], [12, 47], [12, 49], [10, 49], [10, 47]]] } }],
    },
  ],
  ...over,
});

const quakeDoc = (over: Record<string, any> = {}) =>
  ({ quakeId: "us7000abcd", mag: 6.2, place: "Off Japan", depthKm: 10, lng: 140, lat: 38, time: new Date(NOW - 60_000), ...over }) as any;

const volcanoDoc = (over: Record<string, any> = {}) =>
  ({ id: "gvp:211060", name: "Etna", country: "Italy", status: "erupting", lng: 15, lat: 37.7, lastDate: NOW, statusChangedAt: NOW, ...over }) as any;

const summaryDoc = (over: Record<string, any> = {}) => ({
  id: "sum1",
  period: "hourly",
  narrativeStatus: "ok",
  narrative: "Storms over the Gulf and a strong quake off Japan.",
  generatedAt: new Date(NOW - 30 * 60 * 1000),
  hotspots: [],
  topEvents: [],
  ...over,
});

interface FakeOpts {
  alert?: any;
  alertThrows?: boolean;
  quake?: any;
  volcano?: any;
  country?: any;
  region?: any;
  summaries?: Record<string, any>;
}

/** Hand-rolled fake: just the one-subject reads the resolver makes. */
function fakeDb(o: FakeOpts = {}) {
  const getByKey = jest.fn(async (source: string, identifier: string) => {
    if (o.alertThrows) throw new Error("mongo down");
    const a = o.alert;
    return a && a.source === source && a.identifier === identifier ? a : null;
  });
  const db = {
    alerts: { getByKey },
    quakes: { get: jest.fn(async (id: string) => (o.quake?.quakeId === id ? o.quake : null)) },
    volcanoes: { get: jest.fn(async (id: string) => (o.volcano?.id === id ? o.volcano : null)) },
    countries: { get: async () => o.country ?? null },
    regions: { get: async () => o.region ?? null },
    eventSummaries: { latest: async (period: string) => (o.summaries ?? {})[period] ?? null },
  };
  return { db: db as unknown as AppDb, getByKey, raw: db };
}

const seg = (r: Awaited<ReturnType<typeof resolveClip>>): Segment => {
  if (!("segment" in r)) throw new Error(`expected a segment, got skipped: ${r.skipped}`);
  return r.segment;
};

/** A country doc with a computed tour: establishing centroid + three cities. */
const japanDoc = {
  tourCentroid: [138, 37],
  tourFrame: { center: [138, 37], zoom: 4.6 },
  tourCities: [
    { name: "Tokyo", lng: 139.7, lat: 35.7 },
    { name: "Osaka", lng: 135.5, lat: 34.7 },
    { name: "Sapporo", lng: 141.3, lat: 43.1 },
  ],
};

describe("resolveClip — targets", () => {
  it("country:<id> builds the country tour", async () => {
    const { db } = fakeDb({ country: japanDoc });
    const s = seg(await resolveClip(db, cfg(), clip("country:japan"), NOW));
    expect(s.id).toBe("country:japan");
    expect(s.kind).toBe("country");
    expect(s.tourStops).toHaveLength(4);
    expect(s.holdMs).toBe(9_000);
  });

  it("region:<id> builds the area shot", async () => {
    const { db } = fakeDb();
    const s = seg(await resolveClip(db, cfg(), clip("region:europe"), NOW));
    expect(s.id).toBe("region:europe");
    expect(s.kind).toBe("region");
  });

  it("storm:<source>:<identifier> loads that one alert by its key (the identifier has colons too)", async () => {
    const { db, getByKey } = fakeDb({ alert: alertDoc() });
    const s = seg(await resolveClip(db, cfg(), clip("storm:meteoalarm:2.49.0.0.276:1"), NOW));
    expect(getByKey).toHaveBeenCalledWith("meteoalarm", "2.49.0.0.276:1");
    expect(s.id).toBe("storm:meteoalarm:2.49.0.0.276:1");
    expect(s.kind).toBe("storm");
  });

  it("quake:<id> builds the quake shot inside the live window", async () => {
    const { db } = fakeDb({ quake: quakeDoc() });
    const s = seg(await resolveClip(db, cfg(), clip("quake:us7000abcd"), NOW));
    expect(s.id).toBe("quake:us7000abcd");
    expect(s.quake).toEqual({ mag: 6.2, depthKm: 10 });
  });

  it("volcano:<id> loads by the full gvp id", async () => {
    const { db, raw } = fakeDb({ volcano: volcanoDoc() });
    const s = seg(await resolveClip(db, cfg(), clip("volcano:gvp:211060"), NOW));
    expect(raw.volcanoes.get).toHaveBeenCalledWith("gvp:211060");
    expect(s.id).toBe("volcano:gvp:211060");
  });

  it("global:roundup picks the freshest valid round-up", async () => {
    const { db } = fakeDb({
      summaries: {
        hourly: summaryDoc({ id: "older", generatedAt: new Date(NOW - 2 * 60 * 60 * 1000) }),
        "12h": summaryDoc({ id: "newer", period: "12h", generatedAt: new Date(NOW - 10 * 60 * 1000) }),
      },
    });
    const s = seg(await resolveClip(db, cfg(), clip(TARGET_WORLD_ROUNDUP), NOW));
    expect(s.id).toBe("global:newer");
    expect(s.summary?.id).toBe("newer");
  });

  it("global:roundup ignores stale and narrative-less round-ups, falling back to the world spin", async () => {
    const { db } = fakeDb({
      summaries: {
        hourly: summaryDoc({ generatedAt: new Date(NOW - 4 * 60 * 60 * 1000) }), // past its 3h stale-after
        daily: summaryDoc({ id: "empty", period: "daily", narrativeStatus: "failed" }),
      },
    });
    const s = seg(await resolveClip(db, cfg(), clip(TARGET_WORLD_ROUNDUP), NOW));
    expect(s.id).toBe("global:world");
    expect(s.summary).toBeUndefined();
  });

  it("global:spin is the plain world spin", async () => {
    const { db } = fakeDb();
    const s = seg(await resolveClip(db, cfg(), clip(TARGET_WORLD_SPIN), NOW));
    expect(s.id).toBe("global:world");
    expect(s.kind).toBe("global");
    expect(s.holdMs).toBe(9_000);
  });
});

describe("resolveClip — skips", () => {
  const skip = async (target: string, o: FakeOpts = {}) => resolveClip(fakeDb(o).db, cfg(), clip(target), NOW);

  it.each([
    ["nonsense", "unknown target"],
    ["flight:abc", "unknown target"],
    ["country:", "unknown target"],
    ["country:atlantis", "unknown country"],
    ["region:atlantis", "unknown area"],
    ["storm:nocolon", "bad alert id"],
    ["storm:meteoalarm:missing", "alert not found"],
    ["quake:nope", "quake not found"],
    ["volcano:gvp:0", "volcano not found"],
  ])("%s → %s", async (target, reason) => {
    expect(await skip(target)).toEqual({ skipped: reason });
  });

  it("an inactive alert", async () => {
    expect(await skip("storm:meteoalarm:2.49.0.0.276:1", { alert: alertDoc({ active: false }) })).toEqual({ skipped: "alert is no longer active" });
  });

  it("an expired alert still flagged active", async () => {
    const alert = alertDoc({ expiresAt: new Date(NOW - 1000).toISOString() });
    expect(await skip("storm:meteoalarm:2.49.0.0.276:1", { alert })).toEqual({ skipped: "alert has expired" });
  });

  it("an alert with no polygon", async () => {
    const alert = alertDoc({ info: [{ event: "Wind", area: [{ areaDesc: "X" }] }] });
    expect(await skip("storm:meteoalarm:2.49.0.0.276:1", { alert })).toEqual({ skipped: "alert has no area to frame" });
  });

  it("a quake older than the live window", async () => {
    const quake = quakeDoc({ time: new Date(NOW - QUAKE_LIVE_WINDOW_MS - 1000) });
    expect(await skip("quake:us7000abcd", { quake })).toEqual({ skipped: "quake is older than the live window" });
  });

  it("a volcano that has gone dormant", async () => {
    expect(await skip("volcano:gvp:211060", { volcano: volcanoDoc({ status: "dormant" }) })).toEqual({ skipped: "volcano is no longer active" });
  });

  it("a failed lookup is a skip, never a throw", async () => {
    const r = await skip("storm:meteoalarm:2.49.0.0.276:1", { alertThrows: true });
    expect("skipped" in r && r.skipped).toMatch(/^lookup failed/);
  });
});

describe("resolveClip — applying the clip", () => {
  it("maxStops N keeps the first N tour stops", async () => {
    const { db } = fakeDb({ country: japanDoc });
    const s = seg(await resolveClip(db, cfg(), clip("country:japan", { maxStops: 2 }), NOW));
    expect(s.tourStops?.map((t) => t.label)).toEqual(["Japan", "Tokyo"]);
  });

  it("maxStops 0 removes the tour (one framed view)", async () => {
    const { db } = fakeDb({ country: japanDoc });
    const s = seg(await resolveClip(db, cfg(), clip("country:japan", { maxStops: 0 }), NOW));
    expect(s.tourStops).toBeUndefined();
    expect("tourStops" in s).toBe(false);
    // The builder captioned it a tour; it airs as one framed view now.
    expect(s.subtitle).toBe("Country spotlight · National weather");
  });

  it("a kept tour keeps the tour subtitle", async () => {
    const { db } = fakeDb({ country: japanDoc });
    const s = seg(await resolveClip(db, cfg(), clip("country:japan", { maxStops: 2 }), NOW));
    expect(s.subtitle).toBe("Country tour · National weather");
  });

  it("copies tourDwellMs onto the segment; absent leaves the client's default", async () => {
    const { db } = fakeDb({ country: japanDoc });
    expect(seg(await resolveClip(db, cfg(), clip("country:japan", { maxStops: 3, tourDwellMs: 9_000 }), NOW)).tourDwellMs).toBe(9_000);
    expect("tourDwellMs" in seg(await resolveClip(db, cfg(), clip("country:japan"), NOW))).toBe(false);
  });

  it("no maxStops keeps the whole tour", async () => {
    const { db } = fakeDb({ country: japanDoc });
    const s = seg(await resolveClip(db, cfg(), clip("country:japan"), NOW));
    expect(s.tourStops).toHaveLength(4);
  });

  it("copies leadSlide onto the segment", async () => {
    const { db } = fakeDb();
    expect(seg(await resolveClip(db, cfg(), clip("country:japan", { leadSlide: "roundup" }), NOW)).leadSlide).toBe("roundup");
    expect(seg(await resolveClip(db, cfg(), clip("country:japan"), NOW)).leadSlide).toBeUndefined();
  });

  it("layers the clip's look over the kind's look, reaching the patch", async () => {
    const { db } = fakeDb({ quake: quakeDoc() });
    const base = cfg({ kindLooks: { quake: { basemap: "dark", activeVariable: "gust" } } });
    const s = seg(await resolveClip(db, base, clip("quake:us7000abcd", { look: { basemap: "satellite", wind: { opacity: 0.4 } } }), NOW));
    expect(s.patch.basemap).toBe("satellite");
    expect(s.patch.activeVariable).toBe("gust"); // the kind's look still applies under the clip's
    expect(s.patch.wind?.opacity).toBe(0.4);
    // The scene config itself is untouched.
    expect(base.kindLooks.quake).toEqual({ basemap: "dark", activeVariable: "gust" });
  });

  it("without a clip look the kind's look applies as on the auto director", async () => {
    const { db } = fakeDb({ quake: quakeDoc() });
    const s = seg(await resolveClip(db, cfg({ kindLooks: { quake: { basemap: "dark" } } }), clip("quake:us7000abcd"), NOW));
    expect(s.patch.basemap).toBe("dark");
  });

  it("returns a fresh segment (and patch) every time", async () => {
    const { db } = fakeDb({ country: japanDoc });
    const a = seg(await resolveClip(db, cfg(), clip("country:japan"), NOW));
    const b = seg(await resolveClip(db, cfg(), clip("country:japan"), NOW));
    expect(a).not.toBe(b);
    expect(a.patch).not.toBe(b.patch);
    a.patch.spinEpoch = 1;
    expect(b.patch.spinEpoch).toBeUndefined();
  });
});

describe("refreshClipLabel", () => {
  it("takes title, subtitle and icon from the segment, omitting empties", async () => {
    const { db } = fakeDb({ volcano: volcanoDoc() });
    const s = seg(await resolveClip(db, cfg(), clip("volcano:gvp:211060"), NOW));
    expect(refreshClipLabel(s)).toEqual({ title: s.title, subtitle: s.subtitle, icon: s.icon });
    expect(refreshClipLabel({ ...s, subtitle: undefined, icon: undefined })).toEqual({ title: s.title });
  });
});
