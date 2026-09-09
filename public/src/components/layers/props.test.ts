import type { WeatherManifest } from "@photonsurge/shared/manifest";
import {
  allTextureUrlsFor,
  textureUrlFor,
  manifestBounds,
  windParticleProps,
  hexToRgba,
  scalarRasterProps,
  scalarRasterPropsFromEntry,
  vectorParticlePropsFromEntry,
  pressureProps,
  cityProps,
  scalePaletteToDomain,
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
  it("defaults to white at 0.9 opacity, and honours opacity/color opts", () => {
    const d = windParticleProps(manifest, 0)!;
    expect(d.color).toEqual([255, 255, 255, 255]);
    expect(d.opacity).toBe(0.9);
    const p = windParticleProps(manifest, 0, { opacity: 0.3, color: "#ff8800" })!;
    expect(p.opacity).toBe(0.3);
    expect(p.color).toEqual([255, 136, 0, 255]);
  });
});

describe("hexToRgba", () => {
  it("parses #rrggbb and #rgb, falling back to white", () => {
    expect(hexToRgba("#ff8800")).toEqual([255, 136, 0, 255]);
    expect(hexToRgba("#f80")).toEqual([255, 136, 0, 255]);
    expect(hexToRgba(undefined)).toEqual([255, 255, 255, 255]);
    expect(hexToRgba("nope")).toEqual([255, 255, 255, 255]);
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

describe("scalarRasterPropsFromEntry (nest seam)", () => {
  const nest = {
    encoding: "scalar" as const,
    units: "°C",
    domain: [-40, 50] as [number, number],
    palette: "temp",
    imageUnscale: [-80, 60] as [number, number],
    files: { "0": "/api/weather/tex/hrrr0" },
  };
  const conus: [number, number, number, number] = [-134, 21, -60, 53];

  it("uses the passed bbox bounds (not the global manifest) and a unique id", () => {
    const p = scalarRasterPropsFromEntry(nest, "temp", 0, conus, { idSuffix: "-hrrr" })!;
    expect(p.image).toBe("/api/weather/tex/hrrr0");
    expect(p.bounds).toEqual(conus); // clipped to the nest region
    expect(p.id).toBe("scalar-temp-0-hrrr"); // distinct from the base layer id
    const stops = p.palette.map(([s]) => s);
    expect(Math.min(...stops)).toBeCloseTo(-40, 5);
  });

  it("returns null for a nest-only base with empty files", () => {
    expect(scalarRasterPropsFromEntry({ ...nest, files: {} }, "temp", 0, conus)).toBeNull();
  });
});

describe("vectorParticlePropsFromEntry (nest seam)", () => {
  const nest = {
    encoding: "uv" as const,
    units: "m/s",
    imageUnscale: [-30, 30] as [number, number],
    files: { "0": "/api/weather/tex/windnest0" },
  };
  const conus: [number, number, number, number] = [-134, 21, -60, 53];

  it("clips to the nest bbox and takes a unique id", () => {
    const p = vectorParticlePropsFromEntry(nest, "wind", 0, conus, { idSuffix: "-hrrr" })!;
    expect(p.image).toBe("/api/weather/tex/windnest0");
    expect(p.bounds).toEqual(conus);
    expect(p.id).toBe("wind-0-hrrr");
    expect(p.imageUnscale).toEqual([-30, 30]);
  });

  it("returns null without a texture at the fhr", () => {
    expect(vectorParticlePropsFromEntry(nest, "wind", 5, conus)).toBeNull();
  });
});

describe("pressureProps", () => {
  it("builds contour + highLow props off the pressure texture", () => {
    const p = pressureProps(manifest, 0)!;
    expect(p.contour.image).toBe("/api/weather/tex/p0");
    expect(p.highLow.image).toBe("/api/weather/tex/p0");
    expect(p.contour.bounds).toEqual([-180, -90, 180, 90]);
  });
  it("colours isobars by value over the hPa domain, with major lines", () => {
    const p = pressureProps(manifest, 0)!;
    // Palette stops are scaled to physical hPa (domain 950..1050), not 0..1.
    expect(p.contour.palette[0][0]).toBe(950);
    expect(p.contour.palette[p.contour.palette.length - 1][0]).toBe(1050);
    expect(p.contour.majorInterval).toBeGreaterThan(p.contour.interval);
    expect(p.highLow.palette).toEqual(p.contour.palette);
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

  it("lights up night-side cities (bigger, warmer, brighter) when a subsolar point is given", () => {
    // Sun over the far side of the planet → London is deep in night.
    const nightSub: [number, number] = [179, 0];
    const dayScatter = cityProps(cities).scatter;
    const nightScatter = cityProps(cities, nightSub).scatter;
    const london = cities[0];
    expect(nightScatter.getRadius(london)).toBeGreaterThan(dayScatter.getRadius(london));
    const [r, g, b, a] = nightScatter.getFillColor(london);
    // Warmed toward amber (blue channel drops) and fully opaque.
    expect(b).toBeLessThan(r);
    expect(a).toBe(255);
    // A capital's day colour is unchanged when the city sits in full daylight.
    const daySub: [number, number] = [-0.12, 51.5]; // sun straight over London
    expect(cityProps(cities, daySub).scatter.getFillColor(london)).toEqual([255, 215, 0, 255]);
  });
});

describe("reference stability across layer rebuilds", () => {
  const manifest = {
    run: "2026-01-01T00:00:00Z",
    bounds: [-180, -90, 180, 90],
    variables: {},
  } as unknown as Parameters<typeof manifestBounds>[0];

  it("manifestBounds returns the SAME tuple for the same manifest (deck re-meshes on a new one)", () => {
    expect(manifestBounds(manifest)).toBe(manifestBounds(manifest));
    expect(manifestBounds(manifest)).toEqual([-180, -90, 180, 90]);
  });

  it("scalePaletteToDomain returns the SAME array for the same palette + domain (WeatherLayers re-bakes on a new one)", () => {
    const palette: [number, string][] = [
      [0, "#000000"],
      [1, "#ffffff"],
    ];
    const a = scalePaletteToDomain(palette, [-40, 50]);
    expect(scalePaletteToDomain(palette, [-40, 50])).toBe(a);
    expect(a).toEqual([
      [-40, "#000000"],
      [50, "#ffffff"],
    ]);
    // A different domain is a different (cached) array.
    expect(scalePaletteToDomain(palette, [0, 1])).not.toBe(a);
    expect(scalePaletteToDomain(palette)).toBe(palette);
  });

  it("hexToRgba returns the SAME tuple for the same hex", () => {
    expect(hexToRgba("#ff0000")).toBe(hexToRgba("#ff0000"));
    expect(hexToRgba("#ff0000")).toEqual([255, 0, 0, 255]);
  });
});

describe("allTextureUrlsFor", () => {
  const manifest = {
    variables: {
      wind: {
        files: { "0": "/tex/wind0.png", "3": "/tex/wind3.png" },
        nests: [
          { files: { "0": "/tex/wind0-icond2.png", "3": "/tex/wind3-icond2.png" } },
          { files: { "0": "/tex/wind0-hrrr.png" } },
        ],
      },
      temp: { files: { "0": "/tex/temp0.png", "3": "/tex/temp3.png" } },
      elevation: { files: { "0": "/tex/elev.png" } },
    },
  } as never;

  it("collects every base map AND every nest at the hour", () => {
    expect(allTextureUrlsFor(manifest, 0).sort()).toEqual(
      ["/tex/elev.png", "/tex/temp0.png", "/tex/wind0-hrrr.png", "/tex/wind0-icond2.png", "/tex/wind0.png"].sort(),
    );
  });

  it("falls back to hour 0 for statics baked once, and dedupes", () => {
    // At hour 3: wind + its icond2 nest have their own; the hrrr nest and
    // elevation only exist at hour 0 and must still be warmed, not skipped.
    expect(allTextureUrlsFor(manifest, 3).sort()).toEqual(
      ["/tex/elev.png", "/tex/temp3.png", "/tex/wind0-hrrr.png", "/tex/wind3-icond2.png", "/tex/wind3.png"].sort(),
    );
  });

  it("is empty for a manifest with no variables", () => {
    expect(allTextureUrlsFor({} as never, 0)).toEqual([]);
  });
});
