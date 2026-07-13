import sharp from "sharp";
import { shiftDate, fetchGibs, fetchGibsFeed, fetchDiscLook, looksFor, dimsFor, holeFill, dataFraction, GIBS_TRUECOLOR_LAYERS } from "./gibs";

/** A real, decodable solid-colour PNG (so the per-layer merge / no-data check runs). */
const solid = (r: number, g: number, b: number, w = 8, h = 8) =>
  sharp({ create: { width: w, height: h, channels: 3, background: { r, g, b } } }).png().toBuffer();

/** Minimal Response stand-in over a real PNG buffer. */
const resp = (body: Buffer, ct = "image/png", ok = true) =>
  ({ ok, headers: { get: () => ct }, arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) }) as unknown as Response;

/** Byte-count-only Response stand-in (for the live-WMS URL-builder tests, which never decode). */
function fakeRes(bytes: number, ct = "image/png", ok = true) {
  return { ok, headers: { get: () => ct }, arrayBuffer: async () => new Uint8Array(bytes).buffer } as unknown as Response;
}

describe("shiftDate", () => {
  it("shifts UTC days and rolls over month boundaries", () => {
    expect(shiftDate("2026-07-03", -1)).toBe("2026-07-02");
    expect(shiftDate("2026-07-01", -1)).toBe("2026-06-30");
    expect(shiftDate("2026-03-01", -1)).toBe("2026-02-28");
  });
});

