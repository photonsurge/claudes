import { rm, readFile, stat } from "node:fs/promises";
import { downloadToTemp, cleanupTemp, headOk } from "./download";

const realFetch = global.fetch;
afterEach(() => {
  (global as any).fetch = realFetch;
  jest.restoreAllMocks();
});

describe("downloadToTemp", () => {
  it("writes the fetched bytes to a temp file and returns its path", async () => {
    const payload = Buffer.from("GRIB-bytes");
    (global as any).fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      arrayBuffer: async () => payload.buffer.slice(payload.byteOffset, payload.byteOffset + payload.byteLength),
    });

    const path = await downloadToTemp("https://example/x", "temp.f000.grib2");
    expect(path).toMatch(/temp\.f000\.grib2$/);
    const onDisk = await readFile(path);
    expect(onDisk.equals(payload)).toBe(true);

    await rm(path, { force: true });
  });

  it("throws with status + url when the response is not ok", async () => {
    (global as any).fetch = jest.fn().mockResolvedValue({ ok: false, status: 404 });
    await expect(downloadToTemp("https://example/missing", "a.grib2")).rejects.toThrow(
      /download failed 404 for https:\/\/example\/missing/,
    );
  });
});

describe("cleanupTemp", () => {
  it("removes the file's directory and swallows errors on a missing path", async () => {
    const payload = Buffer.from("z");
    (global as any).fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      arrayBuffer: async () => payload.buffer.slice(payload.byteOffset, payload.byteOffset + payload.byteLength),
    });
    const path = await downloadToTemp("https://example/x", "f.grib2");
    await cleanupTemp(path);
    await expect(stat(path)).rejects.toBeTruthy();
    // second cleanup is a no-op (does not throw)
    await expect(cleanupTemp(path)).resolves.toBeUndefined();
  });
});

describe("headOk", () => {
  it("returns true for an ok HEAD response", async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: true });
    (global as any).fetch = fetchMock;
    await expect(headOk("https://example/x")).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledWith("https://example/x", { method: "HEAD" });
  });

  it("returns false for a non-ok response", async () => {
    (global as any).fetch = jest.fn().mockResolvedValue({ ok: false });
    await expect(headOk("https://example/x")).resolves.toBe(false);
  });

  it("returns false (never throws) when fetch rejects", async () => {
    (global as any).fetch = jest.fn().mockRejectedValue(new Error("ENOTFOUND"));
    await expect(headOk("https://example/x")).resolves.toBe(false);
  });
});
