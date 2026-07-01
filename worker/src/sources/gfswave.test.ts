import { buildNomadsUrl } from "./gfs";
import { buildWaveTileUrl, WAVE_TILES, WAVE_MATCH, WAVE_MOSAIC_GRID } from "./gfswave";

describe("GFS-Wave URL (buildNomadsUrl product=wave)", () => {
  it("defaults to the legacy 0.25° grid file", () => {
    const url = buildNomadsUrl({
      date: "20260628",
      cycle: "00",
      fhr: 24,
      vars: ["HTSGW"],
      levels: ["surface"],
      product: "wave",
    });
    expect(url).toContain("filter_gfswave.pl");
    expect(url).toContain("dir=%2Fgfs.20260628%2F00%2Fwave%2Fgridded");
    expect(url).toContain("file=gfswave.t00z.global.0p25.f024.grib2");
  });

  it("selects the finer 0.16° grid file when waveRes=0p16", () => {
    const url = buildNomadsUrl({
      date: "20260628",
      cycle: "12",
      fhr: 6,
      vars: ["HTSGW"],
      levels: ["surface"],
      product: "wave",
      waveRes: "0p16",
    });
    expect(url).toContain("file=gfswave.t12z.global.0p16.f006.grib2");
  });

  it("leaves the atmos product untouched (no waveRes)", () => {
    const url = buildNomadsUrl({
      date: "20260628",
      cycle: "00",
      fhr: 12,
      vars: ["TMP"],
      levels: ["2_m_above_ground"],
    });
    expect(url).toContain("file=gfs.t00z.pgrb2.0p25.f012");
    expect(url).not.toContain("global");
  });
});

describe("GFS-Wave regional tiles (mosaic inputs)", () => {
  it("builds the direct NOMADS production URL per tile", () => {
    const url = buildWaveTileUrl({ date: "20260628", cycle: "00", fhr: 24, grid: "global.0p16" });
    expect(url).toBe(
      "https://nomads.ncep.noaa.gov/pub/data/nccf/com/gfs/prod/gfs.20260628/00/wave/gridded/gfswave.t00z.global.0p16.f024.grib2",
    );
  });

  it("tiles cover the whole planet in latitude (poles + mid-lat band)", () => {
    const south = Math.min(...WAVE_TILES.map((t) => t.bbox[1]));
    const north = Math.max(...WAVE_TILES.map((t) => t.bbox[3]));
    expect(south).toBeLessThanOrEqual(-89);
    expect(north).toBeGreaterThanOrEqual(89);
    // global.0p16 is the finest mid-lat band and outranks the polar fillers.
    const band = WAVE_TILES.find((t) => t.grid === "global.0p16")!;
    expect(band.priority).toBe(Math.max(...WAVE_TILES.map((t) => t.priority)));
  });

  it("uses the HTSGW match and a global 1/6° target grid", () => {
    expect(WAVE_MATCH).toBe(":HTSGW:surface:");
    expect(WAVE_MOSAIC_GRID.width).toBe(2160);
    expect(WAVE_MOSAIC_GRID.height).toBe(1081);
  });
});
