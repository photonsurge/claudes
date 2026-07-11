/** @jest-environment node */
const mockGetFocusBundle = jest.fn();
const mockCacheGet = jest.fn();
const mockCacheSet = jest.fn();

jest.mock("../../../lib/focus/getFocusBundle", () => ({
  getFocusBundle: (...args: unknown[]) => mockGetFocusBundle(...args),
}));
jest.mock("../../../lib/focus/focus-cache", () => ({
  focusCache: {
    get: (...args: unknown[]) => mockCacheGet(...args),
    set: (...args: unknown[]) => mockCacheSet(...args),
  },
}));

import { GET } from "./route";

const URL_BASE = "http://localhost/api/focus";
const okParams = "kind=quake&lng=12.34&lat=56.78&zoom=4.5&subject=us7000abcd";

describe("GET /api/focus", () => {
  beforeEach(() => {
    mockGetFocusBundle.mockReset();
    mockCacheGet.mockReset();
    mockCacheSet.mockReset();
  });

  it("400s when required params are missing", async () => {
    const res = await GET(new Request(`${URL_BASE}?kind=quake`));
    expect(res.status).toBe(400);
    expect(mockGetFocusBundle).not.toHaveBeenCalled();
  });

  it("cache miss: composes, writes to cache, marks X-Focus-Cache: miss", async () => {
    mockCacheGet.mockResolvedValue(null);
    mockGetFocusBundle.mockResolvedValue({ key: "focus:v1:...", kind: "quake" });
    mockCacheSet.mockResolvedValue(undefined);

    const res = await GET(new Request(`${URL_BASE}?${okParams}`));
    expect(res.headers.get("X-Focus-Cache")).toBe("miss");
    expect(res.headers.get("Cache-Control")).toContain("max-age=60");
    expect(mockGetFocusBundle).toHaveBeenCalledTimes(1);
    expect(mockCacheSet).toHaveBeenCalledTimes(1);
    // written under the canonical key with a 60s ttl
    expect(mockCacheSet.mock.calls[0][2]).toBe(60);
    await expect(res.json()).resolves.toEqual({ key: "focus:v1:...", kind: "quake" });
  });

  it("cache hit: skips compose entirely, marks X-Focus-Cache: hit", async () => {
    mockCacheGet.mockResolvedValue({ key: "cached", kind: "quake" });

    const res = await GET(new Request(`${URL_BASE}?${okParams}`));
    expect(res.headers.get("X-Focus-Cache")).toBe("hit");
    expect(mockGetFocusBundle).not.toHaveBeenCalled();
    expect(mockCacheSet).not.toHaveBeenCalled();
    await expect(res.json()).resolves.toEqual({ key: "cached", kind: "quake" });
  });

  it("defaults invalid detail to broadcast (folded into the cache key)", async () => {
    mockCacheGet.mockResolvedValue(null);
    mockGetFocusBundle.mockResolvedValue({ ok: true });
    await GET(new Request(`${URL_BASE}?${okParams}&detail=bogus`));
    expect(mockGetFocusBundle.mock.calls[0][0].detail).toBe("broadcast");
  });
});
