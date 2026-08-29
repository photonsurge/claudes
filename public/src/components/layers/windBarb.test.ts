import type { WeatherManifest, WeatherVariableManifest } from "@photonsurge/shared/manifest";
import { windBarbPropsFromEntry, manifestBounds } from "./props";

const windEntry: WeatherVariableManifest = {
  encoding: "uv",
  units: "m/s",
  imageUnscale: [-30, 30],
  files: { "0": "/api/weather/tex/w0" },
};

const manifest: WeatherManifest = {
  model: "gfs",
  run: "2026-06-28T12:00:00.000Z",
  bounds: [-180, -90, 180, 90],
  grid: { width: 1440, height: 721, res: 0.25 },
  steps: [{ validTime: "2026-06-28T12:00:00Z", fhr: 0 }],
  variables: { wind: windEntry },
};

describe("windBarbPropsFromEntry", () => {
  it("builds VECTOR/WIND_BARB props decoding the same uv texture as the particles", () => {
    const p = windBarbPropsFromEntry(windEntry, "wind", 0, manifestBounds(manifest))!;
    expect(p).not.toBeNull();
    expect(p.id).toBe("wind-barbs-0");
    expect(p.image).toBe("/api/weather/tex/w0");
    expect(p.imageUnscale).toEqual([-30, 30]);
    // GridLayer defaults to SCALAR; a uv field MUST declare itself a vector.
    expect(p.imageType).toBe("VECTOR");
    expect(p.style).toBe("WIND_BARB");
    expect(p.iconColor).toEqual([255, 255, 255, 255]); // white default
  });

  it("prefers vectorUnscale and appends the nest id suffix", () => {
    const nest: WeatherVariableManifest = {
      ...windEntry,
      vectorUnscale: [-40, 40],
      sourceId: "arome",
      files: { "0": "/tex/warome0" },
    };
    const p = windBarbPropsFromEntry(nest, "wind", 0, [-6, 41, 10, 52], { idSuffix: "-arome" })!;
    expect(p.id).toBe("wind-barbs-0-arome");
    expect(p.imageUnscale).toEqual([-40, 40]);
    expect(p.bounds).toEqual([-6, 41, 10, 52]);
  });

  it("tints the glyphs with the operator's wind colour", () => {
    const p = windBarbPropsFromEntry(windEntry, "wind", 0, manifestBounds(manifest), { color: "#20d8ff" })!;
    expect(p.iconColor).toEqual([0x20, 0xd8, 0xff, 255]);
  });

  it("keeps a fixed readable opacity — the particle opacity slider must not erase the chart", () => {
    // Director slides tone particles down to ~0.1; barbs ARE the chart.
    const p = windBarbPropsFromEntry(windEntry, "wind", 0, manifestBounds(manifest))!;
    expect(p.opacity).toBe(0.9);
  });

  it("returns null when the texture or unscale is absent at this step", () => {
    expect(windBarbPropsFromEntry(windEntry, "wind", 99, manifestBounds(manifest))).toBeNull();
    const noUnscale: WeatherVariableManifest = { encoding: "uv", units: "m/s", files: { "0": "/t" } };
    expect(windBarbPropsFromEntry(noUnscale, "wind", 0, manifestBounds(manifest))).toBeNull();
  });
});
