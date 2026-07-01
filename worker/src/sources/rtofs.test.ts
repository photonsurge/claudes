import {
  buildRtofsUrl,
  padRtofsHour,
  rtofsCandidateRuns,
  rtofsLatestAvailableRun,
  RTOFS_NETCDF_VARS,
  RTOFS_TARGET_GRID,
  RTOFS_GRIB2_REGIONS,
  RTOFS_LATENCY_HOURS,
} from "./rtofs";

describe("buildRtofsUrl (global netCDF)", () => {
  it("builds the NOMADS 2ds prog netCDF URL (forecast)", () => {
    const url = buildRtofsUrl({ date: "20260628", hour: 24 });
    expect(url).toBe(
      "https://nomads.ncep.noaa.gov/pub/data/nccf/com/rtofs/prod/rtofs.20260628/rtofs_glo_2ds_f024_prog.nc",
    );
  });

  it("supports nowcast + diag/ice bundles and pads the hour", () => {
    expect(buildRtofsUrl({ date: "20260628", hour: 0, kind: "n" })).toContain("_n000_prog.nc");
    expect(buildRtofsUrl({ date: "20260628", hour: 24, bundle: "diag" })).toContain("_f024_diag.nc");
    expect(padRtofsHour(6)).toBe("006");
  });

  it("maps sst/salinity/current to their netCDF vars in the prog bundle", () => {
    expect(RTOFS_NETCDF_VARS.sst).toMatchObject({ bundle: "prog", encoding: "scalar" });
    expect(RTOFS_NETCDF_VARS.current).toMatchObject({ bundle: "prog", encoding: "uv" });
    expect(RTOFS_NETCDF_VARS.current.vars).toHaveLength(2); // u + v
    expect(RTOFS_NETCDF_VARS.salinity.vars).toEqual(["sss"]);
  });

  it("targets a global 1/12° regular grid and knows the 11 GRIB2 regions", () => {
    expect(RTOFS_TARGET_GRID.width).toBe(4320);
    expect(RTOFS_TARGET_GRID.height).toBe(2160);
    expect(RTOFS_GRIB2_REGIONS).toContain("west_atl");
    expect(RTOFS_GRIB2_REGIONS.length).toBe(11);
  });
});

describe("rtofsCandidateRuns", () => {
  it("offers one 00z run/day past the ~8h latency, newest-first", () => {
    // 2026-06-29T12:00Z: the 29th's 00z run is 12h old (>8h) → eligible.
    const now = new Date("2026-06-29T12:00:00Z");
    const runs = rtofsCandidateRuns(now, 2);
    expect(runs[0].date).toBe("20260629");
    for (const r of runs) {
      expect(now.getTime() - r.runDate.getTime()).toBeGreaterThanOrEqual(
        RTOFS_LATENCY_HOURS * 3600 * 1000,
      );
    }
  });

  it("skips today's run before it has published (<8h)", () => {
    const now = new Date("2026-06-29T05:00:00Z");
    expect(rtofsCandidateRuns(now, 1)[0].date).toBe("20260628");
  });
});

describe("rtofsLatestAvailableRun", () => {
  it("returns the newest run whose prog file probes true", async () => {
    const now = new Date("2026-06-29T12:00:00Z");
    const run = await rtofsLatestAvailableRun(now, async () => true);
    expect(run.date).toBe("20260629");
  });
});
