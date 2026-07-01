import { getSource } from "@photonsurge/shared/sources";

import {
  buildIconEuUrl,
  padIconEuStep,
  ICON_EU_VAR_TOKENS,
  ICON_EU_FIELD_MATCH,
  iconEuCandidateCycles,
  iconEuLatestAvailableRun,
} from "./iconEu";

describe("buildIconEuUrl", () => {
  it("builds the DWD open-data regular-lat-lon .grib2.bz2 URL for a known input", () => {
    // VERIFIED against a live opendata.dwd.de listing (2026-07): region "europe",
    // NO "_2d" infix, UPPERCASE trailing field token, lowercase <var> dir segment.
    const url = buildIconEuUrl({ date: "20260701", cycle: "00", step: 0, field: "t_2m" });
    expect(url).toBe(
      "https://opendata.dwd.de/weather/nwp/icon-eu/grib/00/t_2m/" +
        "icon-eu_europe_regular-lat-lon_single-level_2026070100_000_T_2M.grib2.bz2",
    );
  });

  it("uses region 'europe' and OMITS the ICON-D2 '_2d' surface infix", () => {
    const url = buildIconEuUrl({ date: "20260701", cycle: "12", step: 1, field: "u_10m" });
    expect(url).toContain("icon-eu_europe_regular-lat-lon_single-level_");
    expect(url).not.toContain("_2d_");
    expect(url).not.toContain("germany");
  });

  it("keeps the <var> dir segment lowercase but the filename token UPPERCASE", () => {
    const url = buildIconEuUrl({ date: "20260701", cycle: "06", step: 3, field: "relhum_2m" });
    expect(url).toContain("/grib/06/relhum_2m/");
    expect(url).toContain("_003_RELHUM_2M.grib2.bz2");
  });

  it("zero-pads the cycle and the 3-digit forecast step", () => {
    const url = buildIconEuUrl({ date: "20260701", cycle: "6", step: 12, field: "u_10m" });
    expect(url).toContain("/grib/06/u_10m/");
    expect(url).toContain("_2026070106_012_U_10M.grib2.bz2");
  });

  it("routes each field into its own <var> directory segment", () => {
    for (const field of ["t_2m", "u_10m", "v_10m", "vmax_10m", "relhum_2m"]) {
      const url = buildIconEuUrl({ date: "20260701", cycle: "18", step: 0, field });
      expect(url).toContain(`/grib/18/${field}/`);
      expect(url).toContain(`_000_${field.toUpperCase()}.grib2.bz2`);
      expect(url).toContain("regular-lat-lon");
    }
  });
});

describe("padIconEuStep", () => {
  it("pads to 3 digits", () => {
    expect(padIconEuStep(0)).toBe("000");
    expect(padIconEuStep(7)).toBe("007");
    expect(padIconEuStep(48)).toBe("048");
    expect(padIconEuStep(120)).toBe("120");
  });
});

describe("ICON_EU variable → DWD field token map", () => {
  it("maps our variable ids to the correct DWD field tokens", () => {
    expect(ICON_EU_VAR_TOKENS.temp).toEqual(["t_2m"]);
    expect(ICON_EU_VAR_TOKENS.wind).toEqual(["u_10m", "v_10m"]);
    expect(ICON_EU_VAR_TOKENS.gust).toEqual(["vmax_10m"]);
    expect(ICON_EU_VAR_TOKENS.humidity).toEqual(["relhum_2m"]);
  });

  it("covers exactly the four source variables (temp/wind/gust/humidity)", () => {
    expect(Object.keys(ICON_EU_VAR_TOKENS).sort()).toEqual(["gust", "humidity", "temp", "wind"]);
  });

  it("matches the descriptor's declared variable set", () => {
    const src = getSource("icon-eu")!;
    expect([...src.variables].sort()).toEqual(Object.keys(ICON_EU_VAR_TOKENS).sort());
  });

  it("provides a wgrib2 -match token for every field it references", () => {
    for (const fields of Object.values(ICON_EU_VAR_TOKENS)) {
      for (const field of fields) {
        expect(typeof ICON_EU_FIELD_MATCH[field]).toBe("string");
        expect(ICON_EU_FIELD_MATCH[field].length).toBeGreaterThan(0);
      }
    }
  });
});

describe("icon-eu descriptor grid/bbox consistency", () => {
  it("has extent == dims·res == bbox (origin −23.5/29.5, 1097×657 @ 0.0625°)", () => {
    const src = getSource("icon-eu")!;
    const { width, height } = src.dims!;
    const res = src.resolutionDeg;
    const [w, s, e, n] = src.bbox;

    expect(width).toBe(1097);
    expect(height).toBe(657);
    expect(res).toBe(0.0625);
    expect([w, s, e, n]).toEqual([-23.5, 29.5, 45.0, 70.5]);

    // extent = origin + (dims − 1)·res, must land exactly on the bbox corner.
    expect(w + (width - 1) * res).toBeCloseTo(e, 6);
    expect(s + (height - 1) * res).toBeCloseTo(n, 6);
  });

  it("is a lower-priority nest than ICON-D2 but a wider/earlier one", () => {
    const eu = getSource("icon-eu")!;
    const d2 = getSource("icon-d2")!;
    expect(eu.priority).toBeLessThan(d2.priority); // D2's 2.2 km wins in overlap
    expect(eu.minZoom!).toBeLessThan(d2.minZoom!); // EU activates sooner/wider
  });
});

describe("iconEuCandidateCycles", () => {
  it("returns 6-hourly cycles newest-first, all latency-eligible", () => {
    const now = new Date("2026-07-01T14:00:00Z");
    const cands = iconEuCandidateCycles(now);
    expect(cands.length).toBeGreaterThan(0);
    for (let i = 1; i < cands.length; i++) {
      expect(cands[i - 1].runDate.getTime()).toBeGreaterThanOrEqual(cands[i].runDate.getTime());
    }
    // ~2.5h latency: the 12z run is NOT yet eligible at 14:00Z, so newest <= 06z.
    expect(cands[0].runDate.getTime()).toBeLessThanOrEqual(Date.UTC(2026, 6, 1, 6));
    for (const c of cands) {
      expect([0, 6, 12, 18]).toContain(c.runDate.getUTCHours());
    }
  });
});

describe("iconEuLatestAvailableRun", () => {
  it("returns the newest run whose f000 t_2m probe succeeds", async () => {
    const now = new Date("2026-07-01T14:00:00Z");
    const cands = iconEuCandidateCycles(now);
    const target = cands[1]; // pretend the newest isn't published yet
    const targetUrl = buildIconEuUrl({ date: target.date, cycle: target.cycle, step: 0, field: "t_2m" });
    const fetchHead = jest.fn(async (url: string) => url === targetUrl);
    const got = await iconEuLatestAvailableRun(now, fetchHead);
    expect(got.runDate.toISOString()).toBe(target.runDate.toISOString());
  });

  it("falls back to the newest candidate when no probe succeeds", async () => {
    const now = new Date("2026-07-01T14:00:00Z");
    const cands = iconEuCandidateCycles(now);
    const got = await iconEuLatestAvailableRun(now, async () => false);
    expect(got.runDate.toISOString()).toBe(cands[0].runDate.toISOString());
  });
});
