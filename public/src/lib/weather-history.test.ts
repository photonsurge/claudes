import { pickFramesForPoint, parseTimeParam } from "./weather-history";
import type { iWeatherFrameModel } from "@photonsurge/shared/db/weather-frame-model";

// The frame DECODE + series building moved to the worker (sampleService.ts); what
// remains public-side is the pure frame-pick math + time parsing. Decode/sample
// coverage now lives in worker/src/weather/sampleService.test.ts and the shared
// weather/sample tests.

/** Minimal frame META (no bytes — pickFramesForPoint only reads grid/bounds/time). */
let nextId = 0;
function frameOf(over: Partial<iWeatherFrameModel> = {}): iWeatherFrameModel {
  const id = `frame-${nextId++}`;
  return {
    id,
    _id: id,
    model: "gfs",
    variable: "temp",
    validTime: new Date("2026-07-01T00:00:00Z"),
    run: new Date("2026-07-01T00:00:00Z"),
    fhr: 0,
    encoding: "scalar",
    units: "°C",
    imageUnscale: [-90, 60],
    bounds: [0, 0, 10, 10],
    grid: { width: 2, height: 2, res: 10 },
    contentType: "image/png",
    byteSize: 0,
    ...over,
  } as iWeatherFrameModel;
}

describe("pickFramesForPoint", () => {
  it("prefers the finest-resolution frame covering the point, per valid time", () => {
    const coarse = frameOf({ id: "coarse" });
    const fine = frameOf({
      id: "fine",
      model: "nest",
      grid: { width: 4, height: 4, res: 2.5 },
      bounds: [0, 0, 10, 10],
    });
    const elsewhere = frameOf({ id: "far", model: "other", bounds: [100, 0, 110, 10] });
    const picked = pickFramesForPoint([coarse, fine, elsewhere], 5, 5);
    expect(picked.map((f) => f.id)).toEqual(["fine"]);
  });

  it("sorts kept frames by valid time", () => {
    const a = frameOf({ id: "a", validTime: new Date("2026-07-02T00:00:00Z") });
    const b = frameOf({ id: "b", validTime: new Date("2026-07-01T00:00:00Z") });
    expect(pickFramesForPoint([a, b], 5, 5).map((f) => f.id)).toEqual(["b", "a"]);
  });
});

describe("parseTimeParam", () => {
  it("accepts ISO strings and epoch ms, rejects junk", () => {
    expect(parseTimeParam("2026-07-01T00:00:00Z")!.toISOString()).toBe("2026-07-01T00:00:00.000Z");
    expect(parseTimeParam("1751328000000")!.getTime()).toBe(1751328000000);
    expect(parseTimeParam("junk")).toBeUndefined();
    expect(parseTimeParam(null)).toBeUndefined();
  });
});
