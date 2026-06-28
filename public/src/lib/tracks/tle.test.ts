import { parseTle } from "./tle";

const SAMPLE = `ISS (ZARYA)
1 25544U 98067A   24001.50000000  .00016717  00000-0  10270-3 0  9005
2 25544  51.6400 208.9163 0006317  69.9862 290.1234 15.49560000    05
HST
1 20580U 90037B   24001.40000000  .00001000  00000-0  50000-4 0  9990
2 20580  28.4700 100.0000 0002800 100.0000 260.0000 15.09000000    01
`;

describe("parseTle", () => {
  const recs = parseTle(SAMPLE);

  it("parses each 3-line group with name + NORAD id", () => {
    expect(recs).toHaveLength(2);
    expect(recs[0].name).toBe("ISS (ZARYA)");
    expect(recs[0].noradId).toBe("25544");
    expect(recs[1].name).toBe("HST");
    expect(recs[1].noradId).toBe("20580");
  });

  it("keeps line1/line2 intact", () => {
    expect(recs[0].line1.startsWith("1 25544U")).toBe(true);
    expect(recs[0].line2.startsWith("2 25544")).toBe(true);
  });

  it("falls back to the catalog number when the name line is absent", () => {
    const twoLine = `1 25544U 98067A   24001.50000000  .00016717  00000-0  10270-3 0  9005
2 25544  51.6400 208.9163 0006317  69.9862 290.1234 15.49560000    05`;
    const r = parseTle(twoLine);
    expect(r).toHaveLength(1);
    expect(r[0].name).toBe("25544");
  });

  it("ignores blank lines and junk", () => {
    expect(parseTle("\n\nnot a tle\n\n")).toEqual([]);
  });
});
