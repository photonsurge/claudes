import {
  buildWaveNestUrl,
  buildWaveNestNewGrid,
  waveNestTile,
  waveNestTiles,
  WAVE_NEST_TOKENS,
  WAVE_MATCH,
  padWaveFhr,
} from "./waveNests";
import { getSource } from "@photonsurge/shared/sources";

const NEST_IDS = Object.keys(WAVE_NEST_TOKENS);

describe("buildWaveNestUrl", () => {
  it("builds the direct NOMADS production URL for a basin (atlocn.0p16)", () => {
    const url = buildWaveNestUrl({ date: "20260628", cycle: "00", fhr: 24, grid: "atlocn.0p16" });
    expect(url).toBe(
      "https://nomads.ncep.noaa.gov/pub/data/nccf/com/gfs/prod/gfs.20260628/00/wave/gridded/gfswave.t00z.atlocn.0p16.f024.grib2",
    );
  });

  it("zero-pads the cycle and the 3-digit forecast hour", () => {
    const url = buildWaveNestUrl({ date: "20260628", cycle: "6", fhr: 6, grid: "epacif.0p16" });
    expect(url).toContain("/gfs.20260628/06/wave/gridded/");
    expect(url).toContain("gfswave.t06z.epacif.0p16.f006.grib2");
  });

  it("lives under the same wave/gridded dir as the mosaic tiles", () => {
    for (const grid of Object.values(WAVE_NEST_TOKENS)) {
      const url = buildWaveNestUrl({ date: "20260628", cycle: "12", fhr: 0, grid });
      expect(url).toContain("/wave/gridded/");
      expect(url).toContain(`gfswave.t12z.${grid}.f000.grib2`);
    }
  });
});

describe("shared helpers re-exported", () => {
  it("uses the HTSGW surface match", () => {
    expect(WAVE_MATCH).toBe(":HTSGW:surface:");
  });
  it("pads forecast hours to 3 digits", () => {
    expect(padWaveFhr(0)).toBe("000");
    expect(padWaveFhr(24)).toBe("024");
    expect(padWaveFhr(120)).toBe("120");
  });
});

describe("WAVE_NEST_TOKENS", () => {
  it("maps each descriptor id to a <basin>.0p16 token", () => {
    expect(WAVE_NEST_TOKENS["gfswave-atlocn"]).toBe("atlocn.0p16");
    expect(WAVE_NEST_TOKENS["gfswave-epacif"]).toBe("epacif.0p16");
    expect(WAVE_NEST_TOKENS["gfswave-wcoast"]).toBe("wcoast.0p16");
    expect(WAVE_NEST_TOKENS["gfswave-ecg"]).toBe("ecg.0p16");
  });

  it("every token is a registered nest source declaring minZoom + wave", () => {
    for (const id of NEST_IDS) {
      const s = getSource(id);
      expect(s).toBeDefined();
      expect(s!.minZoom).toBeDefined(); // treated as a NEST (isNestSource)
      expect(s!.variables).toContain("wave");
      expect(typeof s!.enabled).toBe("boolean");
    }
  });

  it("enables the atlocn + wcoast basins; epacif (antimeridian-crossing) and ecg (no upstream grid) are disabled", () => {
    expect(getSource("gfswave-atlocn")!.enabled).toBe(true);
    expect(getSource("gfswave-wcoast")!.enabled).toBe(true);
    // epacif.0p16 is lon 130→215 (130°E → 155°W) — crosses the antimeridian, which
    // the −180..180 W<E subset/bake can't express yet. See sources.waveNests.ts.
    expect(getSource("gfswave-epacif")!.enabled).toBe(false);
    // ecg 0p16 does not exist upstream (404s) — atlocn already covers it. See sources.waveNests.ts.
    expect(getSource("gfswave-ecg")!.enabled).toBe(false);
  });
});

describe("region → bbox table (waveNestTiles)", () => {
  const tiles = waveNestTiles();

  it("returns one tile per token", () => {
    expect(tiles.map((t) => t.sourceId).sort()).toEqual([...NEST_IDS].sort());
  });

  // Enabled basins must be plain −180..180 W<E windows (epacif is disabled precisely
  // because it crosses the antimeridian, so it's excluded from the strict range check).
  const ENABLED_IDS = NEST_IDS.filter((id) => getSource(id)!.enabled);

  it.each(ENABLED_IDS)("%s bbox is well-formed (W<E, S<N) and finer than 0.25° global", (id) => {
    const t = waveNestTile(id);
    const [w, s, e, n] = t.bbox;
    expect(t.bbox).toHaveLength(4);
    expect(w).toBeLessThan(e);
    expect(s).toBeLessThan(n);
    // Regional windows, not global.
    expect(w).toBeGreaterThanOrEqual(-180);
    expect(e).toBeLessThanOrEqual(180);
    expect(s).toBeGreaterThanOrEqual(-90);
    expect(n).toBeLessThanOrEqual(90);
    expect(e - w).toBeLessThan(360);
    expect(n - s).toBeLessThan(180);
    // 1/6° basins are strictly finer than the 0.25° global wave base.
    expect(t.res).toBeCloseTo(1 / 6, 5);
    expect(t.res).toBeLessThan(0.25);
  });

  it("derives dims spanning the bbox at ~0.16° (matches the descriptor dims)", () => {
    for (const t of tiles) {
      const s = getSource(t.sourceId)!;
      expect(t.dims).toEqual(s.dims);
      const [w, sN, e, n] = t.bbox;
      // width/height points span the bbox edge-to-edge at ~res°.
      expect(t.dims.width).toBe(Math.round((e - w) / t.res) + 1);
      expect(t.dims.height).toBe(Math.round((n - sN) / t.res) + 1);
      expect(t.dims.width).toBeGreaterThan(1);
      expect(t.dims.height).toBeGreaterThan(1);
    }
  });

  it("outranks the global wave mosaic in priority (native basin wins in overlap)", () => {
    const mosaic = getSource("gfswave-mosaic")!;
    for (const id of NEST_IDS) {
      expect(getSource(id)!.priority).toBeGreaterThan(mosaic.priority);
    }
  });
});

describe("buildWaveNestNewGrid", () => {
  it("builds a wgrib2 -new_grid latlon spec with the SW corner + point counts", () => {
    const bbox: [number, number, number, number] = [-98, 0, 10, 65];
    const dims = { width: Math.round((10 - -98) / 0.16) + 1, height: Math.round((65 - 0) / 0.16) + 1 };
    const spec = buildWaveNestNewGrid(bbox, dims);
    // latlon lon0:nx:dlon lat0:ny:dlat — lon0/lat0 are the SW corner.
    expect(spec).toMatch(/^latlon -98:\d+:[\d.]+ 0:\d+:[\d.]+$/);
    const [, lonPart, latPart] = spec.split(" ");
    expect(Number(lonPart.split(":")[1])).toBe(dims.width);
    expect(Number(latPart.split(":")[1])).toBe(dims.height);
    // dlon/dlat land near 0.16°.
    expect(Number(lonPart.split(":")[2])).toBeCloseTo(0.16, 2);
    expect(Number(latPart.split(":")[2])).toBeCloseTo(0.16, 2);
  });

  it("accepts a negative lon0 directly (bounded regional window)", () => {
    const t = waveNestTile("gfswave-wcoast");
    expect(t.newgrid.startsWith(`latlon ${t.bbox[0]}:`)).toBe(true);
    expect(t.bbox[0]).toBeLessThan(0);
  });
});
