import sharp from "sharp";
import { fetchSatelliteFrame, frameDataFraction } from "./frame";

/** A real, decodable solid-colour PNG (so the no-data pixel check actually runs). */
const solidPng = (r: number, g: number, b: number, w = 64, h = 64) =>
  sharp({ create: { width: w, height: h, channels: 3, background: { r, g, b } } }).png().toBuffer();

/** Minimal `fetch`-shaped Response over a PNG buffer. */
const resp = (body: Buffer, { ok = true, contentType = "image/png" } = {}) =>
  ({
    ok,
    headers: { get: (h: string) => (h.toLowerCase() === "content-type" ? contentType : null) },
    arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength),
  }) as unknown as Response;

const BOUNDS: [number, number, number, number] = [-10, 40, 10, 60]; // w,s,e,n (20°×20°)
const layerOf = (u: string) => new URL(u).searchParams.get("layers")!;
const dayOf = (u: string) => new URL(u).searchParams.get("TIME")!;

describe("fetchSatelliteFrame", () => {
  it("returns a frame for the newest usable day and maps every field", async () => {
    const data = await solidPng(20, 80, 60);
    const urls: string[] = [];
    const fetchImpl = (async (u: string) => {
      urls.push(u);
      return resp(data);
    }) as unknown as typeof fetch;

    const frame = await fetchSatelliteFrame(BOUNDS, { date: "2026-07-11", fetchImpl });
    expect(frame).not.toBeNull();
    expect(frame!.bounds).toEqual(BOUNDS);
    expect(frame!.view).toBe("truecolor");
    expect(frame!.layers.length).toBeGreaterThan(0);
    expect(Math.max(frame!.width, frame!.height)).toBe(1024); // square bbox → long edge = default
    expect(frame!.observationTime.toISOString()).toBe("2026-07-11T00:00:00.000Z");
    // A fully-covering first layer short-circuits the composite → one request.
    expect(urls).toHaveLength(1);
    expect(dayOf(urls[0])).toBe("2026-07-11");
  });

  it("emits a WMS 1.3.0 single-layer GetMap with S,W,N,E axis order and the requested day", async () => {
    const data = await solidPng(20, 80, 60);
    let seen = "";
    const fetchImpl = (async (u: string) => {
      seen = u;
      return resp(data);
    }) as unknown as typeof fetch;

    await fetchSatelliteFrame(BOUNDS, { date: "2026-07-11", fetchImpl });
    const q = new URL(seen).searchParams;
    expect(q.get("version")).toBe("1.3.0");
    expect(q.get("request")).toBe("GetMap");
    expect(q.get("CRS")).toBe("EPSG:4326");
    expect(q.get("TIME")).toBe("2026-07-11");
    expect(q.get("bbox")).toBe("40,-10,60,10"); // south,west,north,east
    expect(q.get("layers")).not.toContain(","); // ONE layer per request, not a stack
  });

  it("composites past a DEAD top layer instead of blanking (the VIIRS_SNPP-went-dark bug)", async () => {
    // The real failure: the first layer(s) return blank no-data, a later one has imagery.
    // A single stacked request would go black; the client-side merge must recover it.
    const black = await solidPng(0, 0, 0);
    const data = await solidPng(20, 80, 60);
    const layers: string[] = [];
    const fetchImpl = (async (u: string) => {
      const layer = layerOf(u);
      layers.push(layer);
      // First two instruments are dark, the third carries data.
      return resp(layers.length >= 3 ? data : black);
    }) as unknown as typeof fetch;

    const frame = await fetchSatelliteFrame(BOUNDS, { date: "2026-07-11", fetchImpl });
    expect(frame).not.toBeNull();
    expect(await frameDataFraction(frame!.png)).toBeGreaterThan(0.99); // recovered, not black
    expect(layers.length).toBeGreaterThanOrEqual(3); // it kept trying layers until data appeared
  });

  it("walks back a day when EVERY layer is blank/unpublished, to the next day with data", async () => {
    const black = await solidPng(0, 0, 0);
    const data = await solidPng(20, 80, 60);
    const days: string[] = [];
    const fetchImpl = (async (u: string) => {
      const day = dayOf(u);
      days.push(day);
      return resp(day === "2026-07-11" ? black : data); // newest day all-blank
    }) as unknown as typeof fetch;

    const frame = await fetchSatelliteFrame(BOUNDS, { date: "2026-07-11", fetchImpl });
    expect(frame!.observationTime.toISOString()).toBe("2026-07-10T00:00:00.000Z");
    expect(days).toContain("2026-07-11"); // it tried the newest day first
    expect(days).toContain("2026-07-10");
  });

  it("skips an XML ServiceException layer response and keeps compositing", async () => {
    const data = await solidPng(20, 80, 60);
    const fetchImpl = (async (u: string) => {
      const layer = new URL(u).searchParams.get("layers")!;
      // The first instrument 500s into an XML error; the next one is fine.
      return layer.startsWith("VIIRS_NOAA21")
        ? resp(Buffer.from("<ServiceExceptionReport/>"), { contentType: "text/xml" })
        : resp(data);
    }) as unknown as typeof fetch;
    const frame = await fetchSatelliteFrame(BOUNDS, { date: "2026-07-11", fetchImpl });
    expect(frame).not.toBeNull();
    expect(await frameDataFraction(frame!.png)).toBeGreaterThan(0.99);
  });

  it("gives up as null when every day in the window is all-black no-data (e.g. polar night)", async () => {
    const black = await solidPng(0, 0, 0);
    const fetchImpl = (async () => resp(black)) as unknown as typeof fetch;
    const frame = await fetchSatelliteFrame(BOUNDS, { date: "2026-07-11", lookbackDays: 2, fetchImpl });
    expect(frame).toBeNull();
  });

  it("frameDataFraction: ~0 for black, ~1 for real imagery, fails open on garbage", async () => {
    expect(await frameDataFraction(await solidPng(0, 0, 0))).toBeLessThan(0.02);
    expect(await frameDataFraction(await solidPng(20, 80, 60))).toBeGreaterThan(0.99);
    expect(await frameDataFraction(Buffer.alloc(500, 0x7f))).toBe(1); // undecodable → fail open
  });
});
