import type { Model } from "mongoose";
import { makeAdRepo, toAd, type AdMediaInput } from "./ad-repo";
import type { iAdModel } from "./ad-model";
import { makeInlineBlobStore } from "./inline-blob";

const UUID_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A stored ad doc as `.lean()` hands it back (with Mongo bookkeeping noise). */
const adDoc = (over: Record<string, unknown> = {}): any => ({
  _id: "mongo-internal-id",
  __v: 0,
  id: "row-uuid",
  adId: "ad-1",
  title: "Sponsor spot",
  status: "active",
  mediaType: "image",
  contentType: "image/png",
  byteSize: 3,
  weight: 1,
  storage: "inline",
  timesShown: 4,
  totalDisplayMs: 60_000,
  created: new Date("2026-07-01T00:00:00Z"),
  updated: new Date("2026-07-02T00:00:00Z"),
  ...over,
});

/** Chainable query mock: find/findOne(...).select().sort().limit().lean().exec(). */
const chainOf = (result: unknown) => {
  const chain: Record<string, jest.Mock> = {};
  chain.select = jest.fn(() => chain);
  chain.sort = jest.fn(() => chain);
  chain.limit = jest.fn(() => chain);
  chain.lean = jest.fn(() => chain);
  chain.exec = jest.fn(async () => result);
  return chain;
};

const repoWith = (model: Record<string, unknown>) =>
  makeAdRepo(model as unknown as Model<iAdModel>, makeInlineBlobStore("ad", null));

describe("toAd", () => {
  it("maps a stored doc to the wire shape, dates as epoch ms", () => {
    const ad = toAd(adDoc({ tags: ["sponsor", "q3"], lastShownAt: new Date(1_750_000_000_000) }));
    expect(ad).toMatchObject({
      adId: "ad-1",
      title: "Sponsor spot",
      status: "active",
      mediaType: "image",
      contentType: "image/png",
      byteSize: 3,
      weight: 1,
      storage: "inline",
      tags: ["sponsor", "q3"],
      createdAt: Date.UTC(2026, 6, 1),
      updatedAt: Date.UTC(2026, 6, 2),
      lastShownAt: 1_750_000_000_000,
      timesShown: 4,
      totalDisplayMs: 60_000,
    });
    // The wire Ad never carries the media bytes.
    expect((ad as any).data).toBeUndefined();
  });

  it("defaults the airing tallies, and omits empty tags / never-set timestamps", () => {
    const ad = toAd(
      adDoc({
        tags: [],
        timesShown: undefined,
        totalDisplayMs: undefined,
        lastShownAt: undefined,
        created: undefined,
        updated: undefined,
      }),
    );
    expect(ad.tags).toBeUndefined();
    expect(ad.timesShown).toBe(0);
    expect(ad.totalDisplayMs).toBe(0);
    expect(ad.lastShownAt).toBeUndefined();
    expect(ad.createdAt).toBeUndefined();
    expect(ad.updatedAt).toBeUndefined();
  });

  it("reads pre-placement docs as break-only, and keeps a stored value", () => {
    expect(toAd(adDoc()).placements).toEqual(["break"]);
    expect(toAd(adDoc({ placements: [] })).placements).toEqual(["break"]);
    expect(toAd(adDoc({ placements: ["ticker"] })).placements).toEqual(["ticker"]);
  });
});