describe("fetchGibs", () => {
  it("composites a day's layers as SINGLE-layer requests and returns the mosaic + date/bounds", async () => {
    const data = await solid(20, 80, 60);
    const urls: string[] = [];
    const res = await fetchGibs({
      date: "2026-07-03",
      fillDays: 1,
      width: 8,
      height: 8,
      fetchImpl: (async (u: string) => {
        urls.push(u);
        return resp(data);
      }) as unknown as typeof fetch,
    });
    expect(res.date).toBe("2026-07-03");
    expect(res.bounds).toEqual([-180, -90, 180, 90]);
    expect(await dataFraction(res.png)).toBeGreaterThan(0.99);
    expect(urls[0]).toContain("TIME=2026-07-03");
    // ONE layer per request now (client-side merge), not the old stacked LAYERS=a,b,c.
    expect(urls[0]).toContain(GIBS_TRUECOLOR_LAYERS[0]);
    expect(new URL(urls[0]).searchParams.get("layers")).not.toContain(",");
  });

  it("recovers a mostly-dead day: a blank top instrument no longer blanks the mosaic", async () => {
    const black = await solid(0, 0, 0);
    const data = await solid(20, 80, 60);
    let layerCalls = 0;
    const res = await fetchGibs({
      date: "2026-07-03",
      fillDays: 1,
      width: 8,
      height: 8,
      fetchImpl: (async () => {
        layerCalls++;
        // First two instruments dark, the rest have data — the merge must fill through.
        return resp(layerCalls >= 3 ? data : black);
      }) as unknown as typeof fetch,
    });
    expect(await dataFraction(res.png)).toBeGreaterThan(0.99);
  });

  it("walks back a day when the newest day has no data anywhere", async () => {
    const black = await solid(0, 0, 0);
    const data = await solid(20, 80, 60);
    const res = await fetchGibs({
      date: "2026-07-03",
      fillDays: 1,
      width: 8,
      height: 8,
      fetchImpl: (async (u: string) => resp(u.includes("TIME=2026-07-03") ? black : data)) as unknown as typeof fetch,
    });
    expect(res.date).toBe("2026-07-02");
  });

  it("throws when nothing is available within lookback", async () => {
    const black = await solid(0, 0, 0);
    await expect(
      fetchGibs({
        date: "2026-07-03",
        lookbackDays: 1,
        width: 8,
        height: 8,
        fetchImpl: (async () => resp(black)) as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/GIBS fetch failed/);
  });
});

/** Build a 1×N RGBA PNG from a column of [r,g,b,a] pixels (top→bottom). */
function pngCol(...pixels: number[][]): Promise<Buffer> {
  const raw = Buffer.from(pixels.flat());
  return sharp(raw, { raw: { width: 1, height: pixels.length, channels: 4 } }).png().toBuffer();
}
/** Decode a PNG back to a flat RGBA byte array. */
async function rgba(png: Buffer): Promise<number[]> {
  const { data } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return Array.from(data);
}

describe("holeFill", () => {
  it("fills a solid no-data (near-black) hole from an older day, keeping fresh pixels", async () => {
    // 3px column: mid row is a solid gap bounded by real imagery above & below.
    const newest = await pngCol([0, 200, 0, 255], [0, 0, 0, 255], [0, 150, 0, 255]);
    const older = await pngCol([40, 40, 200, 255], [0, 0, 200, 255], [40, 40, 200, 255]);
    const out = await rgba(await holeFill([newest, older]));
    expect(out.slice(0, 3)).toEqual([0, 200, 0]); // fresh top untouched
    expect(out.slice(4, 7)).toEqual([0, 0, 200]); // gap filled from the older day
    expect(out.slice(8, 11)).toEqual([0, 150, 0]); // fresh bottom untouched
  });

  it("rejects a lone horizontal scan line (half-ingested granule stripe) and fills it", async () => {
    // Mid row carries data but is bounded above & below by gaps → not 'solid'.
    const newest = await pngCol([50, 50, 50, 255], [0, 0, 0, 255], [200, 200, 200, 255], [0, 0, 0, 255], [60, 60, 60, 255]);
    const older = await pngCol([30, 60, 90, 255], [30, 60, 90, 255], [40, 80, 120, 255], [30, 60, 90, 255], [30, 60, 90, 255]);
    const out = await rgba(await holeFill([newest, older]));
    // The bright stripe (row 2) is replaced by the older day's contiguous imagery…
    expect(out.slice(8, 11)).toEqual([40, 80, 120]);
    // …and its bounding gaps (rows 1,3) too.
    expect(out.slice(4, 7)).toEqual([30, 60, 90]);
    expect(out.slice(12, 15)).toEqual([30, 60, 90]);
    // Fresh edge rows are kept.
    expect(out.slice(0, 3)).toEqual([50, 50, 50]);
    expect(out.slice(16, 19)).toEqual([60, 60, 60]);
  });

  it("passes a single day through untouched", async () => {
    const only = await pngCol([1, 2, 3, 255], [4, 5, 6, 255]);
    expect(await holeFill([only])).toBe(only);
  });
});

describe("dimsFor", () => {
  it("keeps the geographic aspect at the target long-edge", () => {
    // Wide bbox → width = maxPx.
    expect(dimsFor([-150, -65, 10, 65], 1600)).toEqual({ width: 1600, height: 1300 });
    // Full globe 2:1 → width = maxPx, height = maxPx/2.
    expect(dimsFor([-180, -90, 180, 90], 2048)).toEqual({ width: 2048, height: 1024 });
  });
});

describe("fetchDiscLook", () => {
  it("GOES disc look: GIBS layer, regional bbox, STYLE=default, TRANSPARENT, NO TIME", async () => {
    let url = "";
    const r = await fetchDiscLook("goes-east", "geocolor", {
      fetchImpl: (async (u: string) => {
        url = u;
        return fakeRes(300_000);
      }) as unknown as typeof fetch,
    });
    expect(r.when).toBe("latest");
    expect(r.bounds).toEqual([-150, -65, 10, 65]);
    expect(r.cloudKey).toBe(false);
    expect(url).toContain("GOES-East_ABI_GeoColor");
    expect(url).toContain("bbox=-65%2C-150%2C65%2C10"); // S,W,N,E
    expect(url).toContain("TRANSPARENT=true");
    expect(url).toContain("STYLE=default");
    expect(url).not.toContain("TIME=");
  });

  it("Meteosat disc look: EUMETView WMS with empty STYLES (not GIBS STYLE=default)", async () => {
    let url = "";
    await fetchDiscLook("meteosat-0", "geocolor", {
      fetchImpl: (async (u: string) => {
        url = u;
        return fakeRes(500_000);
      }) as unknown as typeof fetch,
    });
    expect(url).toContain("view.eumetsat.int/geoserver/wms");
    expect(url).toContain(encodeURIComponent("mtg_fd:rgb_geocolour"));
    expect(url).toContain("STYLES=");
    expect(url).not.toContain("STYLE=default");
  });

  it("water-vapour look maps meteosat-0 to the MSG wv062 layer", async () => {
    let url = "";
    await fetchDiscLook("meteosat-0", "watervapour", {
      fetchImpl: (async (u: string) => {
        url = u;
        return fakeRes(500_000);
      }) as unknown as typeof fetch,
    });
    expect(url).toContain(encodeURIComponent("msg_fes:wv062"));
  });

  it("throws for a look a disc doesn't carry", async () => {
    await expect(fetchDiscLook("himawari", "dust")).rejects.toThrow(/no satimg look 'dust'/);
  });
});

describe("looksFor", () => {
  it("returns all of a disc's looks by default", () => {
    expect(looksFor("goes-east").sort()).toEqual(["airmass", "dust", "firetemp", "geocolor", "ir"]);
    expect(looksFor("himawari").sort()).toEqual(["airmass", "ir"]);
  });
  it("narrows to the SATIMG_BAKE_LOOKS allowlist but always keeps ir", () => {
    const prev = process.env.SATIMG_BAKE_LOOKS;
    process.env.SATIMG_BAKE_LOOKS = "geocolor";
    expect(looksFor("goes-east").sort()).toEqual(["geocolor", "ir"]);
    if (prev === undefined) delete process.env.SATIMG_BAKE_LOOKS;
    else process.env.SATIMG_BAKE_LOOKS = prev;
  });
});

describe("fetchGibsFeed", () => {
  it("lightning overlay: EUMETView li_afa layer, transparent, tiny frame allowed", async () => {
    let url = "";
    const r = await fetchGibsFeed("lightning", {
      fetchImpl: (async (u: string) => {
        url = u;
        return fakeRes(4_000); // a quiet lightning frame is small — must still pass
      }) as unknown as typeof fetch,
    });
    expect(url).toContain("view.eumetsat.int/geoserver/wms");
    expect(url).toContain(encodeURIComponent("mtg_fd:li_afa"));
    expect(url).toContain("TRANSPARENT=true");
    expect(r.bounds).toEqual([-65, -65, 65, 65]);
    expect(r.cloudKey).toBe(false);
  });

  it("throws on an unknown feed id", async () => {
    await expect(fetchGibsFeed("nope")).rejects.toThrow(/unknown satimg feed/);
  });
});
