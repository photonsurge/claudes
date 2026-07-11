const mockRedis = {
  get: jest.fn(),
  set: jest.fn(),
};

jest.mock("@photonsurge/shared/bull/bull", () => ({
  getQueue: () => ({ client: Promise.resolve(mockRedis) }),
}));

import { get, set, withCache } from "./focus-cache";

describe("focus-cache", () => {
  beforeEach(() => {
    mockRedis.get.mockReset();
    mockRedis.set.mockReset();
  });

  it("round-trips a value as JSON", async () => {
    const value = { hello: "world", n: 1 };
    mockRedis.get.mockResolvedValue(JSON.stringify(value));
    await expect(get("k")).resolves.toEqual(value);
  });

  it("returns null on a miss", async () => {
    mockRedis.get.mockResolvedValue(null);
    await expect(get("k")).resolves.toBeNull();
  });

  it("writes with an EX ttl (self-evicting, no unbounded growth)", async () => {
    mockRedis.set.mockResolvedValue("OK");
    await set("k", { a: 1 }, 60);
    expect(mockRedis.set).toHaveBeenCalledWith("k", JSON.stringify({ a: 1 }), "EX", 60);
  });

  it("fails open: a thrown client is a miss on get", async () => {
    mockRedis.get.mockRejectedValue(new Error("redis down"));
    await expect(get("k")).resolves.toBeNull();
  });

  it("fails open: a thrown client is a no-op on set", async () => {
    mockRedis.set.mockRejectedValue(new Error("redis down"));
    await expect(set("k", { a: 1 }, 60)).resolves.toBeUndefined();
  });
});

describe("withCache (feed read-through)", () => {
  beforeEach(() => {
    mockRedis.get.mockReset();
    mockRedis.set.mockReset();
  });

  it("serves a hit without running compute", async () => {
    const cached = { alerts: [1, 2], count: 2 };
    mockRedis.get.mockResolvedValue(JSON.stringify(cached));
    const compute = jest.fn();
    const { value, hit } = await withCache("feed:v1:alerts:x", 30, compute);
    expect(value).toEqual(cached);
    expect(hit).toBe(true);
    expect(compute).not.toHaveBeenCalled();
  });

  it("computes + caches (EX ttl) on a miss", async () => {
    mockRedis.get.mockResolvedValue(null);
    mockRedis.set.mockResolvedValue("OK");
    const fresh = { count: 1, quakes: [{ id: "a" }] };
    const { value, hit } = await withCache("feed:v1:quakes:y", 30, async () => fresh);
    expect(value).toEqual(fresh);
    expect(hit).toBe(false);
    expect(mockRedis.set).toHaveBeenCalledWith("feed:v1:quakes:y", JSON.stringify(fresh), "EX", 30);
  });

  it("fails open: a Redis outage still returns computed data (degrades to live)", async () => {
    mockRedis.get.mockRejectedValue(new Error("redis down"));
    mockRedis.set.mockRejectedValue(new Error("redis down"));
    const fresh = { count: 0, volcanoes: [] };
    const { value, hit } = await withCache("feed:v1:volcanoes:z", 30, async () => fresh);
    expect(value).toEqual(fresh);
    expect(hit).toBe(false);
  });

  it("propagates a compute error (route keeps its own error handling) and caches nothing", async () => {
    mockRedis.get.mockResolvedValue(null);
    await expect(
      withCache("feed:v1:alerts:err", 30, async () => {
        throw new Error("mongo down");
      }),
    ).rejects.toThrow("mongo down");
    expect(mockRedis.set).not.toHaveBeenCalled();
  });
});
