import { textureUrl } from "@photonsurge/shared/manifest";
import { buildManifestFromRun, type RunLike } from "./manifest";

const run: RunLike = {
  model: "gfs",
  run: new Date("2026-06-28T12:00:00Z"),
  generatedAt: new Date("2026-06-28T13:00:00Z"),
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
      files: { "0": "texA", "3": "texB" },
    },
    temp: {
      encoding: "scalar",
      units: "°C",
      domain: [-40, 50],
      palette: "temp",
      imageUnscale: [-80, 60],
      files: { "0": "texC" },
    },
  },
};

describe("textureUrl", () => {
  it("maps an id to the tex route", () => {
    expect(textureUrl("abc123")).toBe("/api/weather/tex/abc123");
  });
});

describe("buildManifestFromRun", () => {
  const m = buildManifestFromRun(run);

  it("copies scalar metadata and ISO-normalises run/generatedAt", () => {
    expect(m.model).toBe("gfs");
    expect(m.run).toBe("2026-06-28T12:00:00.000Z");
    expect(m.generatedAt).toBe("2026-06-28T13:00:00.000Z");
    expect(m.bounds).toEqual([-180, -90, 180, 90]);
    expect(m.grid).toEqual({ width: 1440, height: 721, res: 0.25 });
    expect(m.steps).toHaveLength(2);
  });

  it("rewrites texture ids into URLs", () => {
    expect(m.variables.wind.files["0"]).toBe(textureUrl("texA"));
    expect(m.variables.wind.files["3"]).toBe(textureUrl("texB"));
    expect(m.variables.temp.files["0"]).toBe(textureUrl("texC"));
  });

  it("preserves imageUnscale / domain / palette", () => {
    expect(m.variables.wind.imageUnscale).toEqual([-30, 30]);
    expect(m.variables.temp.domain).toEqual([-40, 50]);
    expect(m.variables.temp.palette).toBe("temp");
  });

  it("omits optional fields that are absent", () => {
    const minimal = buildManifestFromRun({
      ...run,
      generatedAt: undefined,
      variables: { humidity: { encoding: "scalar", units: "%", files: {} } },
    });
    expect(minimal.generatedAt).toBeUndefined();
    expect(minimal.variables.humidity.domain).toBeUndefined();
    expect(minimal.variables.humidity.palette).toBeUndefined();
  });
});
