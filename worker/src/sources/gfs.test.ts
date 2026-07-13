import {
  buildNomadsUrl,
  padFhr,
  candidateCycles,
  latestAvailableRun,
  GFS_LATENCY_HOURS,
  buildGfsS3Paths,
  parseGfsIdx,
  idxLevel,
  selectIdxRanges,
  matchIdxEntries,
  GFS_S3_BASE,
} from "./gfs";

describe("padFhr", () => {
  it("zero-pads to 3 digits", () => {
    expect(padFhr(0)).toBe("000");
    expect(padFhr(3)).toBe("003");
    expect(padFhr(9)).toBe("009");
    expect(padFhr(12)).toBe("012");
    expect(padFhr(120)).toBe("120");
  });

  it("leaves 3+ digit hours untouched", () => {
    expect(padFhr(384)).toBe("384");
    expect(padFhr(1000)).toBe("1000");
  });
});

describe("buildNomadsUrl", () => {
  it("builds the expected wind URL", () => {
    const url = buildNomadsUrl({
      date: "20260628",
      cycle: "00",
      fhr: 12,
      vars: ["UGRD", "VGRD"],
      levels: ["10_m_above_ground"],
    });
    expect(url).toContain("filter_gfs_0p25.pl?");
    expect(url).toContain("file=gfs.t00z.pgrb2.0p25.f012");
    expect(url).toContain("var_UGRD=on");
    expect(url).toContain("var_VGRD=on");
    expect(url).toContain("lev_10_m_above_ground=on");
    // dir is URL-encoded
    expect(url).toContain(encodeURIComponent("/gfs.20260628/00/atmos"));
  });

  it("pads cycle and fhr", () => {
    const url = buildNomadsUrl({
      date: "20260628",
      cycle: "6",
      fhr: 0,
      vars: ["TMP"],
      levels: ["2_m_above_ground"],
    });
    expect(url).toContain("file=gfs.t06z.pgrb2.0p25.f000");
    expect(url).toContain("var_TMP=on");
  });

  it("emits params in a deterministic order: dir, file, vars..., levels...", () => {
    const url = buildNomadsUrl({
      date: "20260628",
      cycle: "12",
      fhr: 6,
      vars: ["UGRD", "VGRD"],
      levels: ["10_m_above_ground", "surface"],
    });
    const query = url.split("?")[1];
    const keys = query.split("&").map((p) => p.split("=")[0]);
    expect(keys).toEqual([
      "dir",
      "file",
      "var_UGRD",
      "var_VGRD",
      "lev_10_m_above_ground",
      "lev_surface",
    ]);
  });

  it("URL-encodes only the dir value (slashes), file stays literal", () => {
    const url = buildNomadsUrl({
      date: "20260101",
      cycle: "18",
      fhr: 120,
      vars: ["APCP"],
      levels: ["surface"],
    });
    expect(url).toContain("dir=%2Fgfs.20260101%2F18%2Fatmos");
    expect(url).toContain("file=gfs.t18z.pgrb2.0p25.f120");
    // base + ? separator
    expect(url.startsWith("https://nomads.ncep.noaa.gov/cgi-bin/filter_gfs_0p25.pl?")).toBe(true);
  });

  it("pads a single-digit numeric-string cycle to two digits in both dir and file", () => {
    const url = buildNomadsUrl({
      date: "20260628",
      cycle: "0",
      fhr: 0,
      vars: ["TMP"],
      levels: ["surface"],
    });
    expect(url).toContain(encodeURIComponent("/gfs.20260628/00/atmos"));
    expect(url).toContain("file=gfs.t00z.pgrb2.0p25.f000");
  });

  it("handles an empty vars/levels list (no var_/lev_ params)", () => {
    const url = buildNomadsUrl({
      date: "20260628",
      cycle: "00",
      fhr: 0,
      vars: [],
      levels: [],
    });
    expect(url).not.toContain("var_");
    expect(url).not.toContain("lev_");
    expect(url).toContain("file=gfs.t00z.pgrb2.0p25.f000");
  });

  it("builds a GFS-Wave URL with the wave endpoint, dir, file and .grib2 ext", () => {
    const url = buildNomadsUrl({
      date: "20260628",
      cycle: "00",
      fhr: 12,
      vars: ["HTSGW"],
      levels: ["surface"],
      product: "wave",
    });
    expect(url).toContain("filter_gfswave.pl");
    expect(url).toContain(encodeURIComponent("/gfs.20260628/00/wave/gridded"));
    expect(url).toContain("file=gfswave.t00z.global.0p25.f012.grib2");
    expect(url).toContain("var_HTSGW=on");
    expect(url).toContain("lev_surface=on");
  });

  it("defaults to the atmos product when product is omitted", () => {
    const url = buildNomadsUrl({ date: "20260628", cycle: "00", fhr: 0, vars: ["TMP"], levels: ["surface"] });
    expect(url).toContain("filter_gfs_0p25.pl");
    expect(url).not.toContain("filter_gfswave.pl");
  });
});

