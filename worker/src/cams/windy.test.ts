import { mapWindyWebcam } from "./windy";

const webcam = {
  webcamId: 1234567,
  title: "Zermatt - Matterhorn",
  status: "active",
  location: { city: "Zermatt", country: "Switzerland", latitude: 45.976, longitude: 7.658 },
  categories: [{ id: "mountain", name: "Mountain" }],
  images: { current: { preview: "https://img/preview.jpg", thumbnail: "https://img/thumb.jpg" } },
  // v3 player values are plain embed-URL strings.
  player: { day: "https://windy/embed/day", live: "https://windy/embed/live" },
  urls: { detail: "https://www.windy.com/webcams/1234567" },
};

describe("mapWindyWebcam", () => {
  it("maps a v3 webcam into a canonical Cam with required attribution", () => {
    const cam = mapWindyWebcam(webcam)!;
    expect(cam.camId).toBe("windy:1234567");
    expect(cam.provider).toBe("windy");
    expect(cam.lat).toBe(45.976);
    expect(cam.lng).toBe(7.658);
    expect(cam.place).toBe("Zermatt, Switzerland");
    expect(cam.imageUrl).toBe("https://img/preview.jpg");
    // Prefers the live player embed, surfaced as an iframe for the viewer.
    expect(cam.live).toEqual({ kind: "iframe", url: "https://windy/embed/live" });
    expect(cam.playerUrl).toBe("https://windy/embed/live");
    expect(cam.attribution).toEqual({
      provider: "windy.com",
      requiredText: "Webcams provided by windy.com",
      linkUrl: "https://www.windy.com/webcams/1234567",
    });
    expect(cam.tags).toEqual(["Mountain"]);
  });

  it("falls back to the day-player embed and the thumbnail", () => {
    const cam = mapWindyWebcam({
      ...webcam,
      images: { current: { thumbnail: "https://img/thumb.jpg" } },
      player: { day: "https://windy/embed/day" },
    })!;
    expect(cam.imageUrl).toBe("https://img/thumb.jpg");
    expect(cam.live).toEqual({ kind: "iframe", url: "https://windy/embed/day" });
  });

  it("returns null without an id, title or coordinates", () => {
    expect(mapWindyWebcam({ title: "x", location: { latitude: 1, longitude: 2 } })).toBeNull();
    expect(mapWindyWebcam({ webcamId: 1, location: { latitude: 1, longitude: 2 } })).toBeNull();
    expect(mapWindyWebcam({ webcamId: 1, title: "x", location: {} })).toBeNull();
  });
});
