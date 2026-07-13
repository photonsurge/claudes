import sharp from "sharp";
import { fetchSatelliteFrame, frameDataFraction } from "./frame";

/** A real, decodable solid-colour PNG (so the no-data pixel check actually runs). */
const solidPng = (r: number, g: number, b: number, w = 64, h = 64) =>
  sharp({ create: { width: w, height: h, channels: 3, background: { r, g, b } } }).png().toBuffer();

/** Minimal `fetch`-shaped Response over a body + content-type. */
const resp = (body: Buffer, { ok = true, contentType = "image/png" } = {}) =>
  ({
    ok,
    headers: { get: (h: string) => (h.toLowerCase() === "content-type" ? contentType : null) },
    arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength),
  }) as unknown as Response;

const pngOf = (bytes: number) => Buffer.alloc(bytes, 0x7f);
const BOUNDS: [number, number, number, number] = [-10, 40, 10, 60]; // w,s,e,n (20°×20°)

describe("fetchSatelliteFrame", () => {
  it("returns a frame for the newest usable day and maps every field", async () => {
    const urls: string[] = [];
    const fetchImpl = (async (u: string) => {
      urls.push(u);
      return resp(pngOf(8_000));
    }) as unknown as typeof fetch;

    const frame = await fetchSatelliteFrame(BOUNDS, { date: "2026-07-11", fetchImpl });
    expect(frame).not.toBeNull();
    expect(frame!.png.length).toBe(8_000);
    expect(frame!.bounds).toEqual(BOUNDS);
    expect(frame!.view).toBe("truecolor");
    expect(frame!.layers.length).toBeGreaterThan(0);
    // Square-ish bbox → square-ish dims, long edge = default 1024.
    expect(Math.max(frame!.width, frame!.height)).toBe(1024);
    // Served the base day (no walk-back needed).
    expect(frame!.observationTime.toISOString()).toBe("2026-07-11T00:00:00.000Z");
    expect(urls).toHaveLength(1);
  });

  it("emits a WMS 1.3.0 GetMap URL with S,W,N,E axis order and the requested day", async () => {
    let seen = "";
    const fetchImpl = (async (u: string) => {
      seen = u;
      return resp(pngOf(8_000));
    }) as unknown as typeof fetch;

    await fetchSatelliteFrame(BOUNDS, { date: "2026-07-11", fetchImpl });
    const q = new URL(seen).searchParams;
    expect(q.get("version")).toBe("1.3.0");
    expect(q.get("request")).toBe("GetMap");
    expect(q.get("CRS")).toBe("EPSG:4326");
    expect(q.get("TIME")).toBe("2026-07-11");
    // bbox = south,west,north,east for EPSG:4326 in WMS 1.3.0.
    expect(q.get("bbox")).toBe("40,-10,60,10");
  });

  it("walks back past a not-yet-published (XML) day to the next older PNG", async () => {
    const days: string[] = [];
    const fetchImpl = (async (u: string) => {
      const day = new URL(u).searchParams.get("TIME")!;
      days.push(day);
      // Newest day still returns the WMS ServiceException XML; the day before is ready.
      return day === "2026-07-11"
        ? resp(Buffer.from("<ServiceExceptionReport/>"), { contentType: "text/xml" })
        : resp(pngOf(8_000));
    }) as unknown as typeof fetch;

    const frame = await fetchSatelliteFrame(BOUNDS, { date: "2026-07-11", fetchImpl });
    expect(days).toEqual(["2026-07-11", "2026-07-10"]);
    expect(frame!.observationTime.toISOString()).toBe("2026-07-10T00:00:00.000Z");
  });

  it("treats a suspiciously tiny body as empty and keeps walking back", async () => {
    const fetchImpl = (async (u: string) => {
      const day = new URL(u).searchParams.get("TIME")!;
      return day === "2026-07-11" ? resp(pngOf(500)) : resp(pngOf(8_000));
    }) as unknown as typeof fetch;

    const frame = await fetchSatelliteFrame(BOUNDS, { date: "2026-07-11", fetchImpl });
    expect(frame!.observationTime.toISOString()).toBe("2026-07-10T00:00:00.000Z");
  });

  it("treats a valid-but-all-black no-data frame as empty and walks back", async () => {
    const black = await solidPng(0, 0, 0);
    const real = await solidPng(20, 80, 60); // daytime imagery carries real, non-zero pixels
    const days: string[] = [];
    const fetchImpl = (async (u: string) => {
      const day = new URL(u).searchParams.get("TIME")!;
      days.push(day);
      // Newest day is a solid-black GIBS no-data response; the day before has imagery.
      return resp(day === "2026-07-11" ? black : real);
    }) as unknown as typeof fetch;

    // minBytes:0 so the tiny solid PNGs reach the no-data pixel check.
    const frame = await fetchSatelliteFrame(BOUNDS, { date: "2026-07-11", minBytes: 0, fetchImpl });
    expect(days).toEqual(["2026-07-11", "2026-07-10"]);
    expect(frame!.observationTime.toISOString()).toBe("2026-07-10T00:00:00.000Z");
  });

  it("gives up as null when every day in the window is all-black no-data", async () => {
    const black = await solidPng(0, 0, 0);
    const fetchImpl = (async () => resp(black)) as unknown as typeof fetch;
    const frame = await fetchSatelliteFrame(BOUNDS, { date: "2026-07-11", lookbackDays: 2, minBytes: 0, fetchImpl });
    expect(frame).toBeNull();
  });

  it("frameDataFraction: ~0 for black, ~1 for real imagery, fails open on garbage", async () => {
    expect(await frameDataFraction(await solidPng(0, 0, 0))).toBeLessThan(0.02);
    expect(await frameDataFraction(await solidPng(20, 80, 60))).toBeGreaterThan(0.99);
    // An undecodable buffer can't be judged → fail open (don't drop a frame we can't read).
    expect(await frameDataFraction(Buffer.alloc(500, 0x7f))).toBe(1);
  });

  it("skips non-ok responses and thrown fetches, then gives up as null within lookback", async () => {
    const tried: string[] = [];
    const fetchImpl = (async (u: string) => {
      const day = new URL(u).searchParams.get("TIME")!;
      tried.push(day);
      if (day === "2026-07-11") return resp(pngOf(8_000), { ok: false });
      throw new Error("network");
    }) as unknown as typeof fetch;

    const frame = await fetchSatelliteFrame(BOUNDS, { date: "2026-07-11", lookbackDays: 2, fetchImpl });
    expect(frame).toBeNull();
    // base + 2 look-back days = 3 attempts, all unusable.
    expect(tried).toEqual(["2026-07-11", "2026-07-10", "2026-07-09"]);
  });
});
