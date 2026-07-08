import { reportForPlace, type VariableFrame } from "./aggregate";
import type { FrameLike } from "@photonsurge/shared/weather/sample";

const rgbaOf = (pixels: number[][]): Uint8Array => Uint8Array.from(pixels.flat());

/** 4×3 regional grid over [0,0,30,20], res 10; identity decode (byte === value). */
function makeFrame(bytes: number[]): FrameLike {
  return {
    encoding: "scalar",
    imageUnscale: [0, 255],
    rgba: rgbaOf(bytes.map((b) => [b, b, b, 255])),
    width: 4,
    height: 3,
    bounds: [0, 0, 30, 20],
    res: 10,
  };
}

describe("reportForPlace", () => {
  const bbox: [number, number, number, number] = [0, 0, 30, 20];

  it("aggregates every variable's stats over the whole bbox with no mask", () => {
    const frames: VariableFrame[] = [
      { variable: "temp", units: "°C", frame: makeFrame([0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110]) },
    ];
    const { stats } = reportForPlace(bbox, null, frames);
    expect(stats).toHaveLength(1);
    expect(stats[0]).toMatchObject({ variable: "temp", units: "°C", min: 0, max: 110, count: 12 });
    expect(stats[0].mean).toBeCloseTo(55, 5);
  });

  it("restricts stats to pixels inside a mask", () => {
    const frames: VariableFrame[] = [
      { variable: "temp", units: "°C", frame: makeFrame([0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110]) },
    ];
    // Western two columns only (lng <= 10).
    const mask = (_lat: number, lng: number) => lng <= 10;
    const { stats } = reportForPlace(bbox, mask, frames);
    expect(stats[0]).toMatchObject({ min: 0, max: 90, count: 6 });
  });

  it("drops a variable whose frame misses the bbox entirely", () => {
    const missingFrame: FrameLike = { ...makeFrame([1]), bounds: [100, 0, 130, 20] };
    const frames: VariableFrame[] = [
      { variable: "temp", units: "°C", frame: makeFrame([50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50]) },
      { variable: "gust", units: "m/s", frame: missingFrame },
    ];
    const { stats } = reportForPlace(bbox, null, frames);
    expect(stats.map((s) => s.variable)).toEqual(["temp"]);
  });

  it("derives hazard flags from the variable min/max via the shared forecast-hazard rules", () => {
    // Every pixel byte 45 -> decoded 45°C (identity scale) = EXTREME HEAT (>=40).
    const frames: VariableFrame[] = [
      { variable: "temp", units: "°C", frame: makeFrame(new Array(12).fill(45)) },
    ];
    const { hazards } = reportForPlace(bbox, null, frames);
    expect(hazards).toEqual([{ hazard: "heat", severityRank: 3, label: "EXTREME HEAT" }]);
  });

  it("returns no stats/hazards when every frame misses", () => {
    const missingFrame: FrameLike = { ...makeFrame([1]), bounds: [100, 0, 130, 20] };
    const { stats, hazards } = reportForPlace(bbox, null, [{ variable: "temp", units: "°C", frame: missingFrame }]);
    expect(stats).toEqual([]);
    expect(hazards).toEqual([]);
  });
});
