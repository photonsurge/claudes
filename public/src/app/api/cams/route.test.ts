/** @jest-environment node */

/**
 * GET /api/cams — the broadcast's webcam read.
 *
 * The regression worth pinning: a point query must go to the repo's $geoNear
 * with the panel's radius and a bounded limit, never to the full-catalog list.
 * The full list is 68 MB of JSON (the whole Windy catalog) and was, until round
 * 46, what every /watch page load downloaded and parsed on the main thread.
 */
const mockNearMany = jest.fn();
const mockList = jest.fn();

jest.mock("@photonsurge/shared/db/index", () => ({
  getAppDb: async () => ({
    cams: {
      nearMany: (...a: unknown[]) => mockNearMany(...a),
      list: (...a: unknown[]) => mockList(...a),
    },
  }),
}));
jest.mock("../../../lib/focus/focus-cache", () => ({
  FEED_TTL_SEC: 60,
  withCache: async (_k: string, _t: number, fn: () => Promise<unknown>) => ({ value: await fn(), hit: false }),
}));
jest.mock("../../../lib/api-log", () => ({ withApiLog: (h: unknown) => h }));

import { GET, DEFAULT_LIMIT, DEFAULT_MAX_KM, MAX_LIMIT, MAX_MAX_KM } from "./route";

const cam = (camId: string) => ({ camId, provider: "windy", title: camId, lat: 51.5, lng: -0.1, status: "active" });
const get = async (qs: string) => {
  const res = await GET(new Request(`http://localhost/api/cams${qs}`));
  return { status: res.status, body: await res.json() };
};

beforeEach(() => {
  mockNearMany.mockReset();
  mockList.mockReset();
  mockNearMany.mockResolvedValue([
    { cam: cam("a"), distanceKm: 3 },
    { cam: cam("b"), distanceKm: 40 },
  ]);
  mockList.mockResolvedValue([cam("x")]);
});

describe("GET /api/cams", () => {
  it("a point query reads the nearest active cams with the panel's radius and a bounded limit", async () => {
    const { status, body } = await get("?lng=-0.1&lat=51.5");
    expect(status).toBe(200);
    expect(mockNearMany).toHaveBeenCalledWith({ lng: -0.1, lat: 51.5, maxKm: DEFAULT_MAX_KM, limit: DEFAULT_LIMIT, status: "active" });
    expect(mockList).not.toHaveBeenCalled();
    expect(body.cams.map((c: { camId: string }) => c.camId)).toEqual(["a", "b"]); // unwrapped, nearest first
    expect(body.count).toBe(2);
    expect(body.center).toEqual([-0.1, 51.5]);
  });

  it("clamps radius and limit, and falls back to the defaults for junk", async () => {
    await get("?lng=0&lat=0&maxKm=99999&limit=99999");
    expect(mockNearMany).toHaveBeenLastCalledWith(expect.objectContaining({ maxKm: MAX_MAX_KM, limit: MAX_LIMIT }));
    await get("?lng=0&lat=0&maxKm=0&limit=abc");
    expect(mockNearMany).toHaveBeenLastCalledWith(expect.objectContaining({ maxKm: DEFAULT_MAX_KM, limit: DEFAULT_LIMIT }));
  });

  it("rejects a malformed point instead of silently serving the whole catalog", async () => {
    for (const qs of ["?lng=abc&lat=51.5", "?lng=-0.1", "?lng=200&lat=0", "?lng=0&lat=-91"]) {
      const { status, body } = await get(qs);
      expect(status).toBe(400);
      expect(body.cams).toEqual([]);
    }
    expect(mockNearMany).not.toHaveBeenCalled();
    expect(mockList).not.toHaveBeenCalled();
  });

  it("no point: the full active catalog (tooling only)", async () => {
    const { status, body } = await get("");
    expect(status).toBe(200);
    expect(mockList).toHaveBeenCalledWith({ status: "active" });
    expect(body.count).toBe(1);
  });

  it("a failing read is a 502 with an empty list, not a crash", async () => {
    mockNearMany.mockRejectedValueOnce(new Error("mongo down"));
    const { status, body } = await get("?lng=0&lat=0");
    expect(status).toBe(502);
    expect(body.cams).toEqual([]);
  });
});
