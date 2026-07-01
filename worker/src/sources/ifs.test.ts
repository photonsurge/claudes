import {
  buildIfsUrl,
  ifsCandidateCycles,
  ifsLatestAvailableRun,
  IFS_LATENCY_HOURS,
  IFS_VAR_MATCH,
} from "./ifs";

describe("buildIfsUrl", () => {
  it("builds the ECMWF open-data step URL", () => {
    const url = buildIfsUrl({ date: "20260628", cycle: "00", step: 12 });
    expect(url).toBe(
      "https://data.ecmwf.int/forecasts/20260628/00z/ifs/0p25/oper/20260628000000-12h-oper-fc.grib2",
    );
  });

  it("zero-pads the cycle and honours f000", () => {
    const url = buildIfsUrl({ date: "20260628", cycle: "6", step: 0 });
    expect(url).toContain("/06z/ifs/0p25/oper/");
    expect(url).toContain("20260628060000-0h-oper-fc.grib2");
  });

  it("has field matches for its declared parity variables", () => {
    expect(IFS_VAR_MATCH.temp).toBeDefined();
    expect(IFS_VAR_MATCH.wind).toHaveLength(2); // u + v
    expect(IFS_VAR_MATCH.pressure).toBeDefined();
  });
});

describe("ifsCandidateCycles", () => {
  it("only offers cycles past the ~9h latency, newest-first", () => {
    // 2026-06-28T20:00Z: the 12z run is 8h old (<9h) so NOT eligible; 06z is.
    const now = new Date("2026-06-28T20:00:00Z");
    const cands = ifsCandidateCycles(now, 3);
    expect(cands[0].cycle).toBe("06");
    for (const c of cands) {
      expect(now.getTime() - c.runDate.getTime()).toBeGreaterThanOrEqual(
        IFS_LATENCY_HOURS * 3600 * 1000,
      );
    }
  });
});

describe("ifsLatestAvailableRun", () => {
  it("returns the newest cycle whose f000 probes true", async () => {
    const now = new Date("2026-06-28T23:00:00Z");
    const newest = ifsCandidateCycles(now, 1)[0];
    const okUrl = buildIfsUrl({ date: newest.date, cycle: newest.cycle, step: 0 });
    const run = await ifsLatestAvailableRun(now, async (u) => u === okUrl);
    expect(run.cycle).toBe(newest.cycle);
    expect(run.date).toBe(newest.date);
  });

  it("falls back to the newest candidate when nothing probes true", async () => {
    const now = new Date("2026-06-28T23:00:00Z");
    const run = await ifsLatestAvailableRun(now, async () => false);
    expect(run).toEqual(ifsCandidateCycles(now, 1)[0]);
  });
});
