import {
  buildUkvKey,
  buildUkvUrl,
  buildUkvRemapGrid,
  ukvRunStamp,
  ukvLeadToken,
  ukvCandidateRuns,
  ukvLatestAvailableRun,
  UKV_PARAMS,
  UKV_REMAP_GRID,
  UKV_GRID,
  UKV_BBOX,
  UKV_S3_BASE,
  UKV_PREFIX,
  UKV_LATENCY_MINUTES,
} from "./ukv";

describe("UKV S3 key/url builder (Met Office AWS mirror)", () => {
  it("builds the run-dir key for a temp f0 file", () => {
    const key = buildUkvKey({ runDate: new Date("2026-07-01T00:00:00Z"), variableId: "temp", leadMinutes: 0 });
    expect(key).toBe(
      "uk-deterministic-2km/20260701T0000Z/20260701T0000Z-PT0000H00M-temperature_at_screen_level.nc",
    );
  });

  it("builds the humidity file key with the right slug", () => {
    const key = buildUkvKey({ runDate: new Date("2026-07-01T00:00:00Z"), variableId: "humidity" });
    expect(key).toContain("-relative_humidity_at_screen_level.nc");
  });

  it("prefixes the public HTTPS mirror base (no signing)", () => {
    const url = buildUkvUrl({ runDate: new Date("2026-07-01T00:00:00Z"), variableId: "temp" });
    expect(url).toBe(`${UKV_S3_BASE}/${buildUkvKey({ runDate: new Date("2026-07-01T00:00:00Z"), variableId: "temp" })}`);
    expect(url.startsWith("https://met-office-atmospheric-model-data.s3.eu-west-2.amazonaws.com/")).toBe(true);
    expect(UKV_PREFIX).toBe("uk-deterministic-2km");
  });

  it("stamps runs hourly (YYYYMMDDTHHMMZ) and encodes lead time (PT<HHHH>H<MM>M)", () => {
    expect(ukvRunStamp(new Date("2026-07-01T03:00:00Z"))).toBe("20260701T0300Z");
    expect(ukvLeadToken(0)).toBe("PT0000H00M");
    expect(ukvLeadToken(60)).toBe("PT0001H00M");
    expect(ukvLeadToken(135)).toBe("PT0002H15M");
  });

  it("maps our vars → NetCDF names + the GRIB2 tokens cdo emits", () => {
    // NetCDF variable names (cdo -selname) are a separate namespace from GRIB2
    // -match tokens (post-remap wgrib2). Both verified from live headers.
    expect(UKV_PARAMS.temp.ncVar).toBe("air_temperature");
    expect(UKV_PARAMS.temp.match).toBe(":TMP:1.5 m above ground:");
    expect(UKV_PARAMS.humidity.ncVar).toBe("relative_humidity");
    expect(UKV_PARAMS.humidity.match).toBe(":RH:1.5 m above ground:");
  });

  it("rejects an unknown variable slug", () => {
    expect(() => buildUkvKey({ runDate: new Date("2026-07-01T00:00:00Z"), variableId: "wind" })).toThrow();
  });
});

describe("UKV cdo remap grid ↔ descriptor consistency", () => {
  it("origin/extent equal the descriptor bbox (e=w+(w-1)*res, n=s+(h-1)*res)", () => {
    const [w, s, e, n] = UKV_BBOX;
    // dims·res fills the bbox edge-to-edge (the alignment identities).
    expect(w + (UKV_GRID.width - 1) * UKV_GRID.res).toBeCloseTo(e, 9);
    expect(s + (UKV_GRID.height - 1) * UKV_GRID.res).toBeCloseTo(n, 9);
  });

  it("the remap grid-description text matches the descriptor bbox/dims/res", () => {
    const grid = buildUkvRemapGrid();
    expect(grid).toBe(UKV_REMAP_GRID);
    const kv = Object.fromEntries(
      grid.split("\n").filter(Boolean).map((line) => {
        const [k, v] = line.split("=").map((x) => x.trim());
        return [k, v];
      }),
    );
    expect(kv.gridtype).toBe("lonlat");
    expect(Number(kv.xsize)).toBe(UKV_GRID.width);
    expect(Number(kv.ysize)).toBe(UKV_GRID.height);
    expect(Number(kv.xfirst)).toBe(UKV_BBOX[0]);
    expect(Number(kv.yfirst)).toBe(UKV_BBOX[1]);
    expect(Number(kv.xinc)).toBe(UKV_GRID.res);
    expect(Number(kv.yinc)).toBe(UKV_GRID.res);
    // xfirst + (xsize-1)*xinc == E edge; yfirst + (ysize-1)*yinc == N edge.
    expect(Number(kv.xfirst) + (Number(kv.xsize) - 1) * Number(kv.xinc)).toBeCloseTo(UKV_BBOX[2], 9);
    expect(Number(kv.yfirst) + (Number(kv.ysize) - 1) * Number(kv.yinc)).toBeCloseTo(UKV_BBOX[3], 9);
  });

  it("uses ~2 km resolution and a UK-sized window", () => {
    expect(UKV_GRID.res).toBeCloseTo(0.018, 6);
    const [w, s, e, n] = UKV_BBOX;
    expect(w).toBeLessThan(e);
    expect(s).toBeLessThan(n);
    expect(w).toBeGreaterThanOrEqual(-13);
    expect(n).toBeLessThanOrEqual(61.5);
  });
});

describe("UKV latest-run resolver (hourly runs)", () => {
  it("enumerates hourly candidates newest-first, respecting latency", () => {
    const now = new Date("2026-07-01T12:00:00Z");
    const cands = ukvCandidateRuns(now);
    expect(cands.length).toBeGreaterThan(0);
    for (let i = 1; i < cands.length; i++) {
      expect(cands[i - 1].runDate.getTime()).toBeGreaterThan(cands[i].runDate.getTime());
    }
    for (const c of cands) {
      expect(now.getTime() - c.runDate.getTime()).toBeGreaterThanOrEqual(UKV_LATENCY_MINUTES * 60 * 1000);
    }
    if (cands.length >= 2) {
      expect(cands[0].runDate.getTime() - cands[1].runDate.getTime()).toBe(3600 * 1000);
    }
  });

  it("returns the newest candidate whose f0 temp file probes true", async () => {
    const now = new Date("2026-07-01T12:00:00Z");
    const cands = ukvCandidateRuns(now);
    const second = cands[1]; // skip the very newest so we exercise the walk
    const seen: string[] = [];
    const fetchHead = async (url: string) => {
      seen.push(url);
      return url.includes(second.stamp);
    };
    const run = await ukvLatestAvailableRun(now, fetchHead);
    expect(run.stamp).toBe(second.stamp);
    // Probe requests the f0 temperature file.
    expect(seen[0]).toContain("temperature_at_screen_level.nc");
    expect(seen[0]).toContain("PT0000H00M");
  });

  it("falls back to the newest candidate when nothing probes true", async () => {
    const now = new Date("2026-07-01T12:00:00Z");
    const cands = ukvCandidateRuns(now);
    const run = await ukvLatestAvailableRun(now, async () => false);
    expect(run.runDate.getTime()).toBe(cands[0].runDate.getTime());
  });
});
