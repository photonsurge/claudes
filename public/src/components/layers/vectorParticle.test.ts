import type { WeatherManifest } from "@photonsurge/shared/manifest";
import { vectorParticleProps, windParticleProps } from "./props";

const manifest: WeatherManifest = {
  model: "gfs",
  run: "2026-06-28T12:00:00.000Z",
  bounds: [-180, -90, 180, 90],
  grid: { width: 1440, height: 721, res: 0.25 },
  steps: [{ validTime: "2026-06-28T12:00:00Z", fhr: 0 }],
  variables: {
    wind: {
      encoding: "uv",
      units: "m/s",
      imageUnscale: [-30, 30],
      files: { "0": "/api/weather/tex/w0" },
    },
    current: {
      encoding: "uv",
      units: "m/s",
      domain: [0, 3],
      palette: "current",
      vectorUnscale: [-3, 3],
      sourceId: "rtofs",
      files: { "0": "/api/weather/tex/c0" },
    },
  },
};

describe("vectorParticleProps", () => {
  it("decodes wind via imageUnscale (legacy field)", () => {
    const p = vectorParticleProps(manifest, "wind", 0)!;
    expect(p).not.toBeNull();
    expect(p.id).toBe("wind-0");
    expect(p.image).toBe("/api/weather/tex/w0");
    expect(p.imageUnscale).toEqual([-30, 30]);
    expect(p.palette).toBeUndefined(); // flat colour by default
  });

  it("is visible unless told otherwise (a hidden layer stays mounted)", () => {
    expect(vectorParticleProps(manifest, "wind", 0)!.visible).toBe(true);
    expect(vectorParticleProps(manifest, "wind", 0, { visible: false })!.visible).toBe(false);
  });

  it("decodes current via vectorUnscale in preference to imageUnscale", () => {
    const p = vectorParticleProps(manifest, "current", 0)!;
    expect(p.id).toBe("current-0");
    expect(p.imageUnscale).toEqual([-3, 3]);
  });

  it("colours currents by magnitude when asked, scaling the ramp to the domain", () => {
    const p = vectorParticleProps(manifest, "current", 0, { colorByMagnitude: true })!;
    expect(p.palette).toBeDefined();
    // Palette stops are scaled onto the 0..3 m/s domain (physical units).
    const stops = p.palette!.map(([s]) => s);
    expect(Math.min(...stops)).toBeCloseTo(0, 6);
    expect(Math.max(...stops)).toBeCloseTo(3, 6);
  });

  it("returns null when the variable/texture is absent", () => {
    expect(vectorParticleProps(manifest, "salinity", 0)).toBeNull();
    expect(vectorParticleProps(manifest, "current", 99)).toBeNull();
  });
});

describe("windParticleProps delegates to vectorParticleProps", () => {
  it("still returns the wind props shape", () => {
    const w = windParticleProps(manifest, 0);
    const v = vectorParticleProps(manifest, "wind", 0);
    expect(w).toEqual(v);
  });
});
