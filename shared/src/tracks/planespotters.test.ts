import { fetchAircraftPhoto } from "./planespotters";

const okResponse = (body: unknown) =>
  ({ ok: true, json: async () => body }) as unknown as Response;

const photoBody = {
  photos: [
    {
      id: "123",
      thumbnail: { src: "https://cdn.planespotters.net/small.jpg", size: { width: 200, height: 133 } },
      thumbnail_large: { src: "https://cdn.planespotters.net/large.jpg", size: { width: 400, height: 267 } },
      link: "https://www.planespotters.net/photo/123",
      photographer: "Jane Doe",
    },
  ],
};

describe("fetchAircraftPhoto", () => {
  it("maps the first photo, preferring the large thumbnail", async () => {
    const fetchImpl = jest.fn().mockResolvedValue(okResponse(photoBody));
    const photo = await fetchAircraftPhoto("A835AF", fetchImpl as unknown as typeof fetch);
    expect(photo).toEqual({
      photoUrl: "https://cdn.planespotters.net/large.jpg",
      photoCredit: "Jane Doe",
      photoLink: "https://www.planespotters.net/photo/123",
    });
    // lower-cased hex in the URL
    expect(fetchImpl.mock.calls[0][0] as string).toContain("a835af");
  });

  it("falls back to the small thumbnail when there's no large one", async () => {
    const body = { photos: [{ thumbnail: { src: "https://cdn/small.jpg" } }] };
    const fetchImpl = jest.fn().mockResolvedValue(okResponse(body));
    const photo = await fetchAircraftPhoto("a835af", fetchImpl as unknown as typeof fetch);
    expect(photo?.photoUrl).toBe("https://cdn/small.jpg");
  });

  it("returns null for an invalid hex without calling the network", async () => {
    const fetchImpl = jest.fn();
    expect(await fetchAircraftPhoto("zzz", fetchImpl as unknown as typeof fetch)).toBeNull();
    expect(await fetchAircraftPhoto("", fetchImpl as unknown as typeof fetch)).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("returns null when there are no photos", async () => {
    const fetchImpl = jest.fn().mockResolvedValue(okResponse({ photos: [] }));
    expect(await fetchAircraftPhoto("a835af", fetchImpl as unknown as typeof fetch)).toBeNull();
  });

  it("returns null on a non-OK response or a network error", async () => {
    const notOk = jest.fn().mockResolvedValue({ ok: false } as Response);
    expect(await fetchAircraftPhoto("a835af", notOk as unknown as typeof fetch)).toBeNull();
    const boom = jest.fn().mockRejectedValue(new Error("network"));
    expect(await fetchAircraftPhoto("a835af", boom as unknown as typeof fetch)).toBeNull();
  });
});
