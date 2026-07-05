import { parseChannels, parseStationNames } from "./fdsn";

describe("parseChannels", () => {
  const text = `#Network | Station | Location | Channel | Latitude | Longitude | Elevation | Depth | Azimuth | Dip | SensorDescription | Scale | ScaleFreq | ScaleUnits | SampleRate | StartTime | EndTime
IU|ANMO|00|BHZ|34.94591|-106.4572|1632.7|188.0|0.0|-90.0|Streckeisen STS-6A VBB Seismometer|1.98475E9|0.02|m/s|40.0|2018-07-09T20:45:00.0000|
IU|ANMO|10|BHZ|34.94591|-106.4572|1674.7|146.0|0.0|-90.0|Streckeisen STS-5 360 second corner|2.45954E9|0.02|m/s|40.0|2019-06-07T20:00:00.0000|
II|AAK||BHZ|42.6375|74.4942|1633.1|0.0|0.0|-90.0|Guralp CMG3T|1.02181E9|0.02|m/s|20.0|2018-01-01T00:00:00.0000|`;

  it("parses one row per open channel epoch", () => {
    const out = parseChannels(text);
    expect(out).toHaveLength(3);
    expect(out[0]).toMatchObject({ key: "IU.ANMO", loc: "00", cha: "BHZ", lat: 34.94591, lng: -106.4572, sampleRateHz: 40 });
    expect(out[2]).toMatchObject({ key: "II.AAK", loc: "", cha: "BHZ", sampleRateHz: 20 });
  });

  it("returns [] for a header-only or empty payload", () => {
    expect(parseChannels("#just a header\n")).toEqual([]);
    expect(parseChannels("")).toEqual([]);
  });

  it("skips malformed rows with too few columns", () => {
    expect(parseChannels("IU|ANMO|00|BHZ\n")).toEqual([]);
  });
});

describe("parseStationNames", () => {
  const text = `#Network | Station | Latitude | Longitude | Elevation | SiteName | StartTime | EndTime
IU|ANMO|34.94591|-106.4572|1820.0|Albuquerque, New Mexico, USA|2002-11-19T21:07:00.0000|
II|AAK|42.6375|74.4942|1645.0|Ala-Archa, Kyrgyzstan|1991-04-13T00:00:00.0000|`;

  it("maps net.sta to its human-readable site name", () => {
    const names = parseStationNames(text);
    expect(names.get("IU.ANMO")).toBe("Albuquerque, New Mexico, USA");
    expect(names.get("II.AAK")).toBe("Ala-Archa, Kyrgyzstan");
  });

  it("returns an empty map for a header-only payload", () => {
    expect(parseStationNames("#header only\n").size).toBe(0);
  });
});
