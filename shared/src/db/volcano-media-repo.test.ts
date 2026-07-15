import type { Model } from "mongoose";
import { makeVolcanoMediaRepo } from "./volcano-media-repo";
import type { iVolcanoMediaModel } from "./volcano-media-model";
import type { InlineBlobStore } from "./inline-blob";

const bytes = Buffer.from("frame-one");
const other = Buffer.from("frame-two");

const input = {
  volcanoId: "gvp:211060",
  source: "INGV" as const,
  type: "WEBCAM" as const,
  cameraId: "cam-etna-summit",
  sourceUrl: "https://example.test/etna",
  bytes,
};

const makeBlobs = () => ({
  fs: {} as any,
  ns: "volcano-media",
  get: jest.fn(async () => null),
  put: jest.fn(async () => {}),
  delete: jest.fn(async () => {}),
  inlineValue: jest.fn(() => undefined),
}) satisfies InlineBlobStore & Record<string, unknown>;

describe("volcanoMedia.putLatest", () => {
  it("creates a row when the camera has no frame yet", async () => {
    const blobs = makeBlobs();
    const create = jest.fn(async (..._a: any[]) => ({}));
    const findOne = jest.fn((..._a: any[]) => ({ lean: () => ({ exec: async () => null }) }));
    const repo = makeVolcanoMediaRepo({ create, findOne } as unknown as Model<iVolcanoMediaModel>, blobs);

    const { id, changed } = await repo.putLatest(input);

    expect(changed).toBe(true);
    expect(findOne.mock.calls[0][0]).toEqual({ cameraId: "cam-etna-summit", type: "WEBCAM" });
    expect(blobs.put).toHaveBeenCalledWith(id, bytes);
    expect(create.mock.calls[0][0]).toMatchObject({ id, assetRef: id, contentHash: expect.any(String) });
  });

  it("overwrites the SAME row and blob on a new frame — no archive, no orphan", async () => {
    const blobs = makeBlobs();
    const updateOne = jest.fn((..._a: any[]) => ({ exec: async () => ({}) }));
    const findOne = jest.fn((..._a: any[]) => ({ lean: () => ({ exec: async () => ({ id: "media-1", contentHash: "old" }) }) }));
    const create = jest.fn();
    const repo = makeVolcanoMediaRepo({ create, findOne, updateOne } as unknown as Model<iVolcanoMediaModel>, blobs);

    const { id, changed } = await repo.putLatest({ ...input, bytes: other });

    expect(changed).toBe(true);
    expect(id).toBe("media-1"); // stable id => /api/volcanoes/media/:id never breaks
    expect(create).not.toHaveBeenCalled();
    // Same blob key: the bytes are replaced rather than a second copy written.
    expect(blobs.put).toHaveBeenCalledWith("media-1", other);
    expect(blobs.delete).not.toHaveBeenCalled();
    expect(updateOne.mock.calls[0][0]).toEqual({ id: "media-1" });
  });

  it("an identical frame only touches acquiredAt — bytes are not rewritten", async () => {
    const blobs = makeBlobs();
    const updateOne = jest.fn((..._a: any[]) => ({ exec: async () => ({}) }));
    const repo0 = makeVolcanoMediaRepo(
      { findOne: () => ({ lean: () => ({ exec: async () => null }) }), create: async () => ({}) } as unknown as Model<iVolcanoMediaModel>,
      makeBlobs(),
    );
    // Derive the hash the repo itself computes for these bytes.
    await repo0.putLatest(input);

    const { createHash } = await import("node:crypto");
    const hash = createHash("sha256").update(bytes).digest("hex");
    const findOne = jest.fn((..._a: any[]) => ({ lean: () => ({ exec: async () => ({ id: "media-1", contentHash: hash }) }) }));
    const repo = makeVolcanoMediaRepo({ findOne, updateOne } as unknown as Model<iVolcanoMediaModel>, blobs);

    const { id, changed } = await repo.putLatest(input);

    expect(changed).toBe(false);
    expect(id).toBe("media-1");
    expect(blobs.put).not.toHaveBeenCalled();
    expect(Object.keys((updateOne.mock.calls[0] as any[])[1].$set)).toEqual(["acquiredAt"]);
  });
});

describe("volcanoMedia.pruneToLatestPerCamera", () => {
  const groups = [
    { _id: { cameraId: "cam-a", type: "WEBCAM" }, keep: "a1", ids: ["a1", "a2", "a3"] },
    { _id: { cameraId: "cam-b", type: "WEBCAM" }, keep: "b1", ids: ["b1"] },
  ];

  it("deletes superseded rows AND their blobs, keeping the newest per camera", async () => {
    const blobs = makeBlobs();
    const deleteMany = jest.fn((..._a: any[]) => ({ exec: async () => ({}) }));
    const aggregate = jest.fn((..._a: any[]) => ({ exec: async () => groups }));
    const repo = makeVolcanoMediaRepo({ aggregate, deleteMany } as unknown as Model<iVolcanoMediaModel>, blobs);

    const res = await repo.pruneToLatestPerCamera();

    expect(res).toEqual({ removed: 2, kept: 2 });
    expect(blobs.delete).toHaveBeenCalledWith(["a2", "a3"]);
    expect(deleteMany.mock.calls[0][0]).toEqual({ id: { $in: ["a2", "a3"] } });
  });

  it("dryRun reports without deleting anything", async () => {
    const blobs = makeBlobs();
    const deleteMany = jest.fn();
    const repo = makeVolcanoMediaRepo(
      { aggregate: () => ({ exec: async () => groups }), deleteMany } as unknown as Model<iVolcanoMediaModel>,
      blobs,
    );

    expect(await repo.pruneToLatestPerCamera({ dryRun: true })).toEqual({ removed: 2, kept: 2 });
    expect(deleteMany).not.toHaveBeenCalled();
    expect(blobs.delete).not.toHaveBeenCalled();
  });

  it("is idempotent — a already-collapsed archive deletes nothing", async () => {
    const blobs = makeBlobs();
    const deleteMany = jest.fn();
    const repo = makeVolcanoMediaRepo(
      { aggregate: () => ({ exec: async () => [{ _id: { cameraId: "cam-b", type: "WEBCAM" }, keep: "b1", ids: ["b1"] }] }), deleteMany } as unknown as Model<iVolcanoMediaModel>,
      blobs,
    );

    expect(await repo.pruneToLatestPerCamera()).toEqual({ removed: 0, kept: 1 });
    expect(deleteMany).not.toHaveBeenCalled();
  });
});
