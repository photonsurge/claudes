import sharp from "sharp";
import { buildEntityPanels, type PanelEntity } from "./samplePanels";

/** Bake a uniform scalar PNG (value into R=G=B) the way the archive stores it.
 *  With imageUnscale [-90,60]: byte 153 → 0 °C, byte 187 → +20 °C. */
async function scalarPng(width: number, height: number, byte: number): Promise<Buffer> {
  const raw = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    raw[i * 4] = byte;
    raw[i * 4 + 1] = byte;
    raw[i * 4 + 2] = byte;
    raw[i * 4 + 3] = 255;
  }
  return sharp(raw, { raw: { width, height, channels: 4 } }).png().toBuffer();
}

let nextId = 0;
async function frameOf(over: Record<string, unknown> = {}): Promise<any> {
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
    data: await scalarPng(2, 2, 153),
    byteSize: 0,
    ...over,
  };
}

/** Fake db exposing just what buildEntityPanels touches. listMeta drops the
 *  bytes (like the real repo); getByID returns the full frame for decode. */
function fakeDb(frames: any[]) {
  const getByID = jest.fn(async (id: string) => frames.find((f) => f.id === id) ?? null);
  return {
    getByID,
    db: {
      weatherFrames: {
        listMeta: async ({ variable }: { variable: string }) =>
          frames.filter((f) => f.variable === variable).map(({ data, ...meta }) => meta),
        getByID,
      },
    } as any,
  };
}

const FROM = new Date("2026-06-01T00:00:00Z");
const COVERS: PanelEntity = { id: "a", lat: 5, lng: 5, bbox: [0, 0, 10, 10] };

describe("buildEntityPanels", () => {
  it("samples point + area history and computes stats", async () => {
    const cold = await frameOf({ validTime: new Date("2026-07-01T00:00:00Z"), data: await scalarPng(2, 2, 153) }); // 0 °C
    const warm = await frameOf({ validTime: new Date("2026-07-01T03:00:00Z"), data: await scalarPng(2, 2, 187) }); // 20 °C
    const { db } = fakeDb([cold, warm]);

    const panels = await buildEntityPanels(db, [COVERS], ["temp"], FROM);
    const p = panels.get("a")!;

    expect(p.pointHistory).toHaveLength(1);
    expect(p.pointHistory[0].variable).toBe("temp");
    expect(p.pointHistory[0].units).toBe("°C");
    expect(p.pointHistory[0].series.map((s) => s.value)).toHaveLength(2);
    expect(p.pointHistory[0].series[0].value).toBeCloseTo(0, 4);
    expect(p.pointHistory[0].series[1].value).toBeCloseTo(20, 4);
    expect(p.pointHistory[0].stats!.avg).toBeCloseTo(10, 4);

    expect(p.areaHistory[0].series[0].mean).toBeCloseTo(0, 4);
    expect(p.areaHistory[0].series[1].mean).toBeCloseTo(20, 4);
    expect(p.areaHistory[0].areaMin).toBeCloseTo(0, 4);
    expect(p.areaHistory[0].areaMax).toBeCloseTo(20, 4);
  });

  it("decodes each frame ONCE even across multiple entities (the efficiency claim)", async () => {
    const cold = await frameOf({ validTime: new Date("2026-07-01T00:00:00Z") });
    const warm = await frameOf({ validTime: new Date("2026-07-01T03:00:00Z") });
    const { db, getByID } = fakeDb([cold, warm]);

    const e1: PanelEntity = { id: "e1", lat: 5, lng: 5, bbox: [0, 0, 10, 10] };
    const e2: PanelEntity = { id: "e2", lat: 3, lng: 7, bbox: [0, 0, 10, 10] };
    await buildEntityPanels(db, [e1, e2], ["temp"], FROM);

    // Two frames, two entities → still only two loads/decodes, not four.
    expect(getByID).toHaveBeenCalledTimes(2);
  });

  it("emits an empty series for an entity that no frame covers", async () => {
    const { db } = fakeDb([await frameOf()]);
    const offGrid: PanelEntity = { id: "off", lat: 80, lng: 150, bbox: [140, 70, 160, 85] };
    const panels = await buildEntityPanels(db, [offGrid], ["temp"], FROM);
    const p = panels.get("off")!;
    expect(p.pointHistory[0].series).toEqual([]);
    expect(p.pointHistory[0].stats).toBeNull();
  });

  it("skips an undecodable frame instead of failing the whole series", async () => {
    const bad = await frameOf({ data: Buffer.from("not a png") });
    const good = await frameOf({ validTime: new Date("2026-07-01T03:00:00Z") });
    const { db } = fakeDb([bad, good]);
    const panels = await buildEntityPanels(db, [COVERS], ["temp"], FROM);
    expect(panels.get("a")!.pointHistory[0].series).toHaveLength(1);
  });
});
