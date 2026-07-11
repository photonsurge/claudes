import mongoose from "mongoose";
import { getAlertModel } from "./alert-model";

describe("Alert indexes", () => {
  const conn = mongoose.createConnection();

  afterAll(async () => {
    await conn.destroy().catch(() => undefined);
  });

  it("keeps inactive alert history out of the bbox geo index", () => {
    const indexes = getAlertModel(conn).schema.indexes();
    const index = indexes.find(([, options]) => options.name === "alert_active_geo_ix");

    expect(index).toEqual([
      { active: 1, "info.area.geometry": "2dsphere" },
      {
        name: "alert_active_geo_ix",
        partialFilterExpression: { active: true },
        background: true,
      },
    ]);
  });
});
