import {
  normaliseCam,
  normaliseLive,
  normaliseAttribution,
  youtubeId,
  isValidLat,
  isValidLng,
} from "./normalise";

describe("isValidLat / isValidLng", () => {
  it("accepts in-range coordinates", () => {
    expect(isValidLat(45.1)).toBe(true);
    expect(isValidLng(-179.9)).toBe(true);
    expect(isValidLat(-90)).toBe(true);
    expect(isValidLng(180)).toBe(true);
  });
  it("rejects out-of-range, NaN and non-numbers", () => {
    expect(isValidLat(91)).toBe(false);
    expect(isValidLng(181)).toBe(false);
    expect(isValidLat(Number.NaN)).toBe(false);
    expect(isValidLng("12" as unknown)).toBe(false);
  });
});

describe("youtubeId", () => {
  it("extracts the id from common URL shapes and a bare id", () => {
    expect(youtubeId("dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(youtubeId("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=3")).toBe("dQw4w9WgXcQ");
    expect(youtubeId("https://youtu.be/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(youtubeId("https://www.youtube.com/embed/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(youtubeId("https://www.youtube.com/live/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
  });
  it("returns undefined for non-youtube input", () => {
    expect(youtubeId("https://example.com/stream.m3u8")).toBeUndefined();
  });
});

describe("normaliseLive", () => {
  it("infers youtube and stores the bare id", () => {
    expect(normaliseLive({ url: "https://youtu.be/dQw4w9WgXcQ" })).toEqual({
      kind: "youtube",
      url: "dQw4w9WgXcQ",
    });
  });
  it("infers hls and mp4 from the extension", () => {
    expect(normaliseLive({ url: "https://x/y.m3u8" })).toEqual({ kind: "hls", url: "https://x/y.m3u8" });
    expect(normaliseLive({ url: "https://x/y.mp4?t=1" })).toEqual({ kind: "mp4", url: "https://x/y.mp4?t=1" });
  });
  it("falls back to iframe for anything else", () => {
    expect(normaliseLive({ url: "https://x/embed" })).toEqual({ kind: "iframe", url: "https://x/embed" });
  });
  it("honours an explicit valid kind", () => {
    expect(normaliseLive({ kind: "hls", url: "https://x/manifest" })).toEqual({
      kind: "hls",
      url: "https://x/manifest",
    });
  });
  it("returns undefined when there is no url", () => {
    expect(normaliseLive(undefined)).toBeUndefined();
    expect(normaliseLive({ url: "  " })).toBeUndefined();
  });
});

describe("normaliseAttribution", () => {
  it("builds a clean block and trims fields", () => {
    expect(
      normaliseAttribution({ provider: " windy.com ", requiredText: "Webcams provided by windy.com", linkUrl: " https://x " }),
    ).toEqual({ provider: "windy.com", requiredText: "Webcams provided by windy.com", linkUrl: "https://x" });
  });
  it("drops attribution without a provider", () => {
    expect(normaliseAttribution({ linkUrl: "https://x" })).toBeUndefined();
    expect(normaliseAttribution(undefined)).toBeUndefined();
  });
});

describe("normaliseCam", () => {
  const base = { camId: "abc", title: "Harbour cam", lat: 50, lng: 0 };

  it("keeps the new tfl/national_highways providers and carries attribution", () => {
    const tfl = normaliseCam({ ...base, provider: "tfl" });
    expect(tfl?.provider).toBe("tfl");
    const nh = normaliseCam({ ...base, provider: "national_highways" });
    expect(nh?.provider).toBe("national_highways");
    const withAttr = normaliseCam({
      ...base,
      attribution: { provider: "windy.com", requiredText: "Webcams provided by windy.com" },
    });
    expect(withAttr?.attribution).toEqual({
      provider: "windy.com",
      requiredText: "Webcams provided by windy.com",
      linkUrl: undefined,
    });
  });

  it("normalises a minimal valid record with defaults", () => {
    expect(normaliseCam({ ...base })).toEqual({
      camId: "abc",
      provider: "manual",
      title: "Harbour cam",
      lat: 50,
      lng: 0,
      status: "unknown",
      place: undefined,
      country: undefined,
      imageUrl: undefined,
      timelapseUrl: undefined,
      playerUrl: undefined,
      live: undefined,
      tags: undefined,
      fetchedAt: undefined,
    });
  });

  it("accepts `id`/`name` aliases for camId/title", () => {
    const cam = normaliseCam({ id: "x", name: "Beach", lat: 1, lng: 2 });
    expect(cam?.camId).toBe("x");
    expect(cam?.title).toBe("Beach");
  });

  it("rejects missing id/title and bad coordinates", () => {
    expect(normaliseCam({ title: "no id", lat: 0, lng: 0 })).toBeNull();
    expect(normaliseCam({ camId: "x", title: "no coords" })).toBeNull();
    expect(normaliseCam({ camId: "x", title: "bad", lat: 200, lng: 0 })).toBeNull();
  });

  it("coerces unknown provider/status to defaults and dedups tags", () => {
    const cam = normaliseCam({
      ...base,
      provider: "bogus",
      status: "live",
      tags: ["a", "a", " b ", ""],
    });
    expect(cam?.provider).toBe("manual");
    expect(cam?.status).toBe("unknown");
    expect(cam?.tags).toEqual(["a", "b"]);
  });

  it("carries a normalised live stream and trims strings", () => {
    const cam = normaliseCam({
      ...base,
      provider: "youtube",
      status: "active",
      place: "  Dover  ",
      live: { url: "https://youtu.be/dQw4w9WgXcQ" },
    });
    expect(cam?.place).toBe("Dover");
    expect(cam?.live).toEqual({ kind: "youtube", url: "dQw4w9WgXcQ" });
  });
});
