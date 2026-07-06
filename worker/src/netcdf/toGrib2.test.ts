import { buildCdoArgs, netcdfToGrib2, type CdoRunner } from "./toGrib2";

describe("buildCdoArgs", () => {
  it("emits `-f grb2 copy in out` for the plain rectilinear case", () => {
    expect(buildCdoArgs({ inPath: "in.nc", outPath: "out.grb2" })).toEqual([
      "-f", "grb2", "copy", "in.nc", "out.grb2",
    ]);
  });

  it("uses selname as the file-reading operator (no copy) for a var subset", () => {
    const a = buildCdoArgs({ inPath: "in.nc", outPath: "out.grb2", selnames: ["sst", "sss"] });
    expect(a).toEqual(["-f", "grb2", "selname,sst,sss", "in.nc", "out.grb2"]);
    expect(a).not.toContain("copy");
  });

  it("remap is the outer op (no dash), selname the inner (dash), and NO copy", () => {
    const a = buildCdoArgs({ inPath: "in.nc", outPath: "o.grb2", remapGrid: "global_0.08", selnames: ["sst"] });
    expect(a).toEqual(["-f", "grb2", "remapbil,global_0.08", "-selname,sst", "in.nc", "o.grb2"]);
    expect(a).not.toContain("copy"); // appending copy is the cdo abort
  });

  it("remap-only reads the file directly (no copy)", () => {
    const a = buildCdoArgs({ inPath: "in.nc", outPath: "o.grb2", remapGrid: "global_0.08" });
    expect(a).toEqual(["-f", "grb2", "remapbil,global_0.08", "in.nc", "o.grb2"]);
  });

  it("sellevel is the innermost op, after remap + selname (no copy)", () => {
    const a = buildCdoArgs({
      inPath: "in.nc",
      outPath: "o.grb2",
      remapGrid: "global_0.08",
      selnames: ["temperature"],
      sellevel: 500,
    });
    expect(a).toEqual([
      "-f", "grb2", "remapbil,global_0.08", "-selname,temperature", "-sellevel,500", "in.nc", "o.grb2",
    ]);
    expect(a).not.toContain("copy");
  });

  it("sellevel alone is the outer (file-reading) op", () => {
    const a = buildCdoArgs({ inPath: "in.nc", outPath: "o.grb2", sellevel: 100 });
    expect(a).toEqual(["-f", "grb2", "sellevel,100", "in.nc", "o.grb2"]);
  });
});

describe("netcdfToGrib2", () => {
  it("invokes the runner with the built args and returns outPath", async () => {
    const calls: string[][] = [];
    const runner: CdoRunner = async (_bin, args) => { calls.push(args); };
    const out = await netcdfToGrib2({ inPath: "in.nc", outPath: "out.grb2", runner });
    expect(out).toBe("out.grb2");
    expect(calls[0]).toEqual(["-f", "grb2", "copy", "in.nc", "out.grb2"]);
  });

  it("gives a clear hint when cdo is not installed (ENOENT)", async () => {
    const runner: CdoRunner = async () => { throw Object.assign(new Error("spawn cdo ENOENT"), { code: "ENOENT" }); };
    await expect(netcdfToGrib2({ inPath: "in.nc", outPath: "out.grb2", runner })).rejects.toThrow(/cdo` not installed/);
  });
});
