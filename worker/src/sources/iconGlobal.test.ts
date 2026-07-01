import { getSource } from "@photonsurge/shared/sources";

import {
  buildIconGlobalUrl,
  buildIconGlobalRemapArgs,
  padIconGlobalStep,
  ICON_GLOBAL_VAR_TOKENS,
  ICON_GLOBAL_FIELD_MATCH,
  ICON_GLOBAL_CDO_REMAP,
  iconGlobalCandidateCycles,
  iconGlobalLatestAvailableRun,
} from "./iconGlobal";

describe("buildIconGlobalUrl", () => {
  it("builds the DWD open-data ICOSAHEDRAL .grib2.bz2 URL for a known input", () => {
    // VERIFIED against a live opendata.dwd.de listing (2026-07): model "icon",
    // grid token "icosahedral", NO level infix for surface fields, UPPERCASE
    // trailing token, lowercase <var> dir segment.
    const url = buildIconGlobalUrl({ date: "20260701", cycle: "00", step: 0, field: "t_2m" });
    expect(url).toBe(
      "https://opendata.dwd.de/weather/nwp/icon/grib/00/t_2m/" +
        "icon_global_icosahedral_single-level_2026070100_000_T_2M.grib2.bz2",
    );
  });

  it("uses the global 'icosahedral' grid token (NOT regular-lat-lon)", () => {
    const url = buildIconGlobalUrl({ date: "20260701", cycle: "12", step: 1, field: "u_10m" });
    expect(url).toContain("icon_global_icosahedral_single-level_");
    expect(url).not.toContain("regular-lat-lon");
    expect(url).not.toContain("germany");
    expect(url).not.toContain("europe");
  });

  it("keeps the <var> dir segment lowercase but the filename token UPPERCASE", () => {
    const url = buildIconGlobalUrl({ date: "20260701", cycle: "06", step: 3, field: "relhum_2m" });
    expect(url).toContain("/grib/06/relhum_2m/");
    expect(url).toContain("_003_RELHUM_2M.grib2.bz2");
  });

  it("zero-pads the cycle and the 3-digit forecast step", () => {
    const url = buildIconGlobalUrl({ date: "20260701", cycle: "6", step: 12, field: "u_10m" });
    expect(url).toContain("/grib/06/u_10m/");
    expect(url).toContain("_2026070106_012_U_10M.grib2.bz2");
  });

  it("routes each field into its own <var> directory segment (no level infix)", () => {
    for (const field of ["t_2m", "u_10m", "v_10m", "vmax_10m", "relhum_2m"]) {
      const url = buildIconGlobalUrl({ date: "20260701", cycle: "18", step: 0, field });
      expect(url).toContain(`/grib/18/${field}/`);
      expect(url).toContain(`_000_${field.toUpperCase()}.grib2.bz2`);
      expect(url).toContain("icosahedral");
    }
  });
});

describe("padIconGlobalStep", () => {
  it("pads to 3 digits", () => {
    expect(padIconGlobalStep(0)).toBe("000");
    expect(padIconGlobalStep(7)).toBe("007");
    expect(padIconGlobalStep(48)).toBe("048");
    expect(padIconGlobalStep(180)).toBe("180");
  });
});

describe("ICON_GLOBAL variable → DWD field token map", () => {
  it("maps our variable ids to the correct DWD field tokens", () => {
    expect(ICON_GLOBAL_VAR_TOKENS.temp).toEqual(["t_2m"]);
    expect(ICON_GLOBAL_VAR_TOKENS.wind).toEqual(["u_10m", "v_10m"]);
    expect(ICON_GLOBAL_VAR_TOKENS.gust).toEqual(["vmax_10m"]);
    expect(ICON_GLOBAL_VAR_TOKENS.humidity).toEqual(["relhum_2m"]);
  });

  it("covers exactly the four source variables (temp/wind/gust/humidity)", () => {
    expect(Object.keys(ICON_GLOBAL_VAR_TOKENS).sort()).toEqual(["gust", "humidity", "temp", "wind"]);
  });

  it("matches the descriptor's declared variable set", () => {
    const src = getSource("icon-global")!;
    expect([...src.variables].sort()).toEqual(Object.keys(ICON_GLOBAL_VAR_TOKENS).sort());
  });

  it("provides a wgrib2 -match token for every field it references", () => {
    for (const fields of Object.values(ICON_GLOBAL_VAR_TOKENS)) {
      for (const field of fields) {
        expect(typeof ICON_GLOBAL_FIELD_MATCH[field]).toBe("string");
        expect(ICON_GLOBAL_FIELD_MATCH[field].length).toBeGreaterThan(0);
      }
    }
  });
});

