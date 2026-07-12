import { rm, readFile, stat } from "node:fs/promises";
import { downloadToTemp, cleanupTemp, headOk, downloadIdxSubset, clearIdxCache } from "./download";

const realFetch = global.fetch;
afterEach(() => {
  (global as any).fetch = realFetch;
  clearIdxCache(); // the idx memo persists across calls — isolate each test
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

describe("downloadIdxSubset", () => {
  const idxText = [
    "1:0:d=x:PRMSL:mean sea level:anl:",
    "2:100:d=x:UGRD:10 m above ground:anl:",
    "3:250:d=x:VGRD:10 m above ground:anl:",
    "4:400:d=x:TMP:2 m above ground:anl:",
  ].join("\n");
  const gribUrl = "https://s3/grib";
  const idxUrl = "https://s3/grib.idx";
  const asAb = (b: Buffer) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);

  it("reads the .idx, range-downloads the matching (merged) messages, and writes them", async () => {
    const range = Buffer.from("UGRD+VGRD-bytes");
    const fetchMock = jest.fn((url: string, opts?: any) => {
      if (url === idxUrl) return Promise.resolve({ ok: true, status: 200, text: async () => idxText });
      expect(opts.headers.Range).toBe("bytes=100-399"); // UGRD+VGRD are contiguous -> one Range
      return Promise.resolve({ status: 206, arrayBuffer: async () => asAb(range) });
    });
    (global as any).fetch = fetchMock;

    const path = await downloadIdxSubset(
      { gribUrl, idxUrl, vars: ["UGRD", "VGRD"], levels: ["10_m_above_ground"] },
      "wind.f000.grib2",
    );
    expect(path).toMatch(/wind\.f000\.grib2$/);
    expect((await readFile(path)).equals(range)).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2); // one idx + one merged range
    await rm(path, { force: true });
  });

  it("caches the .idx so a second subset of the same file skips the idx fetch", async () => {
    const range = Buffer.from("R");
    const fetchMock = jest.fn((url: string) =>
      url === idxUrl
        ? Promise.resolve({ ok: true, status: 200, text: async () => idxText })
        : Promise.resolve({ status: 206, arrayBuffer: async () => asAb(range) }),
    );
    (global as any).fetch = fetchMock;

    const w = await downloadIdxSubset(
      { gribUrl, idxUrl, vars: ["UGRD", "VGRD"], levels: ["10_m_above_ground"] },
      "wind.grib2",
    );
    const t = await downloadIdxSubset(
      { gribUrl, idxUrl, vars: ["TMP"], levels: ["2_m_above_ground"] },
      "temp.grib2",
    );

    // The idx URL is fetched exactly once across both subsets; each still does
    // its own range fetch.
    expect(fetchMock.mock.calls.filter(([u]) => u === idxUrl)).toHaveLength(1);
    await rm(w, { force: true });
    await rm(t, { force: true });
  });

  it("throws when the .idx is missing (before any range fetch)", async () => {
    (global as any).fetch = jest.fn().mockResolvedValue({ ok: false, status: 404 });
    await expect(
      downloadIdxSubset({ gribUrl, idxUrl, vars: ["TMP"], levels: ["2_m_above_ground"] }, "x.grib2"),
    ).rejects.toThrow(/idx fetch failed 404/);
  });

  it("throws when no message matches, without fetching any range", async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 200, text: async () => idxText });
    (global as any).fetch = fetchMock;
    await expect(
      downloadIdxSubset({ gribUrl, idxUrl, vars: ["ZZZZ"], levels: ["surface"] }, "x.grib2"),
    ).rejects.toThrow(/no idx match/);
    expect(fetchMock).toHaveBeenCalledTimes(1); // only the idx fetch
  });

  it("throws with status when a range download fails", async () => {
    (global as any).fetch = jest.fn((url: string) =>
      url === idxUrl
        ? Promise.resolve({ ok: true, status: 200, text: async () => idxText })
        : Promise.resolve({ status: 416 }),
    );
    await expect(
      downloadIdxSubset({ gribUrl, idxUrl, vars: ["TMP"], levels: ["2_m_above_ground"] }, "x.grib2"),
    ).rejects.toThrow(/range download failed 416/);
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
