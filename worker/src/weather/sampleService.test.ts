import sharp from "sharp";
import { samplePointHistory, sampleAreaHistory, sampleForecastPoint } from "./sampleService";

// Coverage for the worker's frame sampling (moved here from public's old
// weather-history.test): real sharp decode of a baked scalar PNG + the series
// assembly. A stub db supplies frame metadata (listMeta) and bytes (getByID).

/** Bake a 2×2 scalar PNG (value byte into R=G=B, opaque) the way the pipeline does. */
async function scalarPng(byte: number): Promise<Buffer> {
  const raw = Buffer.alloc(2 * 2 * 4);
  for (let i = 0; i < 4; i++) {
    raw[i * 4] = byte;
    raw[i * 4 + 1] = byte;
    raw[i * 4 + 2] = byte;
    raw[i * 4 + 3] = 255;
  }
  return sharp(raw, { raw: { width: 2, height: 2, channels: 4 } }).png().toBuffer();
}

let nextId = 0;
function frameMeta(over: Record<string, unknown> = {}) {
  const id = `frame-${nextId++}`;
  return {
    id,
    model: "gfs",
    variable: "temp",
    validTime: new Date("2026-07-01T00:00:00Z"),
    run: new Date("2026-07-01T00:00:00Z"),
    fhr: 0,
    encoding: "scalar" as const,
    units: "°C",
    imageUnscale: [-90, 60] as [number, number],
    bounds: [0, 0, 10, 10],
    grid: { width: 2, height: 2, res: 10 },
    contentType: "image/png",
    byteSize: 0,
    ...over,
  };
}

/** A stub db: listMeta returns the given metas; getByID attaches each frame's bytes. */
function stubDb(metas: any[], bytesById: Record<string, Buffer>) {
  return {
    weatherFrames: {
      listMeta: async () => metas,
      getByID: async (id: string) => (bytesById[id] ? { ...metas.find((m) => m.id === id), data: bytesById[id] } : null),
    },
  } as any;
}

describe("samplePointHistory", () => {
  it("decodes each frame, samples the point, and computes stats", async () => {
    const cold = frameMeta({ validTime: new Date("2026-07-01T00:00:00Z") });
    const warm = frameMeta({ validTime: new Date("2026-07-01T03:00:00Z") });
    const db = stubDb([cold, warm], {
      [cold.id]: await scalarPng(153), // 0 °C over [-90, 60]
      [warm.id]: await scalarPng(187), // +20 °C
    });
    const out = await samplePointHistory(db, { variable: "temp", lat: 5, lng: 5 });
    expect(out.series).toHaveLength(2);
    expect(out.units).toBe("°C");
    expect(out.series[0].value).toBeCloseTo(0, 4);
    expect(out.series[1].value).toBeCloseTo(20, 4);
    expect(out.stats!.avg).toBeCloseTo(10, 4);
    expect(out.stats!.min).toBeCloseTo(0, 4);
    expect(out.stats!.max).toBeCloseTo(20, 4);
  });

  it("returns an empty series (null stats) when nothing covers the point", async () => {
    const f = frameMeta();
    const db = stubDb([f], { [f.id]: await scalarPng(153) });
    const out = await samplePointHistory(db, { variable: "temp", lat: 50, lng: 120 });
    expect(out.series).toEqual([]);
    expect(out.stats).toBeNull();
  });

  it("skips an undecodable frame instead of failing the series", async () => {
    const bad = frameMeta({ validTime: new Date("2026-07-01T00:00:00Z") });
    const good = frameMeta({ validTime: new Date("2026-07-01T03:00:00Z") });
    const db = stubDb([bad, good], {
      [bad.id]: Buffer.from("not a png"),
      [good.id]: await scalarPng(187),
    });
    const out = await samplePointHistory(db, { variable: "temp", lat: 5, lng: 5 });
    expect(out.series).toHaveLength(1);
    expect(out.series[0].value).toBeCloseTo(20, 4);
  });
});

describe("sampleAreaHistory", () => {
  it("aggregates the covered pixels to mean/min/max per frame", async () => {
    const f = frameMeta();
    const db = stubDb([f], { [f.id]: await scalarPng(187) }); // uniform +20 °C
    const out = await sampleAreaHistory(db, { variable: "temp", bbox: [0, 0, 10, 10] });
    expect(out.series).toHaveLength(1);
    expect(out.series[0].mean).toBeCloseTo(20, 4);
    expect(out.areaMin).toBeCloseTo(20, 4);
    expect(out.areaMax).toBeCloseTo(20, 4);
  });
});

