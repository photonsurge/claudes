import { POINT_VARS, POINT_VAR_IDS, isPointVar } from "./point-vars";
import { DEFAULT_CONTROL_STATE, mergeControlState } from "./control";

describe("point-vars catalog", () => {
  it("has unique ids and labels", () => {
    expect(new Set(POINT_VAR_IDS).size).toBe(POINT_VAR_IDS.length);
    for (const v of POINT_VARS) expect(v.label).toBeTruthy();
  });

  it("narrows known ids", () => {
    expect(isPointVar("storm")).toBe(true);
    expect(isPointVar("nope")).toBe(false);
    expect(isPointVar(1)).toBe(false);
  });

  it("groups the ocean-only series apart", () => {
    expect(POINT_VARS.find((v) => v.id === "sst")?.ocean).toBe(true);
    expect(POINT_VARS.find((v) => v.id === "temp")?.ocean).toBeUndefined();
  });
});

describe("mergeControlState pointVarsOff", () => {
  it("defaults empty and filters invalid ids", () => {
    expect(DEFAULT_CONTROL_STATE.pointVarsOff).toEqual([]);
    expect(
      mergeControlState(DEFAULT_CONTROL_STATE, { pointVarsOff: ["storm", "bogus"] as never }).pointVarsOff,
    ).toEqual(["storm"]);
  });
});
