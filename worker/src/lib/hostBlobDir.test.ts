import { resolveHostBlobDir } from "./hostBlobDir";

const fsWith = (existing: string[], writable = existing) => ({
  exists: (p: string) => existing.includes(p),
  writable: (p: string) => writable.includes(p),
});

describe("resolveHostBlobDir", () => {
  it("uses the compose default <repo>/blobs when BLOB_DIR is unset", () => {
    expect(resolveHostBlobDir({}, "/repo", fsWith(["/repo/blobs"]))).toEqual({ dir: "/repo/blobs", reason: "compose default ./blobs" });
  });
  it("ignores the container path /app/blobs on the host", () => {
    expect(resolveHostBlobDir({ BLOB_DIR: "/app/blobs" }, "/repo", fsWith(["/repo/blobs"])).dir).toBe("/repo/blobs");
  });
  it("uses a host BLOB_DIR that exists, resolving relative paths from the repo root", () => {
    expect(resolveHostBlobDir({ BLOB_DIR: "/srv/blobs" }, "/repo", fsWith(["/srv/blobs"])).dir).toBe("/srv/blobs");
    expect(resolveHostBlobDir({ BLOB_DIR: "./data/b" }, "/repo", fsWith(["/repo/data/b"])).dir).toBe("/repo/data/b");
  });
  it("returns null with a reason when the folder is missing or not writable", () => {
    expect(resolveHostBlobDir({}, "/repo", fsWith([])).dir).toBeNull();
    const r = resolveHostBlobDir({}, "/repo", fsWith(["/repo/blobs"], []));
    expect(r.dir).toBeNull();
    expect(r.reason).toMatch(/not writable/);
  });
});
