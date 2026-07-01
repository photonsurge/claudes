import { buildNomadsUrl } from "./gfs";

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
