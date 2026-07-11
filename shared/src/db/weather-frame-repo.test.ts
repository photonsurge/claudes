import { frameShouldReplace, makeWeatherFrameRepo } from "./weather-frame-repo";
import type { BlobStore } from "./blob-store";

describe("frameShouldReplace", () => {
  it("lets a lower forecast hour (fresher analysis) replace a higher one", () => {
    expect(frameShouldReplace(3, 0)).toBe(true);
    expect(frameShouldReplace(0, 3)).toBe(false);
  });

  it("refreshes in place on equal fhr (re-bakes)", () => {
    expect(frameShouldReplace(0, 0)).toBe(true);
    expect(frameShouldReplace(3, 3)).toBe(true);
  });
});

/** Chainable query stub: any of `.select()/.sort()` then `.lean()` → `result`. */
function chain<T>(result: T) {
  const c: Record<string, unknown> = {
    select: () => c,
    sort: () => c,
    lean: () => Promise.resolve(result),
  };
  return c;
}

function blobStub(over: Partial<BlobStore> = {}): BlobStore {
  return {
    model: {} as never,
    put: jest.fn().mockResolvedValue(undefined),
    get: jest.fn().mockResolvedValue(null),
    getMany: jest.fn().mockResolvedValue(new Map()),
    delete: jest.fn().mockResolvedValue(undefined),
    ...over,
  } as BlobStore;
}

const baseFrame = {
  model: "gfs",
  variable: "temp",
  validTime: new Date("2026-07-01T00:00:00Z"),
  run: new Date("2026-07-01T00:00:00Z"),
  fhr: 0,
  encoding: "scalar" as const,
  units: "°C",
  bounds: [-180, -90, 180, 90],
  grid: { width: 2, height: 2, res: 10 },
  contentType: "image/png" as const,
  byteSize: 4,
  data: Buffer.from("PNG"),
};

describe("weatherFrame blob split", () => {
  it("upsert writes metadata WITHOUT bytes and pushes bytes to the sidecar", async () => {
    const updateOne = jest.fn().mockResolvedValue({});
    const model = { findOne: () => chain(null), updateOne };
    const put = jest.fn().mockResolvedValue(undefined);
    const repo = makeWeatherFrameRepo(model as never, blobStub({ put }));

    const res = await repo.upsert(baseFrame);
    expect(res.written).toBe(true);

    const [, update] = updateOne.mock.calls[0];
    expect(update.$set).not.toHaveProperty("data"); // bytes never inline
    expect(update.$unset).toEqual({ data: "" }); // legacy inline copy dropped
    expect(update.$set.variable).toBe("temp");
    // bytes go to the sidecar under the freshly-minted id
    const [refId, bytes] = put.mock.calls[0];
    expect(update.$setOnInsert.id).toBe(refId);
    expect(bytes.toString()).toBe("PNG");
  });

  it("upsert reuses the existing id and skips when a fresher fhr is stored", async () => {
    const updateOne = jest.fn().mockResolvedValue({});
    const put = jest.fn().mockResolvedValue(undefined);
    const model = { findOne: () => chain({ id: "keep", fhr: 0 }), updateOne };
    const repo = makeWeatherFrameRepo(model as never, blobStub({ put }));

    // incoming fhr 6 > stored 0 → not fresher → skipped, no writes
    const res = await repo.upsert({ ...baseFrame, fhr: 6 });
    expect(res.written).toBe(false);
    expect(updateOne).not.toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
  });

  it("getByID rejoins sidecar bytes", async () => {
    const model = { findOne: () => chain({ id: "x", variable: "temp" }) };
    const get = jest.fn().mockResolvedValue(Buffer.from("SIDE"));
    const repo = makeWeatherFrameRepo(model as never, blobStub({ get }));
    const frame = await repo.getByID("x");
    expect(frame!.data.toString()).toBe("SIDE");
  });

  it("getByID falls back to legacy inline bytes when the sidecar is empty", async () => {
    const model = { findOne: () => chain({ id: "x", variable: "temp", data: Buffer.from("INLINE") }) };
    const repo = makeWeatherFrameRepo(model as never, blobStub({ get: jest.fn().mockResolvedValue(null) }));
    const frame = await repo.getByID("x");
    expect(frame!.data.toString()).toBe("INLINE");
  });

  it("getByID returns null when the frame has no bytes anywhere", async () => {
    const model = { findOne: () => chain({ id: "x", variable: "temp" }) };
    const repo = makeWeatherFrameRepo(model as never, blobStub());
    expect(await repo.getByID("x")).toBeNull();
  });

  it("getSeries rejoins bytes and drops frames whose bytes are gone", async () => {
    const model = {
      find: () =>
        chain([
          { id: "a", variable: "temp" },
          { id: "b", variable: "temp" }, // bytes missing → dropped
        ]),
    };
    const getMany = jest.fn().mockResolvedValue(new Map([["a", Buffer.from("A")]]));
    const repo = makeWeatherFrameRepo(model as never, blobStub({ getMany }));
    const series = await repo.getSeries({ variable: "temp" });
    expect(series.map((f) => f.id)).toEqual(["a"]);
    expect(series[0].data.toString()).toBe("A");
  });

  it("pruneOlderThan deletes the sidecar bytes for the stale ids too", async () => {
    const deleteMany = jest.fn().mockResolvedValue({ deletedCount: 2 });
    const model = { find: () => chain([{ id: "a" }, { id: "b" }]), deleteMany };
    const del = jest.fn().mockResolvedValue(undefined);
    const repo = makeWeatherFrameRepo(model as never, blobStub({ delete: del }));
    const n = await repo.pruneOlderThan(new Date());
    expect(del).toHaveBeenCalledWith(["a", "b"]);
    expect(n).toBe(2);
  });
});
