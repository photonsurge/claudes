import { parsePositionReport, decodeFrame } from "./aisstream";

const MESSAGE = {
  MessageType: "PositionReport",
  MetaData: { MMSI: 235112000, ShipName: "QUEEN MARY 2   ", latitude: 50.12, longitude: -1.45 },
  Message: { PositionReport: { Latitude: 50.12, Longitude: -1.45, Sog: 18.4, Cog: 215.3, TrueHeading: 214 } },
};

describe("parsePositionReport", () => {
  it("maps an aisstream PositionReport to a Ship", () => {
    const s = parsePositionReport(MESSAGE)!;
    expect(s.mmsi).toBe("235112000");
    expect(s.name).toBe("QUEEN MARY 2");
    expect(s.lat).toBe(50.12);
    expect(s.lng).toBe(-1.45);
    expect(s.sogKn).toBe(18.4);
    expect(s.cogDeg).toBe(215.3);
    expect(s.headingDeg).toBe(214);
  });

  it("treats heading 511 (unavailable) as undefined", () => {
    const s = parsePositionReport({
      ...MESSAGE,
      Message: { PositionReport: { TrueHeading: 511 } },
    })!;
    expect(s.headingDeg).toBeUndefined();
  });

  it("returns null for non-position / malformed messages", () => {
    expect(parsePositionReport({ MessageType: "ShipStaticData" })).toBeNull();
    expect(parsePositionReport(null)).toBeNull();
  });
});

describe("decodeFrame", () => {
  const json = JSON.stringify(MESSAGE);

  it("passes through a string frame", () => {
    expect(decodeFrame(json)).toBe(json);
  });

  it("decodes an ArrayBuffer frame (Node WebSocket binaryType)", () => {
    const buf = new TextEncoder().encode(json).buffer;
    expect(decodeFrame(buf)).toBe(json);
  });

  it("decodes a Buffer / typed-array frame", () => {
    expect(decodeFrame(Buffer.from(json))).toBe(json);
  });

  it("returns '' for anything undecodable (e.g. a stray Blob)", () => {
    expect(decodeFrame({})).toBe("");
  });
});
