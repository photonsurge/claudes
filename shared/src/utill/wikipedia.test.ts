import { fetchWikiSummary, fetchWikiGallery } from "./wikipedia";

describe("fetchWikiSummary", () => {
  it("returns the full-res originalimage as photo alongside the small thumbnail", async () => {
    const fetchImpl = jest.fn().mockResolvedValue({
      status: 200,
      ok: true,
      json: async () => ({
        title: "Mount Etna",
        extract: "An active volcano.",
        thumbnail: { source: "https://example.test/thumb.jpg" },
        originalimage: { source: "https://example.test/full.jpg" },
      }),
    }) as unknown as typeof fetch;

    const r = await fetchWikiSummary("Mount Etna", fetchImpl);
    expect(r).not.toBe("missing");
    expect(r).not.toBe("disambig");
    expect((r as any).thumb).toBe("https://example.test/thumb.jpg");
    expect((r as any).photo).toBe("https://example.test/full.jpg");
  });

  it("returns missing on a 404", async () => {
    const fetchImpl = jest.fn().mockResolvedValue({ status: 404, ok: false }) as unknown as typeof fetch;
    expect(await fetchWikiSummary("Nonexistent Page", fetchImpl)).toBe("missing");
  });
});

describe("fetchWikiGallery", () => {
  it("filters out flags/logos/maps/icons and resolves real photo URLs", async () => {
    const fetchImpl = jest
      .fn()
      // prop=images
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          query: {
            pages: {
              "1": {
                images: [
                  { title: "File:Commons-logo.svg" },
                  { title: "File:Flag of Italy.svg" },
                  { title: "File:Italy relief location map.jpg" },
                  { title: "File:Mount Etna 2021 eruption.jpg" },
                  { title: "File:Etna smoke seen from space.jpg" },
                ],
              },
            },
          },
        }),
      })
      // prop=imageinfo
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          query: {
            pages: {
              "10": { imageinfo: [{ thumburl: "https://example.test/etna-eruption-640.jpg" }] },
              "11": { imageinfo: [{ thumburl: "https://example.test/etna-smoke-640.jpg" }] },
            },
          },
        }),
      });

    const gallery = await fetchWikiGallery("Mount Etna", 6, 640, fetchImpl as unknown as typeof fetch);
    expect(gallery).toEqual(["https://example.test/etna-eruption-640.jpg", "https://example.test/etna-smoke-640.jpg"]);

    const [listUrl] = fetchImpl.mock.calls[0];
    expect(listUrl).toContain("prop=images");
    const [infoUrl] = fetchImpl.mock.calls[1];
    expect(infoUrl).toContain("prop=imageinfo");
    expect(infoUrl).toContain("File%3AMount%20Etna%202021%20eruption.jpg");
    expect(infoUrl).not.toContain("Commons-logo");
    expect(infoUrl).not.toContain("Flag");
  });

  it("degrades to an empty array on any failure, never throws", async () => {
    const fetchImpl = jest.fn().mockRejectedValue(new Error("network down")) as unknown as typeof fetch;
    await expect(fetchWikiGallery("Mount Etna", 6, 640, fetchImpl)).resolves.toEqual([]);
  });

  it("returns [] with no error when the article has no real photos", async () => {
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ query: { pages: { "1": { images: [{ title: "File:Flag of Italy.svg" }] } } } }),
    }) as unknown as typeof fetch;
    await expect(fetchWikiGallery("Mount Etna", 6, 640, fetchImpl)).resolves.toEqual([]);
    expect(fetchImpl).toHaveBeenCalledTimes(1); // never makes the second (imageinfo) call
  });
});
