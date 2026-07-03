import {
  quakeDepthClass,
  quakeDepthLabel,
  quakeDepthBlurb,
  quakeMagnitudeClass,
  quakeMagnitudeLabel,
  quakeMagnitudeBlurb,
  QUAKE_MAGNITUDE_BANDS,
  QUAKE_DEPTH_BANDS,
} from "./seismic";

describe("quakeDepthClass / labels", () => {
  it("buckets at the standard cut-offs", () => {
    expect(quakeDepthClass(10)).toBe("shallow");
    expect(quakeDepthClass(69.9)).toBe("shallow");
    expect(quakeDepthClass(70)).toBe("intermediate");
    expect(quakeDepthClass(299)).toBe("intermediate");
    expect(quakeDepthClass(300)).toBe("deep");
  });

  it("labels + blurbs come from the band table", () => {
    expect(quakeDepthLabel(10)).toBe("Shallow");
    expect(quakeDepthLabel(150)).toBe("Intermediate");
    expect(quakeDepthLabel(500)).toBe("Deep");
    expect(quakeDepthBlurb(10)).toMatch(/epicentre/i);
  });
});

describe("quakeMagnitudeClass / labels", () => {
  it("buckets each whole-magnitude step, open-ended at both ends", () => {
    expect(quakeMagnitudeClass(1.2)).toBe("micro");
    expect(quakeMagnitudeClass(2.9)).toBe("micro");
    expect(quakeMagnitudeClass(3)).toBe("minor");
    expect(quakeMagnitudeClass(4)).toBe("light");
    expect(quakeMagnitudeClass(5)).toBe("moderate");
    expect(quakeMagnitudeClass(6)).toBe("strong");
    expect(quakeMagnitudeClass(7)).toBe("major");
    expect(quakeMagnitudeClass(8)).toBe("great");
    expect(quakeMagnitudeClass(9.5)).toBe("great");
  });

  it("uses the boundary of each band inclusively", () => {
    expect(quakeMagnitudeLabel(5.9)).toBe("Moderate");
    expect(quakeMagnitudeLabel(6.0)).toBe("Strong");
  });

  it("exposes a human label + blurb per magnitude", () => {
    expect(quakeMagnitudeLabel(6.3)).toBe("Strong");
    expect(quakeMagnitudeBlurb(6.3)).toMatch(/destructive/i);
  });
});

describe("reference band tables", () => {
  it("magnitude bands are strongest-first, contiguous whole steps", () => {
    expect(QUAKE_MAGNITUDE_BANDS[0].cls).toBe("great");
    const mins = QUAKE_MAGNITUDE_BANDS.map((b) => b.min);
    // strictly descending: 8, 7, 6, 5, 4, 3, -Infinity
    for (let i = 1; i < mins.length; i++) expect(mins[i]).toBeLessThan(mins[i - 1]);
  });

  it("depth bands are shallow-first and chain their bounds", () => {
    expect(QUAKE_DEPTH_BANDS[0].cls).toBe("shallow");
    expect(QUAKE_DEPTH_BANDS[0].maxKm).toBe(QUAKE_DEPTH_BANDS[1].minKm);
    expect(QUAKE_DEPTH_BANDS[QUAKE_DEPTH_BANDS.length - 1].maxKm).toBeNull();
  });
});