describe("makeAdRepo.create", () => {
  const input = {
    title: "Sponsor spot",
    status: "active" as const,
    weight: 2,
    placements: ["break" as const],
    mediaType: "image" as const,
    contentType: "image/png",
    byteSize: 3,
    data: Buffer.from([1, 2, 3]),
  };

  const modelFor = (readback: unknown) => {
    const chain = chainOf(readback);
    return { create: jest.fn(async () => ({})), findOne: jest.fn(() => chain), chain };
  };

  it("stores the media with a fresh UUID adId and reads back the wire shape without bytes", async () => {
    const model = modelFor(adDoc());
    const ad = await repoWith(model).create(input);
    const [stored] = model.create.mock.calls[0] as any[];
    expect(stored.adId).toMatch(UUID_RX);
    expect(stored.id).toMatch(UUID_RX);
    expect(stored.id).not.toBe(stored.adId); // row id and stable adId are separate keys
    expect(stored.storage).toBe("inline"); // default when unspecified
    expect(stored.data).toBe(input.data);
    // Readback targets the id it just generated, blob projected out.
    expect(model.findOne).toHaveBeenCalledWith({ adId: stored.adId });
    expect(model.chain.select).toHaveBeenCalledWith("-data");
    expect(ad.adId).toBe("ad-1"); // mapped from the readback doc
  });

  it("honours a caller-provided adId (trimmed), generating one only for blank input", async () => {
    const model = modelFor(adDoc());
    const repo = repoWith(model);
    await repo.create({ ...input, adId: "  sponsor-1  " });
    expect((model.create.mock.calls[0] as any[])[0].adId).toBe("sponsor-1");
    await repo.create({ ...input, adId: "   " });
    expect((model.create.mock.calls[1] as any[])[0].adId).toMatch(UUID_RX);
  });

  it("throws when the readback can't find the row it just wrote", async () => {
    const model = modelFor(null);
    await expect(repoWith(model).create(input)).rejects.toThrow("ad create: readback failed");
  });
});

describe("makeAdRepo.list", () => {
  const modelWith = (docs: unknown[]) => {
    const chain = chainOf(docs);
    return { find: jest.fn(() => chain), chain };
  };

  it("lists newest-edited first, without the media bytes, unlimited by default", async () => {
    const model = modelWith([adDoc()]);
    const [ad] = await repoWith(model).list();
    expect(model.find).toHaveBeenCalledWith({});
    expect(model.chain.select).toHaveBeenCalledWith("-data");
    expect(model.chain.sort).toHaveBeenCalledWith({ updated: -1 });
    expect(model.chain.limit).toHaveBeenCalledWith(0); // 0 = no cap
    expect(ad.adId).toBe("ad-1");
  });

  it("filters by status and by an escaped, case-insensitive title/advertiser regex", async () => {
    const model = modelWith([]);
    await repoWith(model).list({ status: "inactive", q: "ACME (50% off)?", limit: 25 });
    const [query] = model.find.mock.calls[0] as any[];
    expect(query.status).toBe("inactive");
    const [byTitle, byAdvertiser] = query.$or;
    expect(byTitle.title).toEqual(byAdvertiser.advertiser); // same rx over both fields
    const rx: RegExp = byTitle.title;
    expect(rx.flags).toBe("i");
    expect(rx.test("Big acme (50% off)? sale")).toBe(true); // literal match, case-folded
    expect(rx.test("acme 50% off")).toBe(false); // "(...)" is not a regex group
    expect(model.chain.limit).toHaveBeenCalledWith(25);
  });
});

describe("makeAdRepo.getByAdId", () => {
  it("returns the mapped ad, or null when missing", async () => {
    const found = { findOne: jest.fn(() => chainOf(adDoc())) };
    expect((await repoWith(found).getByAdId("ad-1"))?.adId).toBe("ad-1");
    expect(found.findOne).toHaveBeenCalledWith({ adId: "ad-1" });

    const missing = { findOne: jest.fn(() => chainOf(null)) };
    expect(await repoWith(missing).getByAdId("nope")).toBeNull();
  });
});

