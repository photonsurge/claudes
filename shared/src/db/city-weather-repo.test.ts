import { cityBboxQuery } from "./city-weather-repo";

describe("cityBboxQuery", () => {
  it("builds a clamped lat + straight lng range for a normal box", () => {
    expect(cityBboxQuery([-8.2, 49.8, 1.8, 60.9])).toEqual({
      lat: { $gte: 49.8, $lte: 60.9 },
      lng: { $gte: -8.2, $lte: 1.8 },
    });
  });

  it("clamps latitude to [-90, 90]", () => {
    expect(cityBboxQuery([0, -120, 10, 120])).toEqual({
      lat: { $gte: -90, $lte: 90 },
      lng: { $gte: 0, $lte: 10 },
    });
  });

  it("splits an antimeridian-wrapping box (west > east) into an $or", () => {
    expect(cityBboxQuery([170, -10, -170, 10])).toEqual({
      lat: { $gte: -10, $lte: 10 },
      $or: [{ lng: { $gte: 170 } }, { lng: { $lte: -170 } }],
    });
  });
});
