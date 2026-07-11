import { makeBlobStore } from "./blob-store";

/** Minimal chainable query stub: `.select().lean()` resolves to `result`. */
function q<T>(result: T) {
  const p: Record<string, unknown> = {
    select: () => p,
    lean: () => Promise.resolve(result),
  };
  return p;
}

describe("makeBlobStore", () => {
  it("get returns the bytes, or null on miss", async () => {
    const model = {
      findOne: jest
        .fn()
        .mockReturnValueOnce(q({ data: Buffer.from("hi") }))
        .mockReturnValueOnce(q(null)),
    };
    const blobs = makeBlobStore(model as never);
    expect((await blobs.get("a"))?.toString()).toBe("hi");
    expect(await blobs.get("missing")).toBeNull();
  });

  it("getMany keys the bytes by refId and short-circuits on empty", async () => {
    const find = jest.fn(() =>
      q([
        { refId: "a", data: Buffer.from("A") },
        { refId: "b", data: Buffer.from("B") },
      ]),
    );
    const blobs = makeBlobStore({ find } as never);
    const map = await blobs.getMany(["a", "b"]);
    expect(map.get("a")?.toString()).toBe("A");
    expect(map.get("b")?.toString()).toBe("B");

    expect((await blobs.getMany([])).size).toBe(0);
    expect(find).toHaveBeenCalledTimes(1); // empty input never queried
  });

  it("put upserts by refId", async () => {
    const updateOne = jest.fn().mockResolvedValue({});
    const blobs = makeBlobStore({ updateOne } as never);
    await blobs.put("a", Buffer.from("x"));
    expect(updateOne).toHaveBeenCalledWith(
      { refId: "a" },
      { $set: { data: expect.any(Buffer) } },
      { upsert: true },
    );
  });

  it("delete is a no-op on empty input", async () => {
    const deleteMany = jest.fn().mockResolvedValue({});
    const blobs = makeBlobStore({ deleteMany } as never);
    await blobs.delete([]);
    expect(deleteMany).not.toHaveBeenCalled();
    await blobs.delete(["a"]);
    expect(deleteMany).toHaveBeenCalledWith({ refId: { $in: ["a"] } });
  });
});