describe("candidateCycles", () => {
  it("excludes cycles younger than the latency window, newest first", () => {
    // 2026-06-28 05:00Z. 00Z is 5h old (>=4h latency) -> eligible.
    // Previous day 18Z is older. 06/12/18Z today are in the future.
    const now = new Date(Date.UTC(2026, 5, 28, 5, 0, 0));
    const cands = candidateCycles(now);
    expect(cands[0].date).toBe("20260628");
    expect(cands[0].cycle).toBe("00");
    // every candidate is at least latency hours old
    for (const c of cands) {
      expect(now.getTime() - c.runDate.getTime()).toBeGreaterThanOrEqual(
        GFS_LATENCY_HOURS * 3600 * 1000,
      );
    }
    // strictly decreasing in time
    for (let i = 1; i < cands.length; i++) {
      expect(cands[i - 1].runDate.getTime()).toBeGreaterThan(cands[i].runDate.getTime());
    }
  });

  it("rolls back to previous day before 04Z", () => {
    // 02:00Z: today's 00Z is only 2h old (<4h) -> not eligible; newest is prev 18Z.
    const now = new Date(Date.UTC(2026, 5, 28, 2, 0, 0));
    const cands = candidateCycles(now);
    expect(cands[0].date).toBe("20260627");
    expect(cands[0].cycle).toBe("18");
  });

  it("selects 06Z once it is old enough", () => {
    // 11:00Z: 06Z is 5h old -> eligible and newest.
    const now = new Date(Date.UTC(2026, 5, 28, 11, 0, 0));
    const cands = candidateCycles(now);
    expect(cands[0].cycle).toBe("06");
    expect(cands[0].date).toBe("20260628");
  });

  it("treats a cycle EXACTLY at the latency cutoff as eligible (>=)", () => {
    // 04:00Z: today's 00Z is exactly 4h old -> eligible (boundary inclusive).
    const now = new Date(Date.UTC(2026, 5, 28, 4, 0, 0));
    const cands = candidateCycles(now);
    expect(cands[0].date).toBe("20260628");
    expect(cands[0].cycle).toBe("00");
  });

  it("treats a cycle JUST UNDER the latency cutoff as not eligible", () => {
    // 03:59:59Z: today's 00Z is 3h59m59s old (<4h) -> falls back to prev 18Z.
    const now = new Date(Date.UTC(2026, 5, 28, 3, 59, 59));
    const cands = candidateCycles(now);
    expect(cands[0].date).toBe("20260627");
    expect(cands[0].cycle).toBe("18");
  });

  it("crosses the UTC day boundary at exactly 00:00Z", () => {
    // Midnight: today's 00Z is 0h old; newest eligible is prev day 18Z (6h old).
    const now = new Date(Date.UTC(2026, 5, 28, 0, 0, 0));
    const cands = candidateCycles(now);
    expect(cands[0].date).toBe("20260627");
    expect(cands[0].cycle).toBe("18");
  });

  it("crosses a month boundary correctly", () => {
    // 2026-07-01 02:00Z: 00Z today not eligible -> prev day is 2026-06-30 18Z.
    const now = new Date(Date.UTC(2026, 6, 1, 2, 0, 0));
    const cands = candidateCycles(now);
    expect(cands[0].date).toBe("20260630");
    expect(cands[0].cycle).toBe("18");
  });

  it("returns the requested count of candidates, newest-first", () => {
    const now = new Date(Date.UTC(2026, 5, 28, 23, 0, 0));
    const cands = candidateCycles(now, 5);
    expect(cands).toHaveLength(5);
    // today's 18Z (5h old) is newest eligible
    expect(cands[0].date).toBe("20260628");
    expect(cands[0].cycle).toBe("18");
    // 6h spacing, strictly decreasing
    for (let i = 1; i < cands.length; i++) {
      expect(cands[i - 1].runDate.getTime() - cands[i].runDate.getTime()).toBe(6 * 3600 * 1000);
    }
  });

  it("populates runDate as the nominal cycle Date (UTC)", () => {
    const now = new Date(Date.UTC(2026, 5, 28, 11, 0, 0));
    const [top] = candidateCycles(now);
    expect(top.runDate.toISOString()).toBe("2026-06-28T06:00:00.000Z");
  });
});

