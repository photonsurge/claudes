import { PNG } from "pngjs";
import {
  frameToSampleable,
  sampleFrameCached,
  pickFramesForPoint,
  buildHistorySeries,
  parseTimeParam,
} from "./weather-history";
import type { iWeatherFrameModel } from "@photonsurge/shared/db/weather-frame-model";

/** Bake a grayscale scalar PNG the way the worker does (value into R=G=B). */
function scalarPng(width: number, height: number, bytes: number[]): Buffer {
  const png = new PNG({ width, height });
  for (let i = 0; i < width * height; i++) {
    const o = i * 4;
    png.data[o] = bytes[i];
    png.data[o + 1] = bytes[i];
    png.data[o + 2] = bytes[i];
    png.data[o + 3] = 255;
  }
  return PNG.sync.write(png);
}

/** Minimal archived temp frame: 2×2 grid, [-90,60] decode range. Samples are
 *  memoised per frame id, so every fixture gets a unique id. */
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
    // byte 153 → 0 °C, byte 187 → +20 °C over [-90, 60]
    data: scalarPng(2, 2, [153, 153, 153, 153]),
    byteSize: 0,
    ...over,
  } as iWeatherFrameModel;
}

/** A FrameLoader over in-memory fixtures — the builders now take metadata + a
 *  by-id loader (they stream picked frames' bytes) rather than a pre-loaded
 *  array. The fixture frames carry `data`, so they double as both. */
function loaderFor(frames: iWeatherFrameModel[]) {
  return (id: string) => Promise.resolve(frames.find((f) => f.id === id) ?? null);
}

describe("frameToSampleable + sampling round-trip", () => {
  it("decodes a baked PNG back to physical values", async () => {
    const grid = await frameToSampleable(frameOf());
    expect(grid.width).toBe(2);
    expect(grid.rgba[0]).toBe(153);
  });

  it("memoises samples per frame+point (decode happens once)", async () => {
    const frame = frameOf();
    const first = await sampleFrameCached(frame, 5, 5);
    // Corrupt the bytes: a second call must serve the memo, not re-decode.
    frame.data = Buffer.from("not a png");
    const second = await sampleFrameCached(frame, 5, 5);
    expect(first).toEqual(second);
    expect(first!.kind).toBe("scalar");
  });
});

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

describe("buildHistorySeries", () => {
  it("samples every frame and computes stats over the values", async () => {
    const cold = frameOf({
      validTime: new Date("2026-07-01T00:00:00Z"),
      data: scalarPng(2, 2, [153, 153, 153, 153]), // 0 °C
    });
    const warm = frameOf({
      validTime: new Date("2026-07-01T03:00:00Z"),
      data: scalarPng(2, 2, [187, 187, 187, 187]), // +20 °C
    });
    const frames = [cold, warm];
    const out = await buildHistorySeries("temp", frames, 5, 5, loaderFor(frames));
    expect(out.series).toHaveLength(2);
    expect(out.units).toBe("°C");
    expect(out.series[0].value).toBeCloseTo(0, 5);
    expect(out.series[1].value).toBeCloseTo(20, 5);
    expect(out.stats!.avg).toBeCloseTo(10, 5);
    expect(out.stats!.min).toBeCloseTo(0, 5);
    expect(out.stats!.max).toBeCloseTo(20, 5);
  });

  it("returns an empty series (null stats) when nothing covers the point", async () => {
    const frames = [frameOf()];
    const out = await buildHistorySeries("temp", frames, 50, 120, loaderFor(frames));
    expect(out.series).toEqual([]);
    expect(out.stats).toBeNull();
  });

  it("skips an undecodable frame instead of failing the series", async () => {
    const bad = frameOf({ data: Buffer.from("not a png") });
    const good = frameOf({ validTime: new Date("2026-07-01T03:00:00Z") });
    const frames = [bad, good];
    const out = await buildHistorySeries("temp", frames, 5, 5, loaderFor(frames));
    expect(out.series).toHaveLength(1);
  });

  it("streams: loads bytes ONLY for the frames that cover the point (memory)", async () => {
    // One frame covers the point, one is elsewhere. The far frame is dropped by
    // pickFramesForPoint BEFORE any load, so its bytes are never fetched.
    const here = frameOf({ id: "here", validTime: new Date("2026-07-01T00:00:00Z") });
    const far = frameOf({ id: "far", bounds: [100, 0, 110, 10] });
    const frames = [here, far];
    const load = jest.fn(loaderFor(frames));
    await buildHistorySeries("temp", frames, 5, 5, load);
    expect(load).toHaveBeenCalledTimes(1);
    expect(load).toHaveBeenCalledWith("here");
  });
});

describe("parseTimeParam", () => {
  it("accepts ISO strings and epoch ms, rejects junk", () => {
    expect(parseTimeParam("2026-07-01T00:00:00Z")!.toISOString()).toBe(
      "2026-07-01T00:00:00.000Z",
    );
    expect(parseTimeParam("1751328000000")!.getTime()).toBe(1751328000000);
    expect(parseTimeParam("junk")).toBeUndefined();
    expect(parseTimeParam(null)).toBeUndefined();
  });
});