describe("icosahedral → regular cdo remap spec", () => {
  it("targets DWD's precomputed 0.125° world grid + weights archive", () => {
    expect(ICON_GLOBAL_CDO_REMAP.weightsArchiveUrl).toBe(
      "https://opendata.dwd.de/weather/lib/cdo/ICON_GLOBAL2WORLD_0125_EASY.tar.bz2",
    );
    expect(ICON_GLOBAL_CDO_REMAP.archiveDir).toBe("ICON_GLOBAL2WORLD_0125_EASY");
    expect(ICON_GLOBAL_CDO_REMAP.targetGridFile).toBe("target_grid_world_0125.txt");
    expect(ICON_GLOBAL_CDO_REMAP.weightsFile).toBe("weights_icogl2world_0125.nc");
  });

  it("builds a `cdo -O -f grb2 remap,GRID,WEIGHTS IN OUT` argument vector", () => {
    const args = buildIconGlobalRemapArgs({
      gridPath: "/w/target_grid_world_0125.txt",
      weightsPath: "/w/weights_icogl2world_0125.nc",
      inPath: "/tmp/t_2m.grib2",
      outPath: "/tmp/t_2m.rg.grib2",
    });
    expect(args).toEqual([
      "-O",
      "-f", "grb2",
      "remap,/w/target_grid_world_0125.txt,/w/weights_icogl2world_0125.nc",
      "/tmp/t_2m.grib2",
      "/tmp/t_2m.rg.grib2",
    ]);
    // remapbil/remapbic are INVALID on ICON grids — the spec must use the
    // precomputed-weights `remap` operator, not a bilinear one.
    expect(args.some((a) => a.startsWith("remapbil") || a.startsWith("remapbic"))).toBe(false);
  });
});

describe("icon-global descriptor grid/bbox consistency", () => {
  it("has extent == dims·res matching DWD's target grid (origin −180/−90, 2879×1441 @ 0.125°)", () => {
    const src = getSource("icon-global")!;
    const { width, height } = src.dims!;
    const res = src.resolutionDeg;
    const [w, s, e, n] = src.bbox;

    // VERIFIED against DWD target_grid_world_0125.txt: xsize=2879 (NOT 2880), the
    // grid stops at the 179.75 cell centre. dims MUST equal the cdo-remap output or
    // wgrib2 short-outputs the extract and every field fails to bake.
    expect(width).toBe(2879);
    expect(height).toBe(1441);
    expect(res).toBe(0.125);
    expect([w, s, e, n]).toEqual([-180, -90, 179.75, 90]);

    // Hard-won alignment invariants: the descriptor bbox/dims/res MUST satisfy
    // e = w + (width − 1)·res and n = s + (height − 1)·res exactly.
    expect(s + (height - 1) * res).toBeCloseTo(n, 6); // −90 + 1440·0.125 = 90 ✓
    expect(w + (width - 1) * res).toBeCloseTo(e, 6); // −180 + 2878·0.125 = 179.75 ✓
    expect((height - 1) * res).toBeCloseTo(180, 6); // full 180° latitude span
  });

  it("is a WORLDWIDE nest: near-global bbox, minZoom set, low nest priority", () => {
    const g = getSource("icon-global")!;
    expect(g.grid).toBe("icosahedral");
    expect(g.bbox).toEqual([-180, -90, 179.75, 90]); // whole planet bar DWD's 0.25° antimeridian gap
    expect(g.minZoom).toBe(2); // activates as soon as you zoom in, everywhere
    // Lower than every tighter regional nest so those still win in their bbox.
    for (const id of ["icon-d2", "icon-eu", "hrrr"]) {
      expect(g.priority).toBeLessThan(getSource(id)!.priority);
    }
    // Above the plain GFS/IFS global base priority (10/…) so it bumps everywhere.
    expect(g.priority).toBeGreaterThan(getSource("gfs")!.priority);
  });
});

describe("iconGlobalCandidateCycles", () => {
  it("returns 6-hourly cycles newest-first, all latency-eligible", () => {
    const now = new Date("2026-07-01T14:00:00Z");
    const cands = iconGlobalCandidateCycles(now);
    expect(cands.length).toBeGreaterThan(0);
    for (let i = 1; i < cands.length; i++) {
      expect(cands[i - 1].runDate.getTime()).toBeGreaterThanOrEqual(cands[i].runDate.getTime());
    }
    // ~4h latency: the 12z run is NOT yet eligible at 14:00Z, so newest <= 06z.
    expect(cands[0].runDate.getTime()).toBeLessThanOrEqual(Date.UTC(2026, 6, 1, 6));
    for (const c of cands) {
      expect([0, 6, 12, 18]).toContain(c.runDate.getUTCHours());
    }
  });
});

describe("iconGlobalLatestAvailableRun", () => {
  it("returns the newest run whose f000 t_2m probe succeeds", async () => {
    const now = new Date("2026-07-01T14:00:00Z");
    const cands = iconGlobalCandidateCycles(now);
    const target = cands[1]; // pretend the newest isn't published yet
    const targetUrl = buildIconGlobalUrl({ date: target.date, cycle: target.cycle, step: 0, field: "t_2m" });
    const fetchHead = jest.fn(async (url: string) => url === targetUrl);
    const got = await iconGlobalLatestAvailableRun(now, fetchHead);
    expect(got.runDate.toISOString()).toBe(target.runDate.toISOString());
  });

  it("falls back to the newest candidate when no probe succeeds", async () => {
    const now = new Date("2026-07-01T14:00:00Z");
    const cands = iconGlobalCandidateCycles(now);
    const got = await iconGlobalLatestAvailableRun(now, async () => false);
    expect(got.runDate.toISOString()).toBe(cands[0].runDate.toISOString());
  });
});
