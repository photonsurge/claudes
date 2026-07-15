import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BlobFs } from "./blob-fs";

describe("BlobFs", () => {
  let root: string;
  let fs: BlobFs;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "blobfs-"));
    fs = new BlobFs(root);
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("round-trips bytes through put/get", async () => {
    await fs.put("tex", "abc", Buffer.from("hello"));
    expect((await fs.get("tex", "abc"))?.toString()).toBe("hello");
  });

  it("get returns null for a missing key (and namespace)", async () => {
    expect(await fs.get("tex", "nope")).toBeNull();
    expect(await fs.get("other", "abc")).toBeNull();
  });

  it("put atomically replaces existing bytes", async () => {
    await fs.put("tex", "k", Buffer.from("v1"));
    await fs.put("tex", "k", Buffer.from("v2"));
    expect((await fs.get("tex", "k"))?.toString()).toBe("v2");
  });

  it("getMany keys hits and omits misses", async () => {
    await fs.put("tex", "a", Buffer.from("A"));
    await fs.put("tex", "b", Buffer.from("B"));
    const map = await fs.getMany("tex", ["a", "b", "missing"]);
    expect(map.get("a")?.toString()).toBe("A");
    expect(map.get("b")?.toString()).toBe("B");
    expect(map.has("missing")).toBe(false);
    expect(map.size).toBe(2);
  });

  it("has reflects presence", async () => {
    expect(await fs.has("tex", "k")).toBe(false);
    await fs.put("tex", "k", Buffer.from("x"));
    expect(await fs.has("tex", "k")).toBe(true);
  });

  it("delete removes bytes and tolerates missing keys", async () => {
    await fs.put("tex", "a", Buffer.from("A"));
    await fs.delete("tex", ["a", "never-existed"]);
    expect(await fs.get("tex", "a")).toBeNull();
  });

  it("shards different keys into 256 buckets by sha1 prefix", () => {
    const p = fs.filePath("tex", "abc");
    // <root>/tex/<2-hex-shard>/abc
    expect(p.startsWith(join(root, "tex"))).toBe(true);
    expect(p.endsWith(join("tex", "a9", "abc"))).toBe(true); // sha1("abc") => a9993e...
  });

  it("keeps distinct namespaces separate", async () => {
    await fs.put("nsA", "same", Buffer.from("A"));
    await fs.put("nsB", "same", Buffer.from("B"));
    expect((await fs.get("nsA", "same"))?.toString()).toBe("A");
    expect((await fs.get("nsB", "same"))?.toString()).toBe("B");
  });

  it("rejects traversal-y key components", () => {
    expect(() => fs.filePath("tex", "..")).toThrow(/unsafe/);
  });

  it("usage measures each namespace it finds on disk", async () => {
    await fs.put("tex", "a", Buffer.alloc(100));
    await fs.put("tex", "b", Buffer.alloc(300));
    await fs.put("ad", "c", Buffer.alloc(50));

    const usage = await fs.usage();
    expect(usage.root).toBe(root);
    expect(usage.files).toBe(3);
    expect(usage.bytes).toBe(450);
    // Sorted biggest-first.
    expect(usage.namespaces.map((n) => n.ns)).toEqual(["tex", "ad"]);
    const tex = usage.namespaces[0];
    expect(tex).toMatchObject({ files: 2, bytes: 400, largestBytes: 300, tmpFiles: 0 });
    expect(tex.newestMs).toBeGreaterThanOrEqual(tex.oldestMs!);
  });

  it("usage counts abandoned .tmp- writes separately from real blobs", async () => {
    await fs.put("tex", "a", Buffer.alloc(10));
    const orphan = `${fs.filePath("tex", "a")}.tmp-123-${randomUUID()}`;
    await writeFile(orphan, Buffer.alloc(999));

    const [tex] = (await fs.usage()).namespaces;
    expect(tex).toMatchObject({ files: 1, bytes: 10, tmpFiles: 1, tmpBytes: 999 });
  });

  it("usage of an empty (or absent) root is zero, not an error", async () => {
    expect(await fs.usage()).toMatchObject({ files: 0, bytes: 0, namespaces: [] });
    expect(await new BlobFs(join(root, "never-created")).usage()).toMatchObject({ files: 0, namespaces: [] });
  });

  it("usage reports the capacity of the filesystem under the root", async () => {
    const { disk } = await fs.usage();
    expect(disk!.totalBytes).toBeGreaterThan(0);
    expect(disk!.usedBytes).toBe(disk!.totalBytes - disk!.freeBytes);
  });

  it("fromEnv returns null without BLOB_DIR, an instance with it", () => {
    const prev = process.env.BLOB_DIR;
    delete process.env.BLOB_DIR;
    expect(BlobFs.fromEnv()).toBeNull();
    process.env.BLOB_DIR = "/some/root";
    expect(BlobFs.fromEnv()?.root).toBe("/some/root");
    if (prev === undefined) delete process.env.BLOB_DIR;
    else process.env.BLOB_DIR = prev;
  });
});
