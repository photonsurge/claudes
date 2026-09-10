import {
  buildRtofsUrl,
  padRtofsHour,
  rtofsCandidateRuns,
  rtofsLatestAvailableRun,
  RTOFS_VARS,
  RTOFS_TARGET_GRID,
  RTOFS_CDO_REMAP_GRID,
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

  it("uses the GRIB2 tokens cdo actually emits (confirmed from a live inventory)", () => {
    // cdo maps sst→WTMP, salinity→PRACTSAL, currents→UOGRD/VOGRD; values stay in
    // the netCDF's display units (skipUnitConvert on the bake side).
    expect(RTOFS_VARS.sst.gribMatch).toEqual([":WTMP:"]);
    expect(RTOFS_VARS.salinity.gribMatch).toEqual([":PRACTSAL:"]);
    expect(RTOFS_VARS.current.gribMatch).toEqual([":UOGRD:", ":VOGRD:"]);
    // netCDF names (for cdo -selname) are a separate namespace from GRIB2 tokens.
    expect(RTOFS_VARS.sst.ncVars).toEqual(["sst"]);
  });

  it("target grid dims match the cdo remap grid (global_0.16 = 2250×1125)", () => {
    expect(RTOFS_CDO_REMAP_GRID).toBe("global_0.16");
    expect(RTOFS_TARGET_GRID.width).toBe(360 / 0.16);
    expect(RTOFS_TARGET_GRID.height).toBe(180 / 0.16);
    expect(RTOFS_TARGET_GRID.width * RTOFS_TARGET_GRID.height * 4).toBeLessThan(12 * 1048576); // one upload < ~120 ms
    expect(RTOFS_GRIB2_REGIONS).toContain("west_atl"); // regional tiles (not global)
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
