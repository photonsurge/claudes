import {
  buildRtofsUrl,
  padRtofsHour,
  rtofsCandidateRuns,
  rtofsLatestAvailableRun,
  RTOFS_VAR_MATCH,
  RTOFS_GRID,
  RTOFS_BOUNDS,
  RTOFS_LATENCY_HOURS,
} from "./rtofs";

describe("buildRtofsUrl", () => {
  it("builds the NOMADS 2-D prog surface URL (forecast)", () => {
    const url = buildRtofsUrl({ date: "20260628", hour: 24 });
    expect(url).toBe(
      "https://nomads.ncep.noaa.gov/pub/data/nccf/com/rtofs/prod/rtofs.20260628/rtofs_glo_2ds_f024_prog.grib2",
    );
  });

  it("supports nowcast files and pads the hour", () => {
    expect(buildRtofsUrl({ date: "20260628", hour: 3, kind: "n" })).toContain("_n003_prog.grib2");
    expect(padRtofsHour(0)).toBe("000");
  });

  it("declares field matches for sst, current (u+v) and salinity", () => {
    expect(RTOFS_VAR_MATCH.sst).toHaveLength(1);
    expect(RTOFS_VAR_MATCH.current).toHaveLength(2);
    expect(RTOFS_VAR_MATCH.salinity).toHaveLength(1);
  });

  it("uses a regular 0.08° grid with the ~84N/72S polar gap", () => {
    expect(RTOFS_GRID.res).toBeCloseTo(0.08, 3);
    expect(RTOFS_BOUNDS).toEqual([-180, -72, 180, 84]);
    // width ≈ 360/0.08, height ≈ (84+72)/0.08 + 1
    expect(RTOFS_GRID.width).toBe(4500);
    expect(RTOFS_GRID.height).toBe(1951);
  });
});

describe("rtofsCandidateRuns", () => {
  it("offers one run/day past the ~16h latency, newest-first", () => {
    // 2026-06-29T18:00Z: the 29th's 00z run is 18h old (>16h) → eligible.
    const now = new Date("2026-06-29T18:00:00Z");
    const runs = rtofsCandidateRuns(now, 2);
    expect(runs[0].date).toBe("20260629");
    for (const r of runs) {
      expect(now.getTime() - r.runDate.getTime()).toBeGreaterThanOrEqual(
        RTOFS_LATENCY_HOURS * 3600 * 1000,
      );
    }
  });

  it("skips today's run before it has published", () => {
    // 2026-06-29T10:00Z: only 10h since 00z (<16h) → today not eligible yet.
    const now = new Date("2026-06-29T10:00:00Z");
    const runs = rtofsCandidateRuns(now, 1);
    expect(runs[0].date).toBe("20260628");
  });
});

describe("rtofsLatestAvailableRun", () => {
  it("returns the newest run whose file probes true", async () => {
    const now = new Date("2026-06-29T18:00:00Z");
    const run = await rtofsLatestAvailableRun(now, async () => true);
    expect(run.date).toBe("20260629");
  });
});
