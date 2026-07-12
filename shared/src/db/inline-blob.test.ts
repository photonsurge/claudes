import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BlobFs } from "./blob-fs";
import { makeInlineBlobStore, toBuffer } from "./inline-blob";

describe("makeInlineBlobStore (FS off — historical inline behaviour)", () => {
  const store = makeInlineBlobStore("tex", null);

  it("get returns the inline fallback bytes", async () => {
    expect((await store.get("id", Buffer.from("hi")))?.toString()).toBe("hi");
  });
  it("get returns null with no inline and no FS", async () => {
    expect(await store.get("id")).toBeNull();
  });
  it("inlineValue keeps bytes on the doc", () => {
    const b = Buffer.from("x");
    expect(store.inlineValue(b)).toBe(b);
  });
  it("put/delete are no-ops", async () => {
    await expect(store.put("id", Buffer.from("x"))).resolves.toBeUndefined();
    await expect(store.delete(["id"])).resolves.toBeUndefined();
  });
});

describe("makeInlineBlobStore (FS on)", () => {
  let root: string;
  let store: ReturnType<typeof makeInlineBlobStore>;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "inlineblob-"));
    store = makeInlineBlobStore("tex", new BlobFs(root));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("put then get round-trips through disk", async () => {
    await store.put("id", Buffer.from("disk"));
    expect((await store.get("id"))?.toString()).toBe("disk");
  });

  it("prefers disk over the inline fallback once migrated", async () => {
    await store.put("id", Buffer.from("disk"));
    expect((await store.get("id", Buffer.from("stale-inline")))?.toString()).toBe("disk");
  });

  it("falls back to inline for a not-yet-migrated blob", async () => {
    expect((await store.get("id", Buffer.from("still-inline")))?.toString()).toBe("still-inline");
  });

  it("inlineValue omits bytes from the doc so they aren't doubled up", () => {
    expect(store.inlineValue(Buffer.from("x"))).toBeUndefined();
  });

  it("delete removes the on-disk bytes", async () => {
    await store.put("id", Buffer.from("x"));
    await store.delete(["id"]);
    expect(await store.get("id")).toBeNull();
  });
});

describe("toBuffer", () => {
  it("passes Buffers through and wraps Uint8Arrays", () => {
    const b = Buffer.from("a");
    expect(toBuffer(b)).toBe(b);
    expect(toBuffer(new Uint8Array([104, 105])).toString()).toBe("hi");
  });
  it("decodes a lean BSON Binary shape", () => {
    expect(toBuffer({ _bsontype: "Binary", buffer: new Uint8Array([120]) }).toString()).toBe("x");
  });
  it("decodes a JSON-serialised Buffer and empties on garbage", () => {
    expect(toBuffer({ type: "Buffer", data: [121] }).toString()).toBe("y");
    expect(toBuffer(null).byteLength).toBe(0);
    expect(toBuffer(42).byteLength).toBe(0);
  });
});
