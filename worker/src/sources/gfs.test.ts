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
    expect(padFhr(12)).toBe("012");
    expect(padFhr(120)).toBe("120");
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
});
