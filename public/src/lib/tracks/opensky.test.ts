import { parseStates } from "./opensky";

// One airborne state + one with no position (should be dropped).
const SAMPLE = {
  time: 1719600000,
  states: [
    ["abc123", "BAW123  ", "United Kingdom", 1719600000, 1719600000, -0.45, 51.47, 11000, false, 250.5, 95.2, 0, null, 11277, "2000", false, 0],
    ["def456", "        ", "France", 1719600000, 1719600000, null, null, null, true, null, null, null, null, null, null, false, 0],
  ],
};

describe("parseStates", () => {
  const rows = parseStates(SAMPLE);

  it("keeps states with a position and maps the tuple", () => {
    expect(rows).toHaveLength(1);
    const a = rows[0];
    expect(a.icao24).toBe("abc123");
    expect(a.callsign).toBe("BAW123");
    expect(a.country).toBe("United Kingdom");
    expect(a.lng).toBe(-0.45);
    expect(a.lat).toBe(51.47);
    expect(a.altM).toBe(11277); // geo altitude (index 13) preferred
    expect(a.velocityMS).toBe(250.5);
    expect(a.headingDeg).toBe(95.2);
    expect(a.onGround).toBe(false);
  });

  it("drops positionless states and blanks empty callsigns", () => {
    expect(rows.find((r) => r.icao24 === "def456")).toBeUndefined();
  });

  it("returns [] for malformed input", () => {
    expect(parseStates(null)).toEqual([]);
    expect(parseStates({})).toEqual([]);
  });
});