describe("makeAdRepo.getMedia — Buffer coercion", () => {
  // getMedia skips .lean(), so the mock query only needs .exec().
  const modelWith = (doc: unknown) => ({
    findOne: jest.fn(() => ({ exec: jest.fn(async () => doc) })),
  });

  it("returns the bytes + contentType + updated stamp for a Node Buffer", async () => {
    const media = await repoWith(modelWith(adDoc({ data: Buffer.from([1, 2, 3]) }))).getMedia("ad-1");
    expect(media?.data.equals(Buffer.from([1, 2, 3]))).toBe(true);
    expect(media?.contentType).toBe("image/png");
    expect(media?.updatedAt).toBe("2026-07-02T00:00:00.000Z");
  });

  it("decodes a BSON Binary ({_bsontype, buffer}) — a naive Buffer.from on the wrapper yields garbage", async () => {
    const data = { _bsontype: "Binary", buffer: new Uint8Array([9, 8, 7]) };
    const media = await repoWith(modelWith(adDoc({ data }))).getMedia("ad-1");
    expect(media?.data.equals(Buffer.from([9, 8, 7]))).toBe(true);
  });

  it("falls back to Binary.value() when the wrapper exposes no .buffer", async () => {
    const data = { _bsontype: "Binary", value: () => Buffer.from([5, 4]) };
    const media = await repoWith(modelWith(adDoc({ data }))).getMedia("ad-1");
    expect(media?.data.equals(Buffer.from([5, 4]))).toBe(true);
  });

  it("wraps a bare Uint8Array and a plain {buffer: Uint8Array} shape", async () => {
    const bare = await repoWith(modelWith(adDoc({ data: new Uint8Array([1, 2]) }))).getMedia("ad-1");
    expect(bare?.data.equals(Buffer.from([1, 2]))).toBe(true);
    const wrapped = await repoWith(modelWith(adDoc({ data: { buffer: new Uint8Array([3, 4]) } }))).getMedia("ad-1");
    expect(wrapped?.data.equals(Buffer.from([3, 4]))).toBe(true);
  });

  it("is null when the ad is missing, has no bytes, or the blob decodes empty", async () => {
    expect(await repoWith(modelWith(null)).getMedia("x")).toBeNull();
    expect(await repoWith(modelWith(adDoc({ data: undefined }))).getMedia("x")).toBeNull();
    expect(await repoWith(modelWith(adDoc({ data: Buffer.alloc(0) }))).getMedia("x")).toBeNull();
    const emptyBinary = { _bsontype: "Binary", buffer: new Uint8Array(0) };
    expect(await repoWith(modelWith(adDoc({ data: emptyBinary }))).getMedia("x")).toBeNull();
  });

  it("stamps updatedAt from `updated`, falling back to `created`", async () => {
    const doc = adDoc({ data: Buffer.from([1]), updated: undefined });
    const media = await repoWith(modelWith(doc)).getMedia("ad-1");
    expect(media?.updatedAt).toBe("2026-07-01T00:00:00.000Z");
  });
});

describe("makeAdRepo.updateMeta / setStatus / replaceMedia", () => {
  const modelWith = (doc: unknown) => {
    const chain = chainOf(doc);
    return {
      findOneAndUpdate: jest.fn(() => chain),
      findOne: jest.fn(() => chainOf(doc)),
      chain,
    };
  };

  it("$sets only the given patch fields, returning the fresh doc without bytes", async () => {
    const model = modelWith(adDoc({ title: "New title" }));
    const ad = await repoWith(model).updateMeta("ad-1", { title: "New title" });
    expect(model.findOneAndUpdate).toHaveBeenCalledWith(
      { adId: "ad-1" },
      { $set: { title: "New title" } },
      { new: true },
    );
    expect(model.chain.select).toHaveBeenCalledWith("-data");
    expect(ad?.title).toBe("New title");
  });

  it("an empty patch is a read, not a write", async () => {
    const model = modelWith(adDoc());
    const ad = await repoWith(model).updateMeta("ad-1", {});
    expect(model.findOneAndUpdate).not.toHaveBeenCalled();
    expect(model.findOne).toHaveBeenCalledWith({ adId: "ad-1" });
    expect(ad?.adId).toBe("ad-1");
  });

  it("returns null for an unknown ad", async () => {
    const model = modelWith(null);
    expect(await repoWith(model).updateMeta("nope", { title: "x" })).toBeNull();
  });

  it("setStatus routes through updateMeta (the admin toggle)", async () => {
    const model = modelWith(adDoc({ status: "inactive" }));
    const ad = await repoWith(model).setStatus("ad-1", "inactive");
    expect(model.findOneAndUpdate).toHaveBeenCalledWith(
      { adId: "ad-1" },
      { $set: { status: "inactive" } },
      { new: true },
    );
    expect(ad?.status).toBe("inactive");
  });

  it("replaceMedia swaps the bytes + media fields, defaulting storage to inline", async () => {
    const model = modelWith(adDoc());
    const m: AdMediaInput = {
      data: Buffer.from([1]),
      contentType: "video/mp4",
      mediaType: "video",
      byteSize: 1,
      width: 640,
      height: 360,
    };
    await repoWith(model).replaceMedia("ad-1", m);
    const [filter, update, opts] = model.findOneAndUpdate.mock.calls[0] as any[];
    expect(filter).toEqual({ adId: "ad-1" });
    expect(update.$set).toEqual({
      data: m.data,
      contentType: "video/mp4",
      mediaType: "video",
      byteSize: 1,
      width: 640,
      height: 360,
      storage: "inline",
    });
    expect(opts).toEqual({ new: true });
  });
});

