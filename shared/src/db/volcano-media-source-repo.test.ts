import type { Model } from "mongoose";
import { makeVolcanoMediaSourceRepo } from "./volcano-media-source-repo";
import type { iVolcanoMediaSourceModel } from "./volcano-media-source-model";

const definition = {
  source: "GEONET" as const,
  name: "GeoNet",
  registryUrl: "https://api.geonet.org.nz/volcano/val",
  enabled: true,
  registryPollSeconds: 3600,
};

describe("makeVolcanoMediaSourceRepo", () => {
  const repo = (updateOne: jest.Mock) =>
    makeVolcanoMediaSourceRepo({ updateOne } as unknown as Model<iVolcanoMediaSourceModel>);

  it("upsert seeds `enabled` on insert but never overwrites the operator's switch", async () => {
    const updateOne = jest.fn((..._a: any[]) => ({ exec: async () => ({}) }));
    await repo(updateOne).upsert(definition);
    const [filter, update, opts] = updateOne.mock.calls[0] as any[];

    expect(filter).toEqual({ source: "GEONET" });
    // The registry re-seeds on every boot with enabled:true. If that reached
    // `$set`, a source the operator switched off would turn itself back on.
    expect(update.$set).not.toHaveProperty("enabled");
    expect(update.$setOnInsert.enabled).toBe(true);
    expect(update.$setOnInsert.id).toEqual(expect.any(String));
    expect(opts).toEqual({ upsert: true });
  });

  it("upsert still refreshes the adapter definition", async () => {
    const updateOne = jest.fn((..._a: any[]) => ({ exec: async () => ({}) }));
    await repo(updateOne).upsert({ ...definition, name: "GeoNet (NZ)", registryPollSeconds: 900 });
    const [, update] = updateOne.mock.calls[0] as any[];
    expect(update.$set).toMatchObject({ name: "GeoNet (NZ)", registryPollSeconds: 900 });
  });

  it("setEnabled is the operator's switch", async () => {
    const updateOne = jest.fn((..._a: any[]) => ({ exec: async () => ({}) }));
    await repo(updateOne).setEnabled("GEONET", false);
    expect(updateOne.mock.calls[0]).toEqual([{ source: "GEONET" }, { $set: { enabled: false } }]);
  });

  it("listEnabledSources returns only switched-on sources", async () => {
    const find = jest.fn((..._a: any[]) => ({ lean: () => ({ exec: async () => [{ source: "GEONET" }, { source: "INGV" }] }) }));
    const sources = await makeVolcanoMediaSourceRepo({ find } as unknown as Model<iVolcanoMediaSourceModel>)
      .listEnabledSources();
    expect(find.mock.calls[0][0]).toEqual({ enabled: true });
    expect(sources).toEqual(["GEONET", "INGV"]);
  });
});
