import { textureUrl } from "@photonsurge/shared/manifest";
import { buildManifestFromRun, composeManifest, mapFreshness, ageLabel, type RunLike } from "./manifest";

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
    expect(textureUrl("abc123")).toBe("/api/weather/tex/abc123.png");
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

describe("composeManifest (multi-supplier portfolio)", () => {
  const sv = (id: string, extra: any = {}) => ({ encoding: "scalar" as const, units: "x", files: { "0": id }, ...extra });
  const uv = (id: string) => ({ encoding: "uv" as const, units: "m/s", files: { "0": id } });

  const gfs: RunLike = {
    model: "gfs", run: new Date("2026-06-30T00:00:00Z"), generatedAt: new Date("2026-06-30T04:00:00Z"),
    bounds: [-180, -90, 180, 90], grid: { width: 1440, height: 721, res: 0.25 },
    steps: [{ validTime: "a", fhr: 0 }, { validTime: "b", fhr: 3 }, { validTime: "c", fhr: 6 }],
    variables: { temp: sv("gfs-temp"), humidity: sv("gfs-hum"), sst: sv("gfs-sst"), wave: sv("gfs-wave") },
  };
  const ifs: RunLike = {
    model: "ifs", run: new Date("2026-06-30T00:00:00Z"), bounds: [-180, -90, 180, 90],
    grid: { width: 1440, height: 721, res: 0.25 }, steps: [{ validTime: "a", fhr: 0 }],
    variables: { temp: sv("ifs-temp") },
  };
  const rtofs: RunLike = {
    model: "rtofs", run: new Date("2026-06-30T00:00:00Z"), bounds: [-180, -90, 180, 90],
    grid: { width: 4500, height: 2250, res: 0.08 }, steps: [{ validTime: "a", fhr: 0 }],
    variables: { sst: sv("rtofs-sst"), salinity: sv("rtofs-sal"), current: uv("rtofs-cur") },
  };
  const mosaic: RunLike = {
    model: "gfswave-mosaic", run: new Date("2026-06-30T00:00:00Z"), bounds: [-180, -90, 180, 90],
    grid: { width: 2160, height: 1081, res: 0.1666 }, steps: [{ validTime: "a", fhr: 0 }],
    variables: { wave: sv("mosaic-wave") },
  };
  const m = composeManifest([gfs, ifs, rtofs, mosaic])!;

  it("returns null with no runs", () => {
    expect(composeManifest([])).toBeNull();
  });

  it("picks each variable from its highest-priority source", () => {
    expect(m.variables.temp.files["0"]).toBe(textureUrl("ifs-temp")); // ifs > gfs
    expect(m.variables.sst.files["0"]).toBe(textureUrl("rtofs-sst")); // rtofs > gfs
    expect(m.variables.wave.files["0"]).toBe(textureUrl("mosaic-wave")); // mosaic > gfs
    expect(m.variables.humidity.files["0"]).toBe(textureUrl("gfs-hum")); // gfs-only
    expect(m.variables.current.files["0"]).toBe(textureUrl("rtofs-cur")); // rtofs-only
    expect(m.variables.salinity.files["0"]).toBe(textureUrl("rtofs-sal"));
  });

  it("labels the model composite and takes bounds/grid/steps from the base (most steps)", () => {
    expect(m.model).toBe("composite");
    expect(m.steps).toHaveLength(3); // gfs base
    expect(m.grid).toEqual({ width: 1440, height: 721, res: 0.25 });
    expect(m.generatedAt).toBe("2026-06-30T04:00:00.000Z");
  });

  it("exposes every variable across the portfolio", () => {
    expect(Object.keys(m.variables).sort()).toEqual(
      ["current", "humidity", "salinity", "sst", "temp", "wave"],
    );
  });

  it("tags each variable with its winning source + run time", () => {
    expect(m.variables.sst.sourceId).toBe("rtofs");
    expect(m.variables.temp.sourceId).toBe("ifs");
    expect(m.variables.humidity.sourceId).toBe("gfs"); // falls back to run.model
    expect(m.variables.sst.runTimeUtc).toBe("2026-06-30T00:00:00.000Z");
  });
});

describe("mapFreshness / ageLabel", () => {
  const now = Date.parse("2026-06-30T06:00:00Z");

  it("ageLabel buckets seconds→minutes→hours→days", () => {
    expect(ageLabel("2026-06-30T05:59:30Z", now)).toBe("just now");
    expect(ageLabel("2026-06-30T05:30:00Z", now)).toBe("30m ago");
    expect(ageLabel("2026-06-30T03:00:00Z", now)).toBe("3h ago");
    expect(ageLabel("2026-06-27T06:00:00Z", now)).toBe("3d ago");
    expect(ageLabel(undefined, now)).toBe("unknown");
  });

  it("reads the ACTIVE variable's per-source timing", () => {
    const base: RunLike = {
      model: "gfs", run: new Date("2026-06-30T00:00:00Z"), generatedAt: new Date("2026-06-30T04:00:00Z"),
      bounds: [-180, -90, 180, 90], grid: { width: 1440, height: 721, res: 0.25 },
      steps: [{ validTime: "a", fhr: 0 }, { validTime: "b", fhr: 3 }],
      variables: { sst: { encoding: "scalar", units: "°C", files: { "0": "gfs-sst" } } },
    };
    const ocean: RunLike = {
      model: "rtofs", run: new Date("2026-06-30T00:00:00Z"), generatedAt: new Date("2026-06-30T05:00:00Z"),
      bounds: [-180, -90, 180, 90], grid: { width: 4500, height: 2250, res: 0.08 },
      steps: [{ validTime: "a", fhr: 0 }],
      variables: { sst: { encoding: "scalar", units: "°C", files: { "0": "rtofs-sst" } } },
    };
    const f = mapFreshness(composeManifest([base, ocean])!, "sst", now)!; // sst → rtofs
    expect(f.source).toBe("RTOFS");
    expect(f.runLabel).toContain("UTC");
    expect(f.updatedLabel).toBe("1h ago"); // rtofs generatedAt 05:00 vs now 06:00
  });

  it("returns null without a manifest", () => {
    expect(mapFreshness(null, "sst", now)).toBeNull();
  });
});
