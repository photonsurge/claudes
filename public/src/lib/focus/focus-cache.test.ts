const mockRedis = {
  get: jest.fn(),
  set: jest.fn(),
};

jest.mock("@photonsurge/shared/bull/bull", () => ({
  getQueue: () => ({ client: Promise.resolve(mockRedis) }),
}));

import { get, set } from "./focus-cache";

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
