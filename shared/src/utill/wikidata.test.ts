import { fetchVolcanoFacts } from "./wikidata";

// Fixture values mirror a real lookup against Mount Etna (Q16990), verified live
// before writing this module: P2044 = elevation (metres), P31 = instance of
// (resolves to a type label), P793 = significant event filtered to ones
// labeled "volcanic eruption", with a P585 point-in-time qualifier for the year.
function mockSequence(fetchImpl: jest.Mock) {
  fetchImpl
    // pageprops -> wikibase_item
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({ query: { pages: { "1": { pageprops: { wikibase_item: "Q16990" } } } } }),
    })
    // Special:EntityData claims
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        entities: {
          Q16990: {
            claims: {
              P2044: [{ mainsnak: { datavalue: { value: { amount: "+3357", unit: "http://www.wikidata.org/entity/Q11573" } } } }],
              P31: [{ mainsnak: { datavalue: { value: { id: "Q169358" } } } }],
              P793: [
                {
                  mainsnak: { datavalue: { value: { id: "Q7692360" } } },
                  qualifiers: { P585: [{ datavalue: { value: { time: "+2021-00-00T00:00:00Z" } } }] },
                },
                {
                  mainsnak: { datavalue: { value: { id: "Q7692360" } } },
                  qualifiers: { P585: [{ datavalue: { value: { time: "+1669-00-00T00:00:00Z" } } }] },
                },
              ],
            },
          },
        },
      }),
    })
    // wbgetentities labels
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        entities: {
          Q169358: { labels: { en: { value: "stratovolcano" } } },
          Q7692360: { labels: { en: { value: "volcanic eruption" } } },
        },
      }),
    });
}

describe("fetchVolcanoFacts", () => {
  it("extracts elevation (metres only), type label, and the most recent eruption year", async () => {
    const fetchImpl = jest.fn() as unknown as typeof fetch;
    mockSequence(fetchImpl as unknown as jest.Mock);
    const facts = await fetchVolcanoFacts("Mount Etna", fetchImpl);
    expect(facts).toEqual({ elevationM: 3357, volcanoType: "stratovolcano", lastEruptionYear: 2021 });
  });

  it("ignores significant events that aren't labeled a volcanic eruption", async () => {
    const fetchImpl = jest.fn() as unknown as typeof fetch;
    (fetchImpl as unknown as jest.Mock)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ query: { pages: { "1": { pageprops: { wikibase_item: "Q1" } } } } }) })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          entities: {
            Q1: {
              claims: {
                P793: [
                  {
                    mainsnak: { datavalue: { value: { id: "Q999" } } },
                    qualifiers: { P585: [{ datavalue: { value: { time: "+2020-00-00T00:00:00Z" } } }] },
                  },
                ],
              },
            },
          },
        }),
      })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ entities: { Q999: { labels: { en: { value: "renamed" } } } } }) });
    const facts = await fetchVolcanoFacts("Some Mountain", fetchImpl);
    expect(facts.lastEruptionYear).toBeUndefined();
  });

  it("returns {} when the article has no Wikidata item", async () => {
    const fetchImpl = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ query: { pages: { "1": {} } } }) }) as unknown as typeof fetch;
    expect(await fetchVolcanoFacts("Untracked Place", fetchImpl)).toEqual({});
  });

  it("never throws — degrades to {} on a network error", async () => {
    const fetchImpl = jest.fn().mockRejectedValue(new Error("down")) as unknown as typeof fetch;
    await expect(fetchVolcanoFacts("Mount Etna", fetchImpl)).resolves.toEqual({});
  });
});
