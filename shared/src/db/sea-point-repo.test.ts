import type { Model } from "mongoose";
import { makeSeaPointRepo } from "./sea-point-repo";
import type { iSeaPointModel } from "./sea-point-model";
import type { SeaPoint } from "../sea-points/types";

const point: SeaPoint = {
  pointId: "nino-3-4",
  name: "Niño 3.4",
  blurb: "El Niño monitoring region — the standard ENSO index box",
  lat: 0,
  lng: -145,
  zoom: 3.5,
  depthCycle: true,
  enabled: true,
};

const storedDoc = { id: "abc", pointId: point.pointId, name: point.name, blurb: point.blurb, lat: point.lat, lng: point.lng, zoom: point.zoom, depthCycle: point.depthCycle, enabled: point.enabled };

function fakeModel(overrides: Partial<Record<"updateOne" | "findOne" | "find" | "deleteOne", jest.Mock>> = {}) {
  const updateOne = overrides.updateOne ?? jest.fn(() => ({ exec: async () => ({}) }));
  const findOne = overrides.findOne ?? jest.fn(() => ({ lean: () => ({ exec: async () => storedDoc }) }));
  const find = overrides.find ?? jest.fn(() => ({ sort: () => ({ lean: () => ({ exec: async () => [storedDoc] }) }) }));
  const deleteOne = overrides.deleteOne ?? jest.fn(() => ({ exec: async () => ({ deletedCount: 1 }) }));
  return { updateOne, findOne, find, deleteOne } as unknown as Model<iSeaPointModel>;
}

describe("makeSeaPointRepo", () => {
  it("upsertOne upserts on pointId and returns the canonical wire shape", async () => {
    const model = fakeModel();
    const repo = makeSeaPointRepo(model);
    const saved = await repo.upsertOne(point);
    expect((model.updateOne as jest.Mock).mock.calls[0][0]).toEqual({ pointId: "nino-3-4" });
    const update = (model.updateOne as jest.Mock).mock.calls[0][1];
    expect(update.$set.loc).toEqual({ type: "Point", coordinates: [-145, 0] });
    expect(saved).toEqual(point);
  });

  it("list returns all points name-sorted", async () => {
    const model = fakeModel();
    const repo = makeSeaPointRepo(model);
    const rows = await repo.list();
    expect(rows).toEqual([point]);
  });

  it("getByPointId returns null when not found", async () => {
    const model = fakeModel({ findOne: jest.fn(() => ({ lean: () => ({ exec: async () => null }) })) });
    const repo = makeSeaPointRepo(model);
    expect(await repo.getByPointId("nope")).toBeNull();
  });

  it("remove reports whether a document was actually deleted", async () => {
    const model = fakeModel({ deleteOne: jest.fn(() => ({ exec: async () => ({ deletedCount: 0 }) })) });
    const repo = makeSeaPointRepo(model);
    expect(await repo.remove("nope")).toBe(false);
  });
});