describe("latestAvailableRun", () => {
  it("returns the newest cycle whose probe succeeds", async () => {
    const now = new Date(Date.UTC(2026, 5, 28, 11, 0, 0));
    const probe = jest.fn().mockResolvedValue(true);
    const run = await latestAvailableRun(now, probe);
    expect(run.cycle).toBe("06");
    expect(probe).toHaveBeenCalledTimes(1);
  });

  it("falls back to an older cycle when the newest probe fails", async () => {
    const now = new Date(Date.UTC(2026, 5, 28, 11, 0, 0));
    // first (06Z) fails, second (00Z) succeeds
    const probe = jest
      .fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const run = await latestAvailableRun(now, probe);
    expect(run.cycle).toBe("00");
    expect(probe).toHaveBeenCalledTimes(2);
  });

  it("falls back to newest candidate when all probes fail", async () => {
    const now = new Date(Date.UTC(2026, 5, 28, 11, 0, 0));
    const probe = jest.fn().mockResolvedValue(false);
    const run = await latestAvailableRun(now, probe);
    expect(run.cycle).toBe("06");
  });

  it("treats a throwing probe like a failed probe and tries the next candidate", async () => {
    const now = new Date(Date.UTC(2026, 5, 28, 11, 0, 0));
    const probe = jest
      .fn()
      .mockRejectedValueOnce(new Error("network down")) // 06Z
      .mockResolvedValueOnce(true); // 00Z
    const run = await latestAvailableRun(now, probe);
    expect(run.cycle).toBe("00");
    expect(probe).toHaveBeenCalledTimes(2);
  });

  it("falls back to newest candidate when every probe throws", async () => {
    const now = new Date(Date.UTC(2026, 5, 28, 11, 0, 0));
    const probe = jest.fn().mockRejectedValue(new Error("boom"));
    const run = await latestAvailableRun(now, probe);
    expect(run.cycle).toBe("06");
    expect(run.date).toBe("20260628");
  });

  it("probes the f000 S3 .idx sidecar for the candidate cycle", async () => {
    const now = new Date(Date.UTC(2026, 5, 28, 11, 0, 0));
    const probe = jest.fn().mockResolvedValue(true);
    await latestAvailableRun(now, probe);
    const url = probe.mock.calls[0][0] as string;
    expect(url).toBe(
      `${GFS_S3_BASE}/gfs.20260628/06/atmos/gfs.t06z.pgrb2.0p25.f000.idx`,
    );
  });
});

describe("buildGfsS3Paths", () => {
  it("builds the atmos grib + .idx object URLs (no CGI, no query params)", () => {
    const { gribUrl, idxUrl } = buildGfsS3Paths({ date: "20260628", cycle: "6", fhr: 12 });
    expect(gribUrl).toBe(`${GFS_S3_BASE}/gfs.20260628/06/atmos/gfs.t06z.pgrb2.0p25.f012`);
    expect(idxUrl).toBe(`${gribUrl}.idx`);
  });

  it("builds the GFS-Wave gridded path with a .grib2 extension", () => {
    const { gribUrl, idxUrl } = buildGfsS3Paths({ date: "20260628", cycle: "00", fhr: 0, product: "wave" });
    expect(gribUrl).toBe(`${GFS_S3_BASE}/gfs.20260628/00/wave/gridded/gfswave.t00z.global.0p25.f000.grib2`);
    expect(idxUrl).toBe(`${gribUrl}.idx`);
  });

  it("builds the SECONDARY pgrb2b path (same atmos dir, 'b' file) for DUVB/UV", () => {
    const { gribUrl, idxUrl } = buildGfsS3Paths({ date: "20260628", cycle: "18", fhr: 24, product: "pgrb2b" });
    expect(gribUrl).toBe(`${GFS_S3_BASE}/gfs.20260628/18/atmos/gfs.t18z.pgrb2b.0p25.f024`);
    expect(idxUrl).toBe(`${gribUrl}.idx`);
  });
});

