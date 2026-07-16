import type { CamSource } from "@photonsurge/shared/cams/types";
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

/**
 * Load a fresh copy of the module with the paging knobs pinned (they're read as
 * top-level consts at import), and a stubbed global.fetch.
 */
function loadWindy(env: Record<string, string>): { source: CamSource; fetchMock: jest.Mock } {
  let source!: CamSource;
  const fetchMock = jest.fn();
  jest.isolateModules(() => {
    Object.assign(process.env, {
      WINDY_WEBCAMS_API_KEY: "k",
      WINDY_PAGE_DELAY_MS: "0",
      ...env,
    });
    (global as unknown as { fetch: jest.Mock }).fetch = fetchMock;
    source = require("./windy").windySource as CamSource;
  });
  return { source, fetchMock };
}

const page = (offset: number, total: number) => ({
  ok: true,
  status: 200,
  json: async () => ({
    total,
    webcams: [
      { webcamId: offset, title: `cam ${offset}`, location: { latitude: 1, longitude: 2 } },
    ],
  }),
});

describe("windySource.fetchCatalogue paging", () => {
  const KNOWN = Object.keys(process.env);
  afterEach(() => {
    for (const k of Object.keys(process.env)) if (!KNOWN.includes(k)) delete process.env[k];
  });

  it("stops at the fixed tier offset ceiling (1000) instead of walking past it", async () => {
    // total dwarfs the ceiling; with the hard 1000 cap + PAGE=50 the last legal
    // request is offset=1000, so we expect offsets 0, 50, … 1000 and no more.
    const { source, fetchMock } = loadWindy({});
    fetchMock.mockImplementation((url: string) => {
      const off = Number(new URL(url).searchParams.get("offset"));
      return Promise.resolve(page(off, 100000));
    });

    const cams = await source.fetchCatalogue();

    const offsets = fetchMock.mock.calls.map((c) => Number(new URL(c[0]).searchParams.get("offset")));
    expect(offsets[0]).toBe(0);
    expect(offsets[offsets.length - 1]).toBe(1000); // stopped exactly at the ceiling
    expect(offsets.every((o) => o <= 1000)).toBe(true);
    expect(cams).toHaveLength(offsets.length);
  });

  it("soft-stops on the tier-limit 400 and keeps what it collected", async () => {
    // The server 400s past its ceiling; that must not throw away earlier pages.
    const { source, fetchMock } = loadWindy({});
    fetchMock.mockImplementation((url: string) => {
      const off = Number(new URL(url).searchParams.get("offset"));
      if (off >= 100) {
        const body = JSON.stringify({ message: "Offset is over API tier limit 1000!", statusCode: 400 });
        return Promise.resolve({
          ok: false,
          status: 400,
          statusText: "Bad Request",
          clone: () => ({ text: async () => body }),
        });
      }
      return Promise.resolve(page(off, 100000));
    });

    const cams = await source.fetchCatalogue();

    expect(cams).toHaveLength(2); // offsets 0 and 50 survived; the 400 was a soft stop
  });

  it("still throws on a non-tier-limit error status", async () => {
    const { source, fetchMock } = loadWindy({});
    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Server Error",
      clone: () => ({ text: async () => "boom" }),
    });

    await expect(source.fetchCatalogue()).rejects.toThrow(/Windy webcams 500/);
  });
});