describe("makeAdRepo.pickForAir", () => {
  const modelWith = (docs: unknown[]) => {
    const chain = chainOf(docs);
    return { find: jest.fn(() => chain), chain };
  };

  it("draws only from the ACTIVE pool (no bytes) and rotates to the least-shown ad", async () => {
    const model = modelWith([adDoc({ adId: "a", timesShown: 3 }), adDoc({ adId: "b", timesShown: 1 })]);
    const ad = await repoWith(model).pickForAir();
    expect(model.find).toHaveBeenCalledWith({ status: "active" });
    expect(model.chain.select).toHaveBeenCalledWith("-data");
    expect(ad?.adId).toBe("b");
  });

  it("never picks a ticker-only sponsor (break placement required)", async () => {
    const model = modelWith([
      adDoc({ adId: "mention", placements: ["ticker"], timesShown: 0 }),
      adDoc({ adId: "creative", placements: ["break", "ticker"], timesShown: 9 }),
    ]);
    const ad = await repoWith(model).pickForAir(() => 0);
    expect(ad?.adId).toBe("creative");
    expect((await repoWith(modelWith([adDoc({ placements: ["ticker"] })])).pickForAir())).toBeNull();
  });

  it("avoids repeating the previous airing among equally-due ads", async () => {
    const never = { timesShown: 0, lastShownAt: undefined };
    const model = modelWith([adDoc({ adId: "a", ...never }), adDoc({ adId: "b", ...never })]);
    const ad = await repoWith(model).pickForAir(() => 0, "a");
    expect(ad?.adId).toBe("b");
  });

  it("returns null when nothing is active", async () => {
    expect(await repoWith(modelWith([])).pickForAir()).toBeNull();
  });
});

describe("makeAdRepo — airing tallies & lifecycle", () => {
  const execModel = (extra: Record<string, unknown> = {}) => ({
    updateOne: jest.fn(() => ({ exec: jest.fn(async () => ({})) })),
    ...extra,
  });

  it("markShown stamps lastShownAt and bumps timesShown atomically", async () => {
    const model = execModel();
    const at = new Date("2026-07-08T12:00:00Z");
    await repoWith(model).markShown("ad-1", at);
    expect(model.updateOne).toHaveBeenCalledWith(
      { adId: "ad-1" },
      { $set: { lastShownAt: at }, $inc: { timesShown: 1 } },
    );
  });

  it("recordImpression adds dwell ms, ignoring non-positive durations", async () => {
    const model = execModel();
    const repo = repoWith(model);
    await repo.recordImpression("ad-1", 0);
    await repo.recordImpression("ad-1", -5);
    expect(model.updateOne).not.toHaveBeenCalled();
    await repo.recordImpression("ad-1", 12_000);
    expect(model.updateOne).toHaveBeenCalledWith({ adId: "ad-1" }, { $inc: { totalDisplayMs: 12_000 } });
  });

  it("remove reports whether a row was actually deleted", async () => {
    const deleted = { deleteOne: jest.fn(() => ({ exec: jest.fn(async () => ({ deletedCount: 1 })) })) };
    expect(await repoWith(deleted).remove("ad-1")).toBe(true);
    expect(deleted.deleteOne).toHaveBeenCalledWith({ adId: "ad-1" });

    const noRow = { deleteOne: jest.fn(() => ({ exec: jest.fn(async () => ({ deletedCount: 0 })) })) };
    expect(await repoWith(noRow).remove("ad-1")).toBe(false);

    const noCount = { deleteOne: jest.fn(() => ({ exec: jest.fn(async () => ({})) })) };
    expect(await repoWith(noCount).remove("ad-1")).toBe(false);
  });

  it("count uses the cheap estimated count", async () => {
    const model = { estimatedDocumentCount: jest.fn(async () => 7) };
    expect(await repoWith(model).count()).toBe(7);
  });
});
