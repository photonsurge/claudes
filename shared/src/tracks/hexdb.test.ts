import { fetchAircraftMeta } from "./hexdb";

const okResponse = (body: unknown) =>
  ({ ok: true, json: async () => body }) as unknown as Response;

describe("fetchAircraftMeta", () => {
  it("maps a hexdb record to registration/type/operator", async () => {
    const fetchImpl = jest.fn().mockResolvedValue(
      okResponse({
        Registration: "EI-DWG",
        Type: "Boeing 737-8AS",
        ICAOTypeCode: "B738",
        Manufacturer: "Boeing",
        RegisteredOwners: "Ryanair",
      }),
    );
    const meta = await fetchAircraftMeta("4ca1fa", fetchImpl as unknown as typeof fetch);
    expect(meta).toEqual({
      registration: "EI-DWG",
      type: "Boeing 737-8AS",
      typeCode: "B738",
      manufacturer: "Boeing",
      operator: "Ryanair",
    });
    // upper-cased hex in the URL
    expect((fetchImpl.mock.calls[0][0] as string)).toContain("4CA1FA");
  });

  it("returns null for an invalid hex without calling the network", async () => {
    const fetchImpl = jest.fn();
    expect(await fetchAircraftMeta("zzz", fetchImpl as unknown as typeof fetch)).toBeNull();
    expect(await fetchAircraftMeta("", fetchImpl as unknown as typeof fetch)).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("returns null on a non-OK response or empty record", async () => {
    const notOk = jest.fn().mockResolvedValue({ ok: false } as Response);
    expect(await fetchAircraftMeta("4ca1fa", notOk as unknown as typeof fetch)).toBeNull();

    const empty = jest.fn().mockResolvedValue(okResponse({ ICAOTypeCode: "B738" }));
    expect(await fetchAircraftMeta("4ca1fa", empty as unknown as typeof fetch)).toBeNull();
  });

  it("returns null on a network error", async () => {
    const boom = jest.fn().mockRejectedValue(new Error("network"));
    expect(await fetchAircraftMeta("4ca1fa", boom as unknown as typeof fetch)).toBeNull();
  });
});
