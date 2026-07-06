import {
  buildRtofsDepthUrl,
  rtofsDepthLatestAvailableRun,
  RTOFS_DEPTH_LEVELS_M,
  RTOFS_DEPTH_VARIABLE_IDS,
} from "./rtofsDepth";

describe("buildRtofsDepthUrl (global 3-D temperature netCDF)", () => {
  it("builds the NOMADS 3dz daily nowcast URL by default", () => {
    const url = buildRtofsDepthUrl({ date: "20260705" });
    expect(url).toBe(
      "https://nomads.ncep.noaa.gov/pub/data/nccf/com/rtofs/prod/rtofs.20260705/rtofs_glo_3dz_n024_daily_3ztio.nc",
    );
  });

  it("supports the forecast kind and pads the hour", () => {
    expect(buildRtofsDepthUrl({ date: "20260705", hour: 48, kind: "f" })).toBe(
      "https://nomads.ncep.noaa.gov/pub/data/nccf/com/rtofs/prod/rtofs.20260705/rtofs_glo_3dz_f048_daily_3ztio.nc",
    );
  });

  it("exposes the 4 broadcast depth chapters mapped onto real Depth-dimension values", () => {
    expect(RTOFS_DEPTH_LEVELS_M).toEqual([100, 500, 2000, 5000]);
    expect(RTOFS_DEPTH_VARIABLE_IDS[100]).toBe("sst100");
    expect(RTOFS_DEPTH_VARIABLE_IDS[500]).toBe("sst500");
    expect(RTOFS_DEPTH_VARIABLE_IDS[2000]).toBe("sst2000");
    expect(RTOFS_DEPTH_VARIABLE_IDS[5000]).toBe("sst5000");
  });
});

describe("rtofsDepthLatestAvailableRun", () => {
  it("returns the newest run whose n024 3dz file probes true", async () => {
    const now = new Date("2026-06-29T12:00:00Z");
    const run = await rtofsDepthLatestAvailableRun(now, async () => true);
    expect(run.date).toBe("20260629");
  });

  it("falls back to the newest candidate when nothing probes true", async () => {
    const now = new Date("2026-06-29T12:00:00Z");
    const run = await rtofsDepthLatestAvailableRun(now, async () => false);
    expect(run.date).toBe("20260629");
  });
});
