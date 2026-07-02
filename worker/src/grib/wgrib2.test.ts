import {
  parseRawFloat32,
  extractField,
  parseGridGeometry,
  probeGridGeometry,
} from "./wgrib2";

describe("parseRawFloat32", () => {
  it("parses little-endian float32 stream into a grid", () => {
    const values = [1.5, -2.25, 3.0, 0.0];
    const buf = Buffer.alloc(values.length * 4);
    values.forEach((v, i) => buf.writeFloatLE(v, i * 4));
    const out = parseRawFloat32(buf, 2, 2);
    expect(out.length).toBe(4);
    expect(Array.from(out)).toEqual(values);
  });

  it("reads exactly width*height floats, ignoring trailing bytes", () => {
    const values = [10, 20];
    const buf = Buffer.alloc(values.length * 4 + 8); // extra trailing bytes
    values.forEach((v, i) => buf.writeFloatLE(v, i * 4));
    const out = parseRawFloat32(buf, 2, 1);
    expect(out.length).toBe(2);
    expect(Array.from(out)).toEqual(values);
  });

  it("returns a standalone Float32Array (not aliasing the source buffer)", () => {
    const buf = Buffer.alloc(4);
    buf.writeFloatLE(42, 0);
    const out = parseRawFloat32(buf, 1, 1);
    buf.writeFloatLE(0, 0); // mutate source after parse
    expect(out[0]).toBe(42);
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

  it("places -inv immediately before /dev/null and after the binary flags", async () => {
    const buf = Buffer.alloc(2 * 2 * 4);
    const runner = jest.fn().mockResolvedValue(buf);
    await extractField({ gribPath: "/x.grib2", match: ":TMP:", width: 2, height: 2, runner });
    const args = runner.mock.calls[0][0] as string[];
    // exact arg vector after the file + match
    expect(args).toEqual([
      "/x.grib2",
      "-match",
      ":TMP:",
      "-order",
      "we:ns",
      "-no_header",
      "-inv",
      "/dev/null",
      "-bin",
      "-",
    ]);
  });

  it("omits -match when no match is given (dump first record)", async () => {
    const buf = Buffer.alloc(1 * 1 * 4);
    const runner = jest.fn().mockResolvedValue(buf);
    await extractField({ gribPath: "/only.grib2", width: 1, height: 1, runner });
    const args = runner.mock.calls[0][0] as string[];
    expect(args).not.toContain("-match");
    expect(args[0]).toBe("/only.grib2");
    // -inv guard still present
    expect(args).toContain("-inv");
    expect(args[args.indexOf("-inv") + 1]).toBe("/dev/null");
  });

  it("throws on short/empty output (e.g. APCP missing at f000)", async () => {
    const runner = jest.fn().mockResolvedValue(Buffer.alloc(0));
    await expect(
      extractField({ gribPath: "/x.grib2", match: ":APCP:", width: 4, height: 4, runner }),
    ).rejects.toThrow(/short output/);
  });

  it("throws when output is exactly one byte short of a full grid", async () => {
    const width = 2;
    const height = 2;
    const buf = Buffer.alloc(width * height * 4 - 1); // one byte short
    const runner = jest.fn().mockResolvedValue(buf);
    await expect(
      extractField({ gribPath: "/x.grib2", width, height, runner }),
    ).rejects.toThrow(/short output \(15 < 16 bytes\)/);
  });

  it("accepts output of exactly the expected length", async () => {
    const width = 3;
    const height = 2;
    const buf = Buffer.alloc(width * height * 4); // exact
    const runner = jest.fn().mockResolvedValue(buf);
    const grid = await extractField({ gribPath: "/x.grib2", width, height, runner });
    expect(grid.values.length).toBe(width * height);
  });

  it("includes the match token in the short-output error message", async () => {
    const runner = jest.fn().mockResolvedValue(Buffer.alloc(0));
    await expect(
      extractField({ gribPath: "/x.grib2", match: ":APCP:", width: 4, height: 4, runner }),
    ).rejects.toThrow(/match=:APCP:/);
  });

  it("uses GFS 0.25° defaults (1440×721) when width/height omitted", async () => {
    // Provide a full-size buffer so the guard passes; assert returned dims.
    const buf = Buffer.alloc(1440 * 721 * 4);
    const runner = jest.fn().mockResolvedValue(buf);
    const grid = await extractField({ gribPath: "/x.grib2", runner });
    expect(grid.width).toBe(1440);
    expect(grid.height).toBe(721);
    expect(grid.values.length).toBe(1440 * 721);
  });

  it("keeps the FIRST record when a match selects several on the same grid", async () => {
    // RTOFS regional files bundle 24 hourly steps → ":WTMP:" returns N records.
    const width = 2;
    const height = 2;
    const rec1 = [1, 2, 3, 4];
    const rec2 = [5, 6, 7, 8];
    const buf = Buffer.alloc((rec1.length + rec2.length) * 4);
    [...rec1, ...rec2].forEach((v, i) => buf.writeFloatLE(v, i * 4));
    const runner = jest.fn().mockResolvedValue(buf);
    const grid = await extractField({ gribPath: "/multi.grib2", match: ":WTMP:", width, height, runner });
    expect(Array.from(grid.values)).toEqual(rec1); // first record only
  });

  it("throws when output is not a whole multiple of nx*ny (wrong dims → would shear)", async () => {
    // 44044 declared vs a 210000-point record: 210000 is NOT a multiple of 44044.
    const buf = Buffer.alloc(210_000 * 4);
    const runner = jest.fn().mockResolvedValue(buf);
    await expect(
      extractField({ gribPath: "/x.grib2", match: ":WTMP:", width: 242, height: 182, runner }),
    ).rejects.toThrow(/not a whole multiple/);
  });
});

describe("parseGridGeometry", () => {
  const SAMOA = `1:0:grid_template=0:winds(N/S):
\tlat-lon grid:(560 x 375) units 1e-06 input WE:SN output WE:SN res 48
\tlat -30.000000 to -0.000001 by 0.080000
\tlon 170.000000 to 214.800000 by 0.080000 #points=210000`;

  it("parses nx/ny, lat/lon extent and spacing from a wgrib2 -grid block", () => {
    const g = parseGridGeometry(SAMOA);
    expect(g).toEqual({
      nx: 560,
      ny: 375,
      lat0: -30,
      lat1: -0.000001,
      dLat: 0.08,
      lon0: 170,
      lon1: 214.8,
      dLon: 0.08,
    });
  });

  it("throws on a non-lat-lon / unparseable block", () => {
    expect(() => parseGridGeometry("polar stereographic grid: blah")).toThrow(/unparseable/);
  });
});

describe("probeGridGeometry", () => {
  it("runs `-grid` with the match and parses the first record's block", async () => {
    // A multi-record match prints one identical block per record; parse the first.
    const block = `1:0:grid_template=0:winds(N/S):
\tlat-lon grid:(575 x 435) units 1e-06 input WE:SN output WE:SN res 48
\tlat 10.000000 to 44.800000 by 0.080000
\tlon 260.000000 to 306.000000 by 0.080000 #points=250125`;
    const runner = jest.fn().mockResolvedValue(Buffer.from(`${block}\n${block}`, "utf8"));
    const g = await probeGridGeometry({ gribPath: "/west_atl.grib2", match: ":WTMP:", runner });
    expect(g.nx).toBe(575);
    expect(g.ny).toBe(435);
    expect(g.lon0).toBe(260);
    expect(g.lon1).toBe(306);
    const args = runner.mock.calls[0][0] as string[];
    expect(args).toEqual(["/west_atl.grib2", "-match", ":WTMP:", "-grid"]);
  });
});
