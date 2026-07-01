import {
  buildHrrrUrl,
  buildHrrrNewGrid,
  padHrrrFhr,
  HRRR_PARAMS,
  HRRR_NEWGRID,
  HRRR_GRID,
  HRRR_BBOX,
  HRRR_DLON,
  HRRR_DLAT,
  hrrrCandidateCycles,
  hrrrLatestAvailableRun,
} from "./hrrr";

describe("HRRR NOMADS GRIB-filter URL (buildHrrrUrl)", () => {
  it("targets the HRRR 2d filter, conus dir, and wrfsfcf file", () => {
    const url = buildHrrrUrl({ date: "20260628", cycle: "00", fhr: 0 });
    expect(url).toContain("filter_hrrr_2d.pl");
    expect(url).toContain("dir=%2Fhrrr.20260628%2Fconus");
    expect(url).toContain("file=hrrr.t00z.wrfsfcf00.grib2");
  });

  it("includes every var/level filter token for all vars by default", () => {
    const url = buildHrrrUrl({ date: "20260628", cycle: "12", fhr: 6 });
    // TMP:2 m above ground
    expect(url).toContain("var_TMP=on");
    expect(url).toContain("lev_2_m_above_ground=on");
    // UGRD/VGRD:10 m above ground
    expect(url).toContain("var_UGRD=on");
    expect(url).toContain("var_VGRD=on");
    expect(url).toContain("lev_10_m_above_ground=on");
    // GUST:surface
    expect(url).toContain("var_GUST=on");
    expect(url).toContain("lev_surface=on");
    expect(url).toContain("file=hrrr.t12z.wrfsfcf06.grib2");
  });

  it("emits only the requested params (e.g. temp-only probe)", () => {
    const url = buildHrrrUrl({ date: "20260628", cycle: "00", fhr: 0, params: [HRRR_PARAMS.temp] });
    expect(url).toContain("var_TMP=on");
    expect(url).toContain("lev_2_m_above_ground=on");
    expect(url).not.toContain("var_UGRD=on");
    expect(url).not.toContain("var_GUST=on");
    expect(url).not.toContain("lev_surface=on");
  });

  it("de-dupes the shared 10 m level between UGRD and VGRD", () => {
    const url = buildHrrrUrl({ date: "20260628", cycle: "00", fhr: 0, params: [HRRR_PARAMS.wind] });
    const levHits = url.match(/lev_10_m_above_ground=on/g) ?? [];
    expect(levHits).toHaveLength(1);
  });

  it("zero-pads cycle and forecast hour", () => {
    expect(padHrrrFhr(0)).toBe("00");
    expect(padHrrrFhr(6)).toBe("06");
    expect(padHrrrFhr(18)).toBe("18");
    const url = buildHrrrUrl({ date: "20260628", cycle: "3", fhr: 1 });
    expect(url).toContain("file=hrrr.t03z.wrfsfcf01.grib2");
  });
});

describe("HRRR wgrib2 -new_grid latlon spec (buildHrrrNewGrid)", () => {
  it("matches the descriptor dims and bbox SW corner", () => {
    const spec = buildHrrrNewGrid();
    expect(spec).toBe(HRRR_NEWGRID);
    // latlon lon0:nx:dlon lat0:ny:dlat
    const [kind, lonPart, latPart] = spec.split(" ");
    expect(kind).toBe("latlon");

    const [lon0, nx, dlon] = lonPart.split(":");
    const [lat0, ny, dlat] = latPart.split(":");

    // lon0/lat0 = SW corner of the HRRR bbox [-134, 21, -60, 53].
    expect(Number(lon0)).toBe(HRRR_BBOX[0]);
    expect(Number(lat0)).toBe(HRRR_BBOX[1]);
    expect(Number(lon0)).toBe(-134);
    expect(Number(lat0)).toBe(21);

    // nx/ny = descriptor dims {2600, 1100}.
    expect(Number(nx)).toBe(HRRR_GRID.width);
    expect(Number(ny)).toBe(HRRR_GRID.height);
    expect(Number(nx)).toBe(2600);
    expect(Number(ny)).toBe(1100);

    // dlon/dlat span the bbox edge-to-edge at ~0.028° (descriptor resolution).
    expect(Number(dlon)).toBeCloseTo(HRRR_DLON, 6);
    expect(Number(dlat)).toBeCloseTo(HRRR_DLAT, 6);
    expect(Number(dlon)).toBeCloseTo((-60 - -134) / (2600 - 1), 5);
    expect(Number(dlat)).toBeCloseTo((53 - 21) / (1100 - 1), 5);
    // ~0.028° target from the descriptor.
    expect(Number(dlon)).toBeGreaterThan(0.027);
    expect(Number(dlon)).toBeLessThan(0.03);
    expect(Number(dlat)).toBeGreaterThan(0.027);
    expect(Number(dlat)).toBeLessThan(0.03);
  });

  it("covers the whole HRRR bbox: lon0 + (nx-1)*dlon ≈ E edge, lat0 + (ny-1)*dlat ≈ N edge", () => {
    const lonE = HRRR_BBOX[0] + (HRRR_GRID.width - 1) * HRRR_DLON;
    const latN = HRRR_BBOX[1] + (HRRR_GRID.height - 1) * HRRR_DLAT;
    expect(lonE).toBeCloseTo(HRRR_BBOX[2], 6); // -60
    expect(latN).toBeCloseTo(HRRR_BBOX[3], 6); // 53
  });
});

describe("HRRR latest-run resolver (hourly cycles)", () => {
  it("enumerates hourly candidates newest-first, respecting latency", () => {
    const now = new Date("2026-06-28T12:00:00Z");
    const cands = hrrrCandidateCycles(now);
    expect(cands.length).toBeGreaterThan(0);
    // Newest-first.
    for (let i = 1; i < cands.length; i++) {
      expect(cands[i - 1].runDate.getTime()).toBeGreaterThan(cands[i].runDate.getTime());
    }
    // Every candidate is older than `now` by at least the latency (90 min).
    for (const c of cands) {
      expect(now.getTime() - c.runDate.getTime()).toBeGreaterThanOrEqual(90 * 60 * 1000);
    }
    // Consecutive candidates are exactly one hour apart.
    if (cands.length >= 2) {
      expect(cands[0].runDate.getTime() - cands[1].runDate.getTime()).toBe(3600 * 1000);
    }
  });

  it("returns the newest candidate whose f00 subset probes true", async () => {
    const now = new Date("2026-06-28T12:00:00Z");
    const cands = hrrrCandidateCycles(now);
    const second = cands[1]; // skip the very newest so we exercise the walk
    const seen: string[] = [];
    const fetchHead = async (url: string) => {
      seen.push(url);
      return url.includes(`hrrr.${second.date}`) && url.includes(`t${second.cycle}z`);
    };
    const run = await hrrrLatestAvailableRun(now, fetchHead);
    expect(run.date).toBe(second.date);
    expect(run.cycle).toBe(second.cycle);
    // Probe requests the temp-only f00 subset.
    expect(seen[0]).toContain("var_TMP=on");
    expect(seen[0]).toContain("wrfsfcf00.grib2");
  });

  it("falls back to the newest candidate when nothing probes true", async () => {
    const now = new Date("2026-06-28T12:00:00Z");
    const cands = hrrrCandidateCycles(now);
    const run = await hrrrLatestAvailableRun(now, async () => false);
    expect(run.runDate.getTime()).toBe(cands[0].runDate.getTime());
  });
});