/** Bake a 2×2 uv PNG the way bakeWind does: u→R, v→G, alpha 255 (or 0 = nodata). */
async function uvPng(uByte: number, vByte: number, alpha = 255): Promise<Buffer> {
  const raw = Buffer.alloc(2 * 2 * 4);
  for (let i = 0; i < 4; i++) {
    raw[i * 4] = uByte;
    raw[i * 4 + 1] = vByte;
    raw[i * 4 + 2] = 0;
    raw[i * 4 + 3] = alpha;
  }
  return sharp(raw, { raw: { width: 2, height: 2, channels: 4 } }).png().toBuffer();
}

/** A stub db over the FORECAST store (same shape the sampler uses). */
function stubForecastDb(metas: any[], bytesById: Record<string, Buffer>) {
  return {
    weatherForecastFrames: {
      listMeta: async () => metas,
      getByID: async (id: string) =>
        bytesById[id] ? { ...metas.find((m) => m.id === id), data: bytesById[id] } : null,
    },
  } as any;
}

const windMeta = (over: Record<string, unknown> = {}) =>
  frameMeta({
    variable: "wind",
    encoding: "uv" as const,
    units: "m/s",
    imageUnscale: [-128, 128] as [number, number],
    validTime: new Date(Date.now() + 3600 * 1000),
    ...over,
  });

describe("sampleForecastPoint", () => {
  it("returns SPEED plus the u/v components for a uv variable", async () => {
    // byte 148 → u ≈ +20.6 m/s, byte 108 → v ≈ -19.6 m/s over [-128, 128]
    const f = windMeta();
    const db = stubForecastDb([f], { [f.id]: await uvPng(148, 108) });
    const out = await sampleForecastPoint(db, { lat: 5, lng: 5, variables: ["wind"], maxHours: 48 });
    const [row] = out.samplesByVariable.wind;
    expect(row.u).toBeGreaterThan(19);
    expect(row.v).toBeLessThan(-18);
    expect(row.value).toBeCloseTo(Math.hypot(row.u!, row.v!), 4);
    expect(out.units.wind).toBe("m/s");
  });

  it("falls back to the coarser frame when the finer one has no data at the point", async () => {
    const validTime = new Date(Date.now() + 3600 * 1000);
    // A nest covering the same point but masked (alpha 0) there…
    const nest = windMeta({ validTime, model: "icon-eu", grid: { width: 2, height: 2, res: 1 } });
    const global = windMeta({ validTime, model: "gfs" });
    const db = stubForecastDb([nest, global], {
      [nest.id]: await uvPng(128, 128, 0),
      [global.id]: await uvPng(148, 108),
    });
    const out = await sampleForecastPoint(db, { lat: 5, lng: 5, variables: ["wind"], maxHours: 48 });
    // …must not blank the step: the global run answered it.
    expect(out.samplesByVariable.wind).toHaveLength(1);
    expect(out.samplesByVariable.wind[0].value).toBeGreaterThan(20);
  });

  it("treats a frame whose decode range was lost as nodata, not as a flat zero", async () => {
    const validTime = new Date(Date.now() + 3600 * 1000);
    const broken = windMeta({ validTime, model: "icon-eu", grid: { width: 2, height: 2, res: 1 }, imageUnscale: [0, 0] });
    const global = windMeta({ validTime, model: "gfs" });
    const db = stubForecastDb([broken, global], {
      [broken.id]: await uvPng(200, 60),
      [global.id]: await uvPng(148, 108),
    });
    const out = await sampleForecastPoint(db, { lat: 5, lng: 5, variables: ["wind"], maxHours: 48 });
    expect(out.samplesByVariable.wind[0].value).toBeGreaterThan(20);
  });

  it("drops a step only when nothing covering the point has data", async () => {
    const f = windMeta();
    const db = stubForecastDb([f], { [f.id]: await uvPng(128, 128, 0) });
    const out = await sampleForecastPoint(db, { lat: 5, lng: 5, variables: ["wind"], maxHours: 48 });
    expect(out.samplesByVariable.wind).toEqual([]);
  });
});
