import type { WeatherManifest } from "@photonsurge/shared/manifest";
import {
  textureUrlFor,
  manifestBounds,
  windParticleProps,
  scalarRasterProps,
  pressureProps,
  cityProps,
} from "./props";
import type { City } from "../../lib/cities";

const manifest: WeatherManifest = {
  model: "gfs",
  run: "2026-06-28T12:00:00.000Z",
  bounds: [-180, -90, 180, 90],
  grid: { width: 1440, height: 721, res: 0.25 },
  steps: [
    { validTime: "2026-06-28T12:00:00Z", fhr: 0 },
    { validTime: "2026-06-28T15:00:00Z", fhr: 3 },
  ],
  variables: {
    wind: {
      encoding: "uv",
      units: "m/s",
      imageUnscale: [-30, 30],
      files: { "0": "/api/weather/tex/w0", "3": "/api/weather/tex/w3" },
    },
    temp: {
      encoding: "scalar",
      units: "°C",
      domain: [-40, 50],
      palette: "temp",
      imageUnscale: [-80, 60],
      files: { "0": "/api/weather/tex/t0" },
    },
    pressure: {
      encoding: "scalar",
      units: "hPa",
      imageUnscale: [900, 1100],
      files: { "0": "/api/weather/tex/p0" },
    },
  },
};

describe("textureUrlFor / manifestBounds", () => {
  it("resolves the texture URL for variable+fhr", () => {
    expect(textureUrlFor(manifest, "wind", 3)).toBe("/api/weather/tex/w3");
    expect(textureUrlFor(manifest, "temp", 0)).toBe("/api/weather/tex/t0");
  });
  it("returns undefined for missing variable/fhr", () => {
    expect(textureUrlFor(manifest, "wind", 99)).toBeUndefined();
    expect(textureUrlFor(manifest, "nope", 0)).toBeUndefined();
  });
  it("returns [w,s,e,n] bounds", () => {
    expect(manifestBounds(manifest)).toEqual([-180, -90, 180, 90]);
  });
});

describe("windParticleProps", () => {
  it("builds props with image, imageUnscale, bounds for the fhr", () => {
    const p = windParticleProps(manifest, 3)!;
    expect(p.image).toBe("/api/weather/tex/w3");
    expect(p.imageUnscale).toEqual([-30, 30]);
    expect(p.bounds).toEqual([-180, -90, 180, 90]);
    expect(p.id).toContain("3");
  });
  it("returns null without a wind texture", () => {
    expect(windParticleProps(manifest, 99)).toBeNull();
  });
  it("honours opts overrides", () => {
    const p = windParticleProps(manifest, 0, { numParticles: 100, speedFactor: 9 })!;
    expect(p.numParticles).toBe(100);
    expect(p.speedFactor).toBe(9);
  });
});

describe("scalarRasterProps", () => {
  it("builds props with palette + domain from the manifest entry", () => {
    const p = scalarRasterProps(manifest, "temp", 0)!;
    expect(p.image).toBe("/api/weather/tex/t0");
    expect(p.imageUnscale).toEqual([-80, 60]);
    expect(p.domain).toEqual([-40, 50]);
    expect(Array.isArray(p.palette)).toBe(true);
    expect(p.palette.length).toBeGreaterThan(0);
    // Palette stops must be in PHYSICAL units (scaled to domain), not 0..1,
    // or WeatherLayers clamps every real value to the hottest colour.
    const stops = p.palette.map(([s]) => s);
    expect(Math.min(...stops)).toBeCloseTo(-40, 5);
    expect(Math.max(...stops)).toBeCloseTo(50, 5);
  });
  it("returns null when the variable has no texture for the fhr", () => {
    expect(scalarRasterProps(manifest, "temp", 3)).toBeNull();
  });
});

describe("pressureProps", () => {
  it("builds contour + highLow props off the pressure texture", () => {
    const p = pressureProps(manifest, 0)!;
    expect(p.contour.image).toBe("/api/weather/tex/p0");
    expect(p.highLow.image).toBe("/api/weather/tex/p0");
    expect(p.contour.bounds).toEqual([-180, -90, 180, 90]);
  });
  it("returns null without a pressure texture", () => {
    expect(pressureProps(manifest, 3)).toBeNull();
  });
});

describe("cityProps", () => {
  const cities: City[] = [
    { id: "1", name: "London", lat: 51.5, lng: -0.12, isCapital: true, population: 9000000 },
    { id: "2", name: "Reading", lat: 51.45, lng: -0.97, isCapital: false, population: 300000 },
  ];
  const { scatter, text } = cityProps(cities);

  it("positions are [lng, lat]", () => {
    expect(scatter.getPosition(cities[0])).toEqual([-0.12, 51.5]);
  });
  it("capitals get gold, larger markers/labels", () => {
    expect(scatter.getFillColor(cities[0])).toEqual([255, 215, 0, 255]);
    expect(scatter.getRadius(cities[0])).toBeGreaterThan(scatter.getRadius(cities[1]));
    expect(text.getSize(cities[0])).toBeGreaterThan(text.getSize(cities[1]));
  });
  it("text uses the city name", () => {
    expect(text.getText(cities[1])).toBe("Reading");
  });
});
