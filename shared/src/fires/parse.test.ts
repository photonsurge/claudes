import { parseFirmsCsv } from "./firms";

const VIIRS_CSV = [
  "latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_ti5,frp,daynight",
  "-33.8688,151.2093,330.1,0.4,0.36,2026-07-03,0042,N,VIIRS,n,2.0NRT,295.3,12.4,N",
  "34.05,-118.24,367.0,0.5,0.5,2026-07-03,1319,1,VIIRS,h,2.0NRT,300.1,88.2,D",
].join("\n");

const MODIS_CSV = [
  "latitude,longitude,brightness,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_t31,frp,daynight",
  "10.5,20.5,320.0,1.0,1.0,2026-07-03,0930,Terra,MODIS,75,6.1NRT,290.0,45.0,D",
].join("\n");

describe("parseFirmsCsv", () => {
  it("parses VIIRS rows, mapping columns by header name", () => {
    const fires = parseFirmsCsv(VIIRS_CSV);
    expect(fires).toHaveLength(2);
    const [syd, la] = fires;
    expect(syd.lat).toBeCloseTo(-33.8688);
    expect(syd.lng).toBeCloseTo(151.2093);
    expect(syd.frp).toBe(12.4);
    expect(syd.brightness).toBe(330.1); // from bright_ti4
    expect(syd.daynight).toBe("N");
    expect(la.frp).toBe(88.2);
    expect(la.daynight).toBe("D");
  });

  it("folds VIIRS l/n/h confidence to 30/60/90", () => {
    const [syd, la] = parseFirmsCsv(VIIRS_CSV);
    expect(syd.confidence).toBe(60); // "n"
    expect(la.confidence).toBe(90); // "h"
  });

  it("combines acq_date + acq_time into a UTC epoch", () => {
    const [syd] = parseFirmsCsv(VIIRS_CSV);
    expect(syd.acqTime).toBe(Date.parse("2026-07-03T00:42:00Z"));
  });

  it("handles MODIS columns (brightness) + numeric confidence", () => {
    const [f] = parseFirmsCsv(MODIS_CSV);
    expect(f.brightness).toBe(320.0);
    expect(f.confidence).toBe(75);
    expect(f.satellite).toBe("Terra");
  });

  it("mints deterministic ids (same detection dedups on re-poll)", () => {
    const a = parseFirmsCsv(VIIRS_CSV)[0].id;
    const b = parseFirmsCsv(VIIRS_CSV)[0].id;
    expect(a).toBe(b);
    expect(parseFirmsCsv(VIIRS_CSV)[0].id).not.toBe(parseFirmsCsv(VIIRS_CSV)[1].id);
  });

  it("tolerates junk / empty input", () => {
    expect(parseFirmsCsv("")).toEqual([]);
    expect(parseFirmsCsv("latitude,longitude\n")).toEqual([]);
    expect(parseFirmsCsv("no,useful,columns\n1,2,3")).toEqual([]);
  });
});
