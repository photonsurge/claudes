import { normaliseSeaPoint } from "./normalise";

describe("normaliseSeaPoint", () => {
  it("derives pointId from name and defaults enabled true / depthCycle false", () => {
    const p = normaliseSeaPoint({ name: "Niño 3.4", lat: 0, lng: -145 });
    expect(p).toEqual({
      pointId: "nino-3-4",
      name: "Niño 3.4",
      blurb: "",
      lat: 0,
      lng: -145,
      zoom: 4,
      depthCycle: false,
      enabled: true,
    });
  });

  it("rejects missing name or out-of-range coordinates", () => {
    expect(normaliseSeaPoint({ lat: 0, lng: 0 })).toBeNull();
    expect(normaliseSeaPoint({ name: "x", lat: 500, lng: 0 })).toBeNull();
    expect(normaliseSeaPoint({ name: "x", lat: 0, lng: 500 })).toBeNull();
  });

  it("keeps an explicit pointId and enabled:false", () => {
    const p = normaliseSeaPoint({ pointId: "custom", name: "x", lat: 0, lng: 0, enabled: false, depthCycle: true, zoom: 5 });
    expect(p).toMatchObject({ pointId: "custom", enabled: false, depthCycle: true, zoom: 5 });
  });
});