describe("parseGfsIdx", () => {
  const idx = [
    "1:0:d=2026071212:PRMSL:mean sea level:anl:",
    "2:1002173:d=2026071212:CLMR:1 hybrid level:anl:",
    "585:421256688:d=2026071212:UGRD:10 m above ground:anl:",
    "586:422230608:d=2026071212:VGRD:10 m above ground:anl:",
    "", // trailing blank line
  ].join("\n");

  it("parses msg/start/var/level and skips blank lines", () => {
    const e = parseGfsIdx(idx);
    expect(e).toHaveLength(4);
    expect(e[0]).toEqual({ msg: 1, start: 0, varName: "PRMSL", level: "mean sea level" });
    expect(e[2]).toEqual({ msg: 585, start: 421256688, varName: "UGRD", level: "10 m above ground" });
  });

  it("skips malformed lines (too few fields / non-numeric offset)", () => {
    const e = parseGfsIdx("garbage\n3:300:d=x:TMP:surface:anl:");
    expect(e).toEqual([{ msg: 3, start: 300, varName: "TMP", level: "surface" }]);
  });
});

describe("idxLevel", () => {
  it("converts NOMADS level tokens to their .idx spelling", () => {
    expect(idxLevel("10_m_above_ground")).toBe("10 m above ground");
    expect(idxLevel("mean_sea_level")).toBe("mean sea level");
    expect(idxLevel("surface")).toBe("surface");
    expect(idxLevel("0-0.1_m_below_ground")).toBe("0-0.1 m below ground");
  });
});

describe("selectIdxRanges", () => {
  const entries = parseGfsIdx(
    [
      "1:0:d=x:PRMSL:mean sea level:anl:",
      "2:100:d=x:UGRD:10 m above ground:anl:",
      "3:250:d=x:VGRD:10 m above ground:anl:",
      "4:400:d=x:TMP:surface:anl:",
      "5:500:d=x:TMP:2 m above ground:anl:",
      "6:650:d=x:LAND:surface:anl:",
    ].join("\n"),
  );

  it("merges the two contiguous wind messages into one Range", () => {
    // UGRD (100..249) + VGRD (250..399) are adjacent -> one Range 100-399.
    expect(selectIdxRanges(entries, ["UGRD", "VGRD"], ["10_m_above_ground"])).toEqual([
      { start: 100, end: 399 },
    ]);
  });

  it("disambiguates a repeated var by level (TMP@surface, not TMP@2m)", () => {
    expect(selectIdxRanges(entries, ["TMP"], ["surface"])).toEqual([{ start: 400, end: 499 }]);
  });

  it("keeps a masked var + its LAND field as separate (non-adjacent) ranges, last open-ended", () => {
    expect(selectIdxRanges(entries, ["TMP", "LAND"], ["surface"])).toEqual([
      { start: 400, end: 499 },
      { start: 650 }, // final message -> to EOF
    ]);
  });

  it("returns nothing when no message matches", () => {
    expect(selectIdxRanges(entries, ["ZZZZ"], ["surface"])).toEqual([]);
  });

  it("accepts a parenthesised idx level variant of the requested level", () => {
    const e = parseGfsIdx(
      "1:0:d=x:TCDC:entire atmosphere (considered as a single layer):anl:\n2:900:d=x:TMP:surface:anl:",
    );
    expect(selectIdxRanges(e, ["TCDC"], ["entire_atmosphere"])).toEqual([{ start: 0, end: 899 }]);
  });

  it("de-dupes an instant + time-average repeat of the same (var, level) to the FIRST message", () => {
    // GFS emits e.g. PRATE:surface twice — instantaneous then 0-3h average. Baking
    // both would hand wgrib2 two records for one field; keep only the first.
    const e = parseGfsIdx(
      [
        "1:0:d=x:PRATE:surface:3 hour fcst:",
        "2:500:d=x:PRATE:surface:0-3 hour ave fcst:",
        "3:900:d=x:TMP:2 m above ground:3 hour fcst:",
      ].join("\n"),
    );
    expect(matchIdxEntries(e, ["PRATE"], ["surface"])).toHaveLength(1);
    // the two PRATE messages are contiguous, so a naive matcher would merge them
    // into one range 0-899; the de-dupe keeps just the instantaneous 0-499.
    expect(selectIdxRanges(e, ["PRATE"], ["surface"])).toEqual([{ start: 0, end: 499 }]);
  });
});
