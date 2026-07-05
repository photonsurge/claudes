import type { Model } from "mongoose";
import { makeTideSeriesRepo } from "./tide-series-repo";
import type { iTideSeriesModel } from "./tide-series-model";
import type { TideSeries } from "../tides/types";

const series: TideSeries = {
  stationId: "abas",
  provider: "ioc",
  name: "Abashiri",
  lng: 144.28,
  lat: 44.02,
  unit: "m",
  samples: [{ t: 1, v: 1.2 }, { t: 2, v: 1.3 }],
  latest: 1.3,
  updatedAt: 1_700_000_000_000,
};

describe("makeTideSeriesRepo", () => {
  it("upsert filters on the provider-scoped key and sets loc", async () => {
    const updateOne = jest.fn(async () => ({}));
    const repo = makeTideSeriesRepo({ updateOne } as unknown as Model<iTideSeriesModel>);
    await repo.upsert(series);
    const [filter, update, opts] = updateOne.mock.calls[0] as any[];
    expect(filter).toEqual({ key: "ioc:abas" });
    expect((update as any).$set.loc).toEqual({ type: "Point", coordinates: [144.28, 44.02] });
    expect((update as any).$set.latest).toBe(1.3);
    expect(opts).toEqual({ upsert: true });
  });

  it("nearMany returns the geoNear hits with distance in km", async () => {
    const doc = { ...series, updatedAt: new Date(series.updatedAt), distanceM: 42_000 };
    const aggregate = jest.fn(() => ({ exec: async () => [doc] }));
    const repo = makeTideSeriesRepo({ aggregate } as unknown as Model<iTideSeriesModel>);
    const near = await repo.nearMany({ lng: 144, lat: 44, maxKm: 100, limit: 4 });
    expect(near[0]?.distanceKm).toBe(42);
    expect(near[0]?.series).toMatchObject({ stationId: "abas", unit: "m", latest: 1.3 });
    // maxKm converted to metres in the $geoNear stage.
    const [stages] = aggregate.mock.calls[0] as any[];
    expect(stages[0].$geoNear.maxDistance).toBe(100_000);
    expect(stages[0].$geoNear.spherical).toBe(true);
    expect(stages[1].$limit).toBe(4);
  });

  it("nearMany returns an empty array when nothing is in range", async () => {
    const aggregate = jest.fn(() => ({ exec: async () => [] }));
    const repo = makeTideSeriesRepo({ aggregate } as unknown as Model<iTideSeriesModel>);
    expect(await repo.nearMany({ lng: 0, lat: 0, maxKm: 50 })).toEqual([]);
  });
});
