/** @jest-environment node */

/**
 * GET /api/alerts/blobs — the globe overlay's feed.
 *
 * The regressions worth pinning: it must never read a member's polygon (that
 * would undo the CPU the worker spent fusing them and was a hard OOM once), it
 * must stay on ONE cache key (a filter param would fragment the shared entry),
 * and a failure must hand back an empty list rather than throw at the globe.
 */
const mockList = jest.fn();
const mockAlertFind = jest.fn();

jest.mock("@photonsurge/shared/db/index", () => ({
  getAppDb: async () => ({
    alertBlobs: { list: () => mockList() },
    alerts: { model: { find: (...a: unknown[]) => mockAlertFind(...a) } },
  }),
}));
// Pass-through cache: exercise the composer, but record the key it was given.
const cacheKeys: string[] = [];
jest.mock("../../../../lib/focus/focus-cache", () => ({
  FEED_TTL_SEC: 60,
  withCache: (key: string, _ttl: number, fn: () => Promise<unknown>) => {
    cacheKeys.push(key);
    return fn();
  },
}));
jest.mock("@photonsurge/shared/geo/simplify", () => ({
  simplifyGeometry: (g: unknown) => g,
}));
jest.mock("../../../../lib/api-log", () => ({ withApiLog: (h: unknown) => h }));

import { GET } from "./route";

const blob = (over: Record<string, unknown> = {}) => ({
  id: "blob-1",
  hazard: "heat",
  severityRank: 4,
  geometry: { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] },
  bbox: [0, 0, 1, 1],
  memberIds: ["a1", "a2"],
  cities: [{ id: "c1", name: "Sevilla", lat: 37, lng: -6, population: 700_000 }],
  ...over,
});

const member = (id: string, sent: string, over: Record<string, unknown> = {}) => ({
  id,
  source: "meteoalarm",
  identifier: `2.49.0.0.${id}`,
  sent,
  info: [{ event: "Red High-temperature Warning", severity: "Extreme", headline: `head-${id}`, area: [{ areaDesc: "Puglia" }] }],
  ...over,
});

const chain = (rows: unknown[]) => ({ lean: () => ({ exec: async () => rows }) });
const get = () => GET(new Request("http://localhost/api/alerts/blobs") as never);

beforeEach(() => {
  jest.clearAllMocks();
  cacheKeys.length = 0;
  mockAlertFind.mockReturnValue(chain([]));
});

describe("GET /api/alerts/blobs", () => {
  it("returns the dissolved shape as a drawable feature", async () => {
    mockList.mockResolvedValue({ blobs: [blob()] });
    mockAlertFind.mockReturnValue(chain([member("a1", "2026-07-15T10:00:00Z")]));

    const body = await (await get()).json();

    expect(body.count).toBe(1);
    expect(body.features[0]).toMatchObject({
      type: "Feature",
      geometry: { type: "Polygon" },
      // The layer reads exactly these two to colour a shape.
      properties: { hazard: "heat", severityRank: 4 },
    });
  });

  it("NEVER reads a member's polygon", async () => {
    // The whole point of the blob is that public doesn't touch the source
    // geometry; pulling it back to read a headline was a hard OOM.
    mockList.mockResolvedValue({ blobs: [blob()] });

    await get();

    const projection = mockAlertFind.mock.calls[0][1];
    expect(JSON.stringify(projection)).not.toContain("geometry");
    expect(projection).toMatchObject({ "info.event": 1, "info.headline": 1 });
  });

  it("quotes the NEWEST member — the card must not show a superseded warning", async () => {
    mockList.mockResolvedValue({ blobs: [blob({ memberIds: ["old", "new"] })] });
    mockAlertFind.mockReturnValue(
      chain([member("old", "2026-07-15T08:00:00Z"), member("new", "2026-07-15T14:00:00Z")]),
    );

    const body = await (await get()).json();

    // Clicking the shape opens the newest warning's card.
    expect(body.features[0].properties.id).toBe("new");
    expect(body.features[0].properties.headline).toBe("head-new");
  });

  it("says how many warnings the shape stands for", async () => {
    mockList.mockResolvedValue({ blobs: [blob({ memberIds: ["a1", "a2", "a3"] })] });

    const body = await (await get()).json();

    expect(body.features[0].properties.memberCount).toBe(3);
  });

  it("does not ship the blob's cities — this feed draws, it doesn't caption", async () => {
    // Spain's heat blob alone covers ~1,000 cities; no pixel needs them, and
    // focus already answers "who's under this" per cut, with conditions.
    mockList.mockResolvedValue({ blobs: [blob()] });

    const body = await (await get()).json();

    expect(body.features[0].properties.cities).toBeUndefined();
  });

  it("stays on ONE cache key so every caller shares the entry", async () => {
    mockList.mockResolvedValue({ blobs: [] });

    await GET(new Request("http://localhost/api/alerts/blobs?severityMin=3") as never);

    // A filter param here would fragment the shared Redis entry per combination;
    // the operator's floor is applied client-side from warm data instead.
    expect(cacheKeys).toEqual(["feed:v1:alert-blobs"]);
  });

  it("asks for every member once, not once per blob", async () => {
    mockList.mockResolvedValue({
      blobs: [blob({ id: "b1", memberIds: ["a1", "a2"] }), blob({ id: "b2", memberIds: ["a2", "a3"] })],
    });

    await get();

    expect(mockAlertFind).toHaveBeenCalledTimes(1);
    expect(mockAlertFind.mock.calls[0][0]).toEqual({ id: { $in: ["a1", "a2", "a3"] } });
  });

  it("skips a blob whose geometry won't simplify rather than emitting a broken feature", async () => {
    jest.isolateModules(() => {});
    mockList.mockResolvedValue({ blobs: [blob()] });
    const simplify = jest.requireMock("@photonsurge/shared/geo/simplify") as { simplifyGeometry: jest.Mock };
    const original = simplify.simplifyGeometry;
    simplify.simplifyGeometry = jest.fn().mockReturnValue(null);

    const body = await (await get()).json();

    expect(body.features).toEqual([]);
    simplify.simplifyGeometry = original;
  });

  it("still draws a shape whose members have vanished", async () => {
    // Members expire between the rebuild and the read; the shape is still the
    // best thing we have, and a missing headline must not drop it off the globe.
    mockList.mockResolvedValue({ blobs: [blob()] });
    mockAlertFind.mockReturnValue(chain([]));

    const body = await (await get()).json();

    expect(body.features).toHaveLength(1);
    expect(body.features[0].properties.hazard).toBe("heat");
  });

  it("hands back an empty list instead of throwing at the globe", async () => {
    mockList.mockRejectedValue(new Error("mongo down"));

    const res = await get();

    expect(res.status).toBe(200);
    expect((await res.json()).features).toEqual([]);
  });
});
