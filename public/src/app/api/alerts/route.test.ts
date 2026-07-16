/** @jest-environment node */

/**
 * GET /api/alerts — the whole-planet feed.
 *
 * The regression worth pinning: `omitCoordinates` must answer "where is this
 * alert" BEFORE it throws the polygon away. World Watch asks the geometry exactly
 * one question (which continent), and the polygons are ~60% of a 19.9MB payload —
 * so the flag only became usable here once the route shipped a rep point instead.
 * Strip without it and nothing throws; the continent breakdown just empties.
 */
const mockList = jest.fn();

jest.mock("@photonsurge/shared/db/index", () => ({
  getAppDb: async () => ({ alerts: { list: (...a: unknown[]) => mockList(...a) } }),
}));
jest.mock("../../../lib/focus/focus-cache", () => ({
  FEED_TTL_SEC: 60,
  withCache: async (_k: string, _t: number, fn: () => Promise<unknown>) => ({ value: await fn(), hit: false }),
}));
jest.mock("@photonsurge/shared/geo/simplify", () => ({ simplifyGeometry: (g: unknown) => g }));
jest.mock("../../../lib/alertGroups", () => ({ groupAlerts: () => [] }));
jest.mock("../../../lib/api-log", () => ({ withApiLog: (h: unknown) => h }));

import { GET } from "./route";

const spain = () => ({
  id: "a1",
  source: "meteoalarm",
  identifier: "cap-1",
  maxSeverityRank: 3,
  info: [
    {
      event: "Storm",
      area: [
        {
          areaDesc: "Madrid",
          geometry: { type: "Polygon", coordinates: [[[-3, 40], [-2, 40], [-2, 41], [-3, 40]]] },
        },
      ],
    },
  ],
});

const get = async (qs: string) => {
  const res = await GET(new Request(`http://x/api/alerts?${qs}`) as never);
  return (await res.json()).alerts[0];
};

describe("GET /api/alerts — omitCoordinates", () => {
  // A FRESH doc per call: the route strips geometry in place, so one shared
  // fixture would let the first test's mutation leak into the next.
  beforeEach(() => mockList.mockReset().mockImplementation(async () => [spain()]));

  it("answers 'where' with a repPoint before dropping the rings", async () => {
    const a = await get("active=1&omitCoordinates=1");

    // The ring's centroid, not its first vertex — same rule alertRepPoint applies
    // client-side, so an alert lands on one continent whichever feed asked.
    expect(a.repPoint).toEqual([-2.5, 40.25]);
    // ...and the ring itself is gone.
    expect(a.info[0].area[0].geometry).toEqual({ type: "Polygon" });
  });

  it("sends no repPoint on the full-geometry feed — the shape is already there", async () => {
    const a = await get("active=1");

    expect(a.repPoint).toBeUndefined();
    expect(a.info[0].area[0].geometry.coordinates).toBeDefined();
  });

  it("leaves repPoint undefined when the alert has no drawable shape at all", async () => {
    // Geocode-only alerts whose EMMA boundary isn't resolved yet: half of all
    // areas currently. They must not fabricate a location.
    mockList.mockImplementation(async () => [
      { id: "a2", source: "meteoalarm", identifier: "c2", maxSeverityRank: 2, info: [{ event: "Fog", area: [{ areaDesc: "Somewhere" }] }] },
    ]);

    expect((await get("active=1&omitCoordinates=1")).repPoint).toBeUndefined();
  });

  it("caches the stripped and unstripped feeds separately", async () => {
    // Same query, different payload — one cache key would serve rings to a caller
    // that asked not to have them, or vice versa.
    const res1 = await GET(new Request("http://x/api/alerts?active=1&omitCoordinates=1") as never);
    const res2 = await GET(new Request("http://x/api/alerts?active=1") as never);

    expect((await res1.json()).alerts[0].repPoint).toBeDefined();
    expect((await res2.json()).alerts[0].info[0].area[0].geometry.coordinates).toBeDefined();
  });
});
