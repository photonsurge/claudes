import { mapTflPlace } from "./tfl";

const place = {
  id: "JamCams_00001.01251",
  url: "/Place/JamCams_00001.01251",
  commonName: "A102 Blackwall Tunnel Northern App",
  lat: 51.512,
  lon: -0.001,
  additionalProperties: [
    { key: "imageUrl", value: "https://s3.eu/jamcams/00001.01251.jpg" },
    { key: "videoUrl", value: "https://s3.eu/jamcams/00001.01251.mp4" },
    { key: "available", value: "true" },
  ],
};

describe("mapTflPlace", () => {
  it("maps a JamCam Place into a canonical Cam", () => {
    const cam = mapTflPlace(place)!;
    expect(cam.camId).toBe("tfl:JamCams_00001.01251");
    expect(cam.provider).toBe("tfl");
    expect(cam.lat).toBe(51.512);
    expect(cam.lng).toBe(-0.001);
    expect(cam.status).toBe("active");
    expect(cam.imageUrl).toBe("https://s3.eu/jamcams/00001.01251.jpg");
    // .mp4 clip is inferred as a playable mp4 live stream.
    expect(cam.live).toEqual({ kind: "mp4", url: "https://s3.eu/jamcams/00001.01251.mp4" });
    expect(cam.attribution?.provider).toBe("Transport for London");
    expect(cam.tags).toContain("jamcam");
  });

  it("marks unavailable cams inactive and tolerates a missing clip", () => {
    const cam = mapTflPlace({
      ...place,
      additionalProperties: [{ key: "available", value: "false" }],
    })!;
    expect(cam.status).toBe("inactive");
    expect(cam.live).toBeUndefined();
  });

  it("returns null without an id, name or coordinates", () => {
    expect(mapTflPlace({ commonName: "no id", lat: 1, lon: 2 })).toBeNull();
    expect(mapTflPlace({ id: "x", lat: 1, lon: 2 })).toBeNull();
    expect(mapTflPlace({ id: "x", commonName: "no coords" })).toBeNull();
  });
});
