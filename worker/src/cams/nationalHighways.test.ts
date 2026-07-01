import { mapNationalHighwaysCamera } from "./nationalHighways";

describe("mapNationalHighwaysCamera", () => {
  it("maps a camera record into a canonical Cam", () => {
    const cam = mapNationalHighwaysCamera({
      id: "CCTV-M25-4823A",
      name: "M25 J10 A3",
      latitude: 51.31,
      longitude: -0.44,
      imageUrl: "https://nh/cctv/4823A.jpg",
      available: true,
    })!;
    expect(cam.camId).toBe("nh:CCTV-M25-4823A");
    expect(cam.provider).toBe("national_highways");
    expect(cam.status).toBe("active");
    expect(cam.imageUrl).toBe("https://nh/cctv/4823A.jpg");
    expect(cam.tags).toContain("motorway");
    expect(cam.attribution?.provider).toBe("National Highways");
  });

  it("accepts reference/lat/lng aliases and defaults status to unknown", () => {
    const cam = mapNationalHighwaysCamera({
      reference: "REF1",
      title: "A1(M)",
      lat: 53.9,
      lng: -1.1,
    })!;
    expect(cam.camId).toBe("nh:REF1");
    expect(cam.status).toBe("unknown");
  });

  it("returns null without an id, name or coordinates", () => {
    expect(mapNationalHighwaysCamera({ name: "no id", lat: 1, lng: 2 })).toBeNull();
    expect(mapNationalHighwaysCamera({ id: "x", lat: 1, lng: 2 })).toBeNull();
    expect(mapNationalHighwaysCamera({ id: "x", name: "no coords" })).toBeNull();
  });
});
