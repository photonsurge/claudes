import { parseRawFloat32, extractField } from "./wgrib2";

describe("parseRawFloat32", () => {
  it("parses little-endian float32 stream into a grid", () => {
    const values = [1.5, -2.25, 3.0, 0.0];
    const buf = Buffer.alloc(values.length * 4);
    values.forEach((v, i) => buf.writeFloatLE(v, i * 4));
    const out = parseRawFloat32(buf, 2, 2);
    expect(out.length).toBe(4);
    expect(Array.from(out)).toEqual(values);
  });
});

describe("extractField", () => {
  it("dumps a grid via an injected (mocked) runner", async () => {
    const width = 3;
    const height = 2;
    const values = [1, 2, 3, 4, 5, 6];
    const buf = Buffer.alloc(values.length * 4);
    values.forEach((v, i) => buf.writeFloatLE(v, i * 4));

    const runner = jest.fn().mockResolvedValue(buf);
    const grid = await extractField({ gribPath: "/x.grib2", match: ":TMP:", width, height, runner });
    expect(grid.width).toBe(width);
    expect(grid.height).toBe(height);
    expect(Array.from(grid.values)).toEqual(values);

    const args = runner.mock.calls[0][0] as string[];
    expect(args).toContain("-order");
    expect(args).toContain("we:ns");
    expect(args).toContain("-no_header");
    expect(args).toContain("-bin");
    expect(args).toContain("-match");
    expect(args).toContain(":TMP:");
    // Inventory MUST be suppressed or it corrupts the binary stream.
    const inv = args.indexOf("-inv");
    expect(inv).toBeGreaterThanOrEqual(0);
    expect(args[inv + 1]).toBe("/dev/null");
  });

  it("throws on short/empty output (e.g. APCP missing at f000)", async () => {
    const runner = jest.fn().mockResolvedValue(Buffer.alloc(0));
    await expect(
      extractField({ gribPath: "/x.grib2", match: ":APCP:", width: 4, height: 4, runner }),
    ).rejects.toThrow(/short output/);
  });
});
