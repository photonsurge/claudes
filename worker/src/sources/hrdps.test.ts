import { getSource } from "@photonsurge/shared/sources";

import {
  buildHrdpsUrl,
  buildHrdpsNewGrid,
  padHrdpsFhr,
  hrdpsCandidateCycles,
  hrdpsLatestAvailableRun,
  HRDPS_PARAMS,
  HRDPS_BBOX,
  HRDPS_GRID,
  HRDPS_NEWGRID,
  HRDPS_CYCLE_HOURS,
} from "./hrdps";

describe("buildHrdpsUrl", () => {
  it("builds the keyless MSC datamart URL for a known input (VERIFIED live shape)", () => {
    const url = buildHrdpsUrl({ date: "20260701", cycle: "00", fhr: 0, token: "TMP_AGL-2m" });
    expect(url).toBe(
      "https://dd.weather.gc.ca/20260701/WXO-DD/model_hrdps/continental/2.5km/00/000/" +
        "20260701T00Z_MSC_HRDPS_TMP_AGL-2m_RLatLon0.0225_PT000H.grib2",
    );
  });

  it("zero-pads the cycle and the 3-digit forecast hour in BOTH the path and the filename", () => {
    const url = buildHrdpsUrl({ date: "20260701", cycle: "6", fhr: 12, token: "UGRD_AGL-10m" });
    expect(url).toContain("/2.5km/06/012/");
    expect(url).toContain("20260701T06Z_MSC_HRDPS_UGRD_AGL-10m_RLatLon0.0225_PT012H.grib2");
  });

  it("routes each app variable's token into the filename", () => {
    for (const [, spec] of Object.entries(HRDPS_PARAMS)) {
      for (const token of spec.tokens) {
        const url = buildHrdpsUrl({ date: "20260701", cycle: "12", fhr: 3, token });
        expect(url).toContain(`_MSC_HRDPS_${token}_RLatLon0.0225_PT003H.grib2`);
        expect(url).toContain("/2.5km/12/003/");
      }
    }
  });
});

describe("padHrdpsFhr", () => {
  it("pads to 3 digits", () => {
    expect(padHrdpsFhr(0)).toBe("000");
    expect(padHrdpsFhr(6)).toBe("006");
    expect(padHrdpsFhr(48)).toBe("048");
    expect(padHrdpsFhr(120)).toBe("120");
  });
});

describe("HRDPS variable → datamart token map (VERIFIED against the live listing)", () => {
  it("maps our variable ids to the correct MSC filename tokens", () => {
    expect(HRDPS_PARAMS.temp.tokens).toEqual(["TMP_AGL-2m"]);
    expect(HRDPS_PARAMS.wind.tokens).toEqual(["UGRD_AGL-10m", "VGRD_AGL-10m"]);
    expect(HRDPS_PARAMS.gust.tokens).toEqual(["GUST_AGL-10m"]);
    expect(HRDPS_PARAMS.humidity.tokens).toEqual(["RH_AGL-2m"]);
  });

  it("covers exactly the four source variables (temp/wind/gust/humidity)", () => {
    expect(Object.keys(HRDPS_PARAMS).sort()).toEqual(["gust", "humidity", "temp", "wind"]);
    expect(getSource("hrdps")!.variables.sort()).toEqual(["gust", "humidity", "temp", "wind"]);
  });

  it("marks wind as the uv pair and everything else scalar, each with a -match", () => {
    expect(HRDPS_PARAMS.wind.encoding).toBe("uv");
    expect(HRDPS_PARAMS.wind.match).toHaveLength(2);
    for (const id of ["temp", "gust", "humidity"]) {
      expect(HRDPS_PARAMS[id].encoding).toBe("scalar");
      expect(HRDPS_PARAMS[id].match).toHaveLength(1);
    }
    for (const spec of Object.values(HRDPS_PARAMS)) {
      for (const m of spec.match) expect(m.length).toBeGreaterThan(0);
    }
  });
});

