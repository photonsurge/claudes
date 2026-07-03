import { parseKp, kpLevel } from "./kp";

describe("parseKp", () => {
  it("parses array-of-objects and returns the latest reading", () => {
    const r = parseKp([
      { time_tag: "2026-07-03T00:00:00", Kp: 2.33, a_running: 9, station_count: 8 },
      { time_tag: "2026-07-03T03:00:00", Kp: 4.67, a_running: 32, station_count: 8 },
    ]);
    expect(r).not.toBeNull();
    expect(r!.kp).toBe(4.67);
    expect(r!.time).toBe("2026-07-03T03:00:00");
    expect(r!.series).toHaveLength(2);
  });

  it("parses array-of-arrays and drops the text header row", () => {
    const r = parseKp([
      ["time_tag", "Kp", "a_running", "station_count"],
      ["2026-07-03T00:00:00", "3.00", "15", "8"],
      ["2026-07-03T03:00:00", "5.33", "48", "8"],
    ]);
    expect(r!.kp).toBe(5.33);
    expect(r!.time).toBe("2026-07-03T03:00:00");
    expect(r!.series).toHaveLength(2); // header excluded
  });

  it("caps the series to maxPoints (keeping the newest)", () => {
    const rows = Array.from({ length: 40 }, (_, i) => ({ time_tag: `t${i}`, Kp: i % 9 }));
    const r = parseKp(rows, 24);
    expect(r!.series).toHaveLength(24);
    expect(r!.series[r!.series.length - 1].time).toBe("t39");
  });

  it("returns null on junk / empty input", () => {
    expect(parseKp(null)).toBeNull();
    expect(parseKp([])).toBeNull();
    expect(parseKp([["time_tag", "Kp"]])).toBeNull(); // header only, no data
    expect(parseKp("nope")).toBeNull();
  });
});

describe("kpLevel", () => {
  it("classifies quiet vs storm on the NOAA G-scale", () => {
    expect(kpLevel(1).name).toBe("Quiet");
    expect(kpLevel(4).name).toBe("Active");
    expect(kpLevel(5).code).toBe("G1");
    expect(kpLevel(7).code).toBe("G3");
    expect(kpLevel(9).code).toBe("G5");
  });

  it("uses G1 as the storm threshold at exactly Kp 5", () => {
    expect(kpLevel(4.99).g).toBe(0);
    expect(kpLevel(5).g).toBe(1);
  });
});
