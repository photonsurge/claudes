import { satelliteToTrack, aircraftToTrack, shipToTrack, TRACK_COLORS } from "./toTrack";

describe("track converters", () => {
  it("satelliteToTrack lifts altitude km → metres and tags kind/colour", () => {
    const t = satelliteToTrack({ noradId: "25544", name: "ISS", lng: -3.6, lat: 8, altKm: 420, speedKmS: 7.66 });
    expect(t.id).toBe("sat:25544");
    expect(t.kind).toBe("satellite");
    expect(t.position).toEqual([-3.6, 8, 420000]);
    expect(t.color).toEqual(TRACK_COLORS.satellite);
  });

  it("aircraftToTrack carries heading and metre altitude", () => {
    const t = aircraftToTrack({ icao24: "abc", callsign: "BAW1", lng: 0, lat: 51, altM: 11000, headingDeg: 90, onGround: false });
    expect(t.id).toBe("ac:abc");
    expect(t.position).toEqual([0, 51, 11000]);
    expect(t.heading).toBe(90);
  });

  it("shipToTrack sits on the surface and falls back to COG for heading", () => {
    const t = shipToTrack({ mmsi: "235", name: "QM2", lng: -1.4, lat: 50, cogDeg: 215 });
    expect(t.id).toBe("ship:235");
    expect(t.position).toEqual([-1.4, 50, 0]);
    expect(t.heading).toBe(215);
  });
});
