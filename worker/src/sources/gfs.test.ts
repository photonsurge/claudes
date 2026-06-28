import {
  buildNomadsUrl,
  padFhr,
  candidateCycles,
  latestAvailableRun,
  GFS_LATENCY_HOURS,
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

  it("probes f000 PRMSL/mean_sea_level for the candidate cycle", async () => {
    const now = new Date(Date.UTC(2026, 5, 28, 11, 0, 0));
    const probe = jest.fn().mockResolvedValue(true);
    await latestAvailableRun(now, probe);
    const url = probe.mock.calls[0][0] as string;
    expect(url).toContain("file=gfs.t06z.pgrb2.0p25.f000");
    expect(url).toContain("var_PRMSL=on");
    expect(url).toContain("lev_mean_sea_level=on");
  });
});
