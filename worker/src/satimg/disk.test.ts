import {
  GEO_HORIZON_COS,
  subPointCos,
  isVisibleFromGeo,
  viewFactor,
  syntheticDiskRgba,
} from "./disk";

const HIMAWARI = 140.7;

describe("geostationary disk footprint", () => {
  it("horizon cosine is ~0.151 (≈81.3° half-angle)", () => {
    expect(GEO_HORIZON_COS).toBeCloseTo(0.1513, 3);
    // arccos(0.1513) ≈ 81.3°
    expect((Math.acos(GEO_HORIZON_COS) * 180) / Math.PI).toBeCloseTo(81.3, 0);
  });

  it("sub-satellite point is dead-centre (cos = 1, fully visible, viewFactor 1)", () => {
    expect(subPointCos(0, HIMAWARI, HIMAWARI)).toBeCloseTo(1, 6);
    expect(isVisibleFromGeo(0, HIMAWARI, HIMAWARI)).toBe(true);
    expect(viewFactor(0, HIMAWARI, HIMAWARI)).toBeCloseTo(1, 6);
  });

  it("the antipode is not visible", () => {
    // Opposite side of the globe from Himawari's sub-point.
    expect(isVisibleFromGeo(0, HIMAWARI - 180, HIMAWARI)).toBe(false);
    expect(viewFactor(0, HIMAWARI - 180, HIMAWARI)).toBe(0);
  });

  it("covers its regions and excludes the far side", () => {
    // Squarely inside the disk.
    expect(isVisibleFromGeo(-25, 133, HIMAWARI)).toBe(true); // central Australia
    expect(isVisibleFromGeo(35, 139, HIMAWARI)).toBe(true); // Japan
    // Well outside — Himawari can't see the Americas / Africa interior.
    expect(isVisibleFromGeo(0, -75, HIMAWARI)).toBe(false); // Amazon
    expect(isVisibleFromGeo(0, 20, HIMAWARI)).toBe(false); // central Africa
  });

  it("the limb boundary sits ~81.3° from the sub-point", () => {
    // Just inside vs just outside the horizon along the equator.
    expect(isVisibleFromGeo(0, HIMAWARI + 81, HIMAWARI)).toBe(true);
    expect(isVisibleFromGeo(0, HIMAWARI + 82, HIMAWARI)).toBe(false);
  });

  it("synthetic RGBA is transparent outside the disk, opaque inside", () => {
    const w = 72;
    const h = 36;
    const buf = syntheticDiskRgba(w, h, HIMAWARI);
    expect(buf.length).toBe(w * h * 4);

    const alphaAt = (lon: number, lat: number) => {
      const x = Math.min(w - 1, Math.floor(((lon + 180) / 360) * w));
      const y = Math.min(h - 1, Math.floor(((90 - lat) / 180) * h));
      return buf[(y * w + x) * 4 + 3];
    };
    expect(alphaAt(HIMAWARI, 0)).toBe(255); // sub-point opaque
    expect(alphaAt(HIMAWARI - 180, 0)).toBe(0); // antipode transparent
  });
});
