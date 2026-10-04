import type { Model } from "mongoose";
import { makeRoundupSettingsRepo } from "./roundup-settings-repo";
import { ROUNDUP_SETTINGS_ID, type iRoundupSettingsModel } from "./roundup-settings-model";
import { DEFAULT_ROUNDUP_SETTINGS } from "../roundup-settings";

/** A minimal chainable query stub that resolves `.exec()` to `result`. */
const query = (result: unknown) => {
  const q: Record<string, unknown> = {};
  q.lean = jest.fn(() => q);
  q.exec = jest.fn(async () => result);
  return q;
};

describe("makeRoundupSettingsRepo", () => {
  it("get() returns fresh defaults when there is no document, without writing", async () => {
    const findOne = jest.fn(() => query(null));
    const updateOne = jest.fn();
    const model = { findOne, updateOne } as unknown as Model<iRoundupSettingsModel>;

    const out = await makeRoundupSettingsRepo(model).get();
    expect(findOne).toHaveBeenCalledWith({ id: ROUNDUP_SETTINGS_ID });
    expect(out).toEqual(DEFAULT_ROUNDUP_SETTINGS);
    expect(out["global-12h"]).not.toBe(DEFAULT_ROUNDUP_SETTINGS["global-12h"]);
    expect(updateOne).not.toHaveBeenCalled();
  });

  it("get() sanitises the stored document", async () => {
    const doc = {
      id: ROUNDUP_SETTINGS_ID,
      settings: { "global-daily": { enabled: false, hours: [5, 5, 99] }, stale: { enabled: true } },
    };
    const model = { findOne: jest.fn(() => query(doc)) } as unknown as Model<iRoundupSettingsModel>;

    const out = await makeRoundupSettingsRepo(model).get();
    expect(out["global-daily"]).toEqual({ enabled: false, hours: [5] });
    expect(out["place-country"]).toEqual({ enabled: true, hours: [6, 18] });
    expect(out).not.toHaveProperty("stale");
  });

  it("save() sanitises, upserts the singleton and returns what was stored", async () => {
    const updateOne = jest.fn(() => ({ exec: async () => ({}) }));
    const model = { updateOne } as unknown as Model<iRoundupSettingsModel>;

    const out = await makeRoundupSettingsRepo(model).save({
      "place-region": { enabled: false, hours: [18, 6, 30] },
    });
    expect(out["place-region"]).toEqual({ enabled: false, hours: [6, 18] });
    expect(updateOne).toHaveBeenCalledWith(
      { id: ROUNDUP_SETTINGS_ID },
      { $set: { settings: out }, $setOnInsert: { id: ROUNDUP_SETTINGS_ID } },
      { upsert: true },
    );
  });
});
