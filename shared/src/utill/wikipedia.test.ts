let wiki: typeof import("./wikipedia");
beforeEach(async () => {
  jest.useFakeTimers();
  jest.resetModules();
  wiki = await import("./wikipedia");
});
afterEach(() => jest.useRealTimers());

async function finish<T>(pending: Promise<T>): Promise<T> {
  void pending.catch(() => {});
  await jest.runAllTimersAsync();
  return pending;
}
const fetchWikiSummary = (...args: Parameters<typeof wiki.fetchWikiSummary>) => finish(wiki.fetchWikiSummary(...args));
const fetchWikiGallery = (...args: Parameters<typeof wiki.fetchWikiGallery>) => finish(wiki.fetchWikiGallery(...args));

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

  it("retries a 429 and succeeds once Wikipedia stops throttling", async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce({ status: 429, ok: false, headers: { get: () => null } })
      .mockResolvedValueOnce({
        status: 200,
        ok: true,
        json: async () => ({ title: "Mount Etna", extract: "An active volcano." }),
      }) as unknown as typeof fetch;

    const r = await fetchWikiSummary("Mount Etna", fetchImpl);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(r).not.toBe("missing");
    expect(r).not.toBe("disambig");
    expect((r as any).title).toBe("Mount Etna");
  });

  it("gives up and throws after repeated 429s", async () => {
    const fetchImpl = jest.fn().mockResolvedValue({ status: 429, ok: false, headers: { get: () => null } }) as unknown as typeof fetch;
    await expect(fetchWikiSummary("Mount Etna", fetchImpl)).rejects.toThrow("HTTP 429");
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


it("honours Retry-After and blocks other enrichment calls during the cooldown", async () => {
  const start = Date.now();
  const times: number[] = [];
  const fetcher = jest.fn().mockImplementation(async () => {
    times.push(Date.now() - start);
    return times.length === 1
      ? { status: 429, headers: { get: () => "60" } }
      : { status: 200, ok: true, json: async () => ({ title: "Chile" }) };
  });
  await finish(Promise.all([
    wiki.fetchWikiSummary("Chile", fetcher),
    wiki.fetchWikiSummary("Peru", fetcher),
  ]));
  expect(times).toEqual([0, 60_000, 61_000]);
});

it("honours an HTTP-date Retry-After", async () => {
  const start = Date.now();
  const deadline = new Date(start + 90_000).toUTCString();
  const fetcher = jest.fn()
    .mockResolvedValueOnce({ status: 429, headers: { get: () => deadline } })
    .mockResolvedValueOnce({ status: 200, ok: true, json: async () => ({ title: "Chile" }) });
  await finish(wiki.fetchWikiSummary("Chile", fetcher));
  expect(Date.now()).toBeGreaterThanOrEqual(Date.parse(deadline));
});

it("keeps the cooldown after exhausted retries and releases the queue after failure", async () => {
  const start = Date.now();
  const times: number[] = [];
  const fetcher = jest.fn().mockImplementation(async () => {
    times.push(Date.now() - start);
    return times.length <= 3
      ? { status: 429, headers: { get: () => "60" } }
      : { status: 200, ok: true, json: async () => ({ title: "Peru" }) };
  });
  const result = await finish(Promise.allSettled([
    wiki.fetchWikiSummary("Chile", fetcher), wiki.fetchWikiSummary("Peru", fetcher),
  ]));
  expect(result[0].status).toBe("rejected");
  expect(result[1].status).toBe("fulfilled");
  expect(times).toEqual([0, 60_000, 120_000, 180_000]);
});
