import {
  buildIconD2Url,
  padIconD2Step,
  ICON_D2_VAR_TOKENS,
  ICON_D2_FIELD_MATCH,
  iconD2CandidateCycles,
  iconD2LatestAvailableRun,
} from "./iconD2";

describe("buildIconD2Url", () => {
  it("builds the DWD open-data regular-lat-lon .grib2.bz2 URL for a known input", () => {
    const url = buildIconD2Url({ date: "20260701", cycle: "00", step: 1, field: "t_2m" });
    expect(url).toBe(
      "https://opendata.dwd.de/weather/nwp/icon-d2/grib/00/t_2m/" +
        "icon-d2_germany_regular-lat-lon_single-level_2026070100_001_2d_t_2m.grib2.bz2",
    );
  });

  it("zero-pads the cycle and the 3-digit forecast step", () => {
    const url = buildIconD2Url({ date: "20260701", cycle: "3", step: 12, field: "u_10m" });
    expect(url).toContain("/grib/03/u_10m/");
    expect(url).toContain("_2026070103_012_2d_u_10m.grib2.bz2");
  });

  it("routes each field into its own <var> directory segment", () => {
    for (const field of ["t_2m", "u_10m", "v_10m", "vmax_10m"]) {
      const url = buildIconD2Url({ date: "20260701", cycle: "12", step: 0, field });
      expect(url).toContain(`/grib/12/${field}/`);
      expect(url).toContain(`_000_2d_${field}.grib2.bz2`);
      expect(url).toContain("regular-lat-lon");
    }
  });
});

describe("padIconD2Step", () => {
  it("pads to 3 digits", () => {
    expect(padIconD2Step(0)).toBe("000");
    expect(padIconD2Step(7)).toBe("007");
    expect(padIconD2Step(48)).toBe("048");
    expect(padIconD2Step(120)).toBe("120");
  });
});

describe("ICON_D2 variable → DWD field token map", () => {
  it("maps our variable ids to the correct DWD field tokens", () => {
    expect(ICON_D2_VAR_TOKENS.temp).toEqual(["t_2m"]);
    expect(ICON_D2_VAR_TOKENS.wind).toEqual(["u_10m", "v_10m"]);
    expect(ICON_D2_VAR_TOKENS.gust).toEqual(["vmax_10m"]);
    expect(ICON_D2_VAR_TOKENS.humidity).toEqual(["relhum_2m"]);
  });

  it("covers exactly the four source variables (temp/wind/gust/humidity)", () => {
    expect(Object.keys(ICON_D2_VAR_TOKENS).sort()).toEqual(["gust", "humidity", "temp", "wind"]);
  });

  it("provides a wgrib2 -match token for every field it references", () => {
    for (const fields of Object.values(ICON_D2_VAR_TOKENS)) {
      for (const field of fields) {
        expect(typeof ICON_D2_FIELD_MATCH[field]).toBe("string");
        expect(ICON_D2_FIELD_MATCH[field].length).toBeGreaterThan(0);
      }
    }
  });
});

describe("iconD2CandidateCycles", () => {
  it("returns 3-hourly cycles newest-first, all latency-eligible", () => {
    const now = new Date("2026-07-01T14:00:00Z");
    const cands = iconD2CandidateCycles(now);
    expect(cands.length).toBeGreaterThan(0);
    // newest-first ordering
    for (let i = 1; i < cands.length; i++) {
      expect(cands[i - 1].runDate.getTime()).toBeGreaterThanOrEqual(cands[i].runDate.getTime());
    }
    // ~2h latency: the 12z run is eligible at 14:00Z, but the newest is <= 12z.
    expect(cands[0].runDate.getTime()).toBeLessThanOrEqual(Date.UTC(2026, 6, 1, 12));
    // every candidate cycle hour is a valid 3-hourly ICON-D2 run
    for (const c of cands) {
      expect([0, 3, 6, 9, 12, 15, 18, 21]).toContain(c.runDate.getUTCHours());
    }
  });
});

describe("iconD2LatestAvailableRun", () => {
  it("returns the newest run whose f000 t_2m probe succeeds", async () => {
    const now = new Date("2026-07-01T14:00:00Z");
    const cands = iconD2CandidateCycles(now);
    const target = cands[1]; // pretend the newest isn't published yet
    const targetUrl = buildIconD2Url({ date: target.date, cycle: target.cycle, step: 0, field: "t_2m" });
    const fetchHead = jest.fn(async (url: string) => url === targetUrl);
    const got = await iconD2LatestAvailableRun(now, fetchHead);
    expect(got.runDate.toISOString()).toBe(target.runDate.toISOString());
  });

  it("falls back to the newest candidate when no probe succeeds", async () => {
    const now = new Date("2026-07-01T14:00:00Z");
    const cands = iconD2CandidateCycles(now);
    const got = await iconD2LatestAvailableRun(now, async () => false);
    expect(got.runDate.toISOString()).toBe(cands[0].runDate.toISOString());
  });
});