describe("descriptor ↔ regrid grid consistency (HARD-WON ALIGNMENT LESSON)", () => {
  const src = getSource("hrdps")!;

  it("dims·res EXACTLY fills the bbox: e=w+(width-1)*res, n=s+(height-1)*res", () => {
    const [w, s, e, n] = src.bbox;
    const { width, height } = src.dims!;
    const res = src.resolutionDeg;
    expect(w + (width - 1) * res).toBeCloseTo(e, 6);
    expect(s + (height - 1) * res).toBeCloseTo(n, 6);
  });

  it("the exported grid/bbox mirror the descriptor", () => {
    expect(HRDPS_BBOX).toEqual(src.bbox);
    expect(HRDPS_GRID.width).toBe(src.dims!.width);
    expect(HRDPS_GRID.height).toBe(src.dims!.height);
    expect(HRDPS_GRID.res).toBe(src.resolutionDeg);
  });

  it("the -new_grid target origin/extent EQUALS the descriptor bbox", () => {
    // Spec: `latlon lon0:nx:dlon lat0:ny:dlat`
    const spec = buildHrdpsNewGrid();
    expect(spec).toBe(HRDPS_NEWGRID);
    const m = spec.match(/^latlon (-?[\d.]+):(\d+):([\d.]+) (-?[\d.]+):(\d+):([\d.]+)$/);
    expect(m).not.toBeNull();
    const [, lon0, nx, dlon, lat0, ny, dlat] = m!;
    const [w, s, e, n] = src.bbox;
    // origin == SW corner of the bbox
    expect(Number(lon0)).toBeCloseTo(w, 6);
    expect(Number(lat0)).toBeCloseTo(s, 6);
    // dims == descriptor dims
    expect(Number(nx)).toBe(src.dims!.width);
    expect(Number(ny)).toBe(src.dims!.height);
    // step == descriptor res
    expect(Number(dlon)).toBeCloseTo(src.resolutionDeg, 6);
    expect(Number(dlat)).toBeCloseTo(src.resolutionDeg, 6);
    // extent == NE corner of the bbox
    expect(Number(lon0) + (Number(nx) - 1) * Number(dlon)).toBeCloseTo(e, 6);
    expect(Number(lat0) + (Number(ny) - 1) * Number(dlat)).toBeCloseTo(n, 6);
  });

  it("is a rotated-grid nest at ~2.5 km with a minZoom (regional overlay)", () => {
    expect(src.grid).toBe("rotated");
    expect(src.resolutionDeg).toBeCloseTo(0.0225, 6);
    expect(src.minZoom).toBeDefined();
    expect(src.priority).toBe(30);
  });
});

describe("hrdpsCandidateCycles", () => {
  it("returns 6-hourly cycles newest-first, all latency-eligible", () => {
    const now = new Date("2026-07-01T14:00:00Z");
    const cands = hrdpsCandidateCycles(now);
    expect(cands.length).toBeGreaterThan(0);
    for (let i = 1; i < cands.length; i++) {
      expect(cands[i - 1].runDate.getTime()).toBeGreaterThanOrEqual(cands[i].runDate.getTime());
    }
    // ~90 min latency: the 12z run is eligible at 14:00Z.
    expect(cands[0].runDate.getTime()).toBeLessThanOrEqual(Date.UTC(2026, 6, 1, 12));
    for (const c of cands) {
      expect(HRDPS_CYCLE_HOURS).toContain(c.runDate.getUTCHours());
    }
  });

  it("excludes a cycle still inside the ~90 min latency window", () => {
    // 12:30Z: the 12z run (30 min old) is NOT yet eligible (< 90 min).
    const now = new Date("2026-07-01T12:30:00Z");
    const cands = hrdpsCandidateCycles(now);
    expect(cands[0].runDate.getTime()).toBeLessThanOrEqual(Date.UTC(2026, 6, 1, 6));
  });
});

describe("hrdpsLatestAvailableRun", () => {
  it("returns the newest run whose f000 TMP probe succeeds", async () => {
    const now = new Date("2026-07-01T14:00:00Z");
    const cands = hrdpsCandidateCycles(now);
    const target = cands[1]; // pretend the newest isn't published yet
    const targetUrl = buildHrdpsUrl({ date: target.date, cycle: target.cycle, fhr: 0, token: "TMP_AGL-2m" });
    const fetchHead = jest.fn(async (url: string) => url === targetUrl);
    const got = await hrdpsLatestAvailableRun(now, fetchHead);
    expect(got.runDate.toISOString()).toBe(target.runDate.toISOString());
  });

  it("falls back to the newest candidate when no probe succeeds", async () => {
    const now = new Date("2026-07-01T14:00:00Z");
    const cands = hrdpsCandidateCycles(now);
    const got = await hrdpsLatestAvailableRun(now, async () => false);
    expect(got.runDate.toISOString()).toBe(cands[0].runDate.toISOString());
  });
});
