import { textureUrl } from "@photonsurge/shared/manifest";
import { buildManifestFromRun, composeManifest, mapFreshness, ageLabel, utcLabel, type RunLike, manifestFingerprint, pickManifest } from "./manifest";

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

  it("picks each variable from its highest-priority ENABLED source", () => {
    // ifs is enabled:false in the registry, so it does NOT win temp despite its
    // higher priority — the base GFS temp wins (prevents the CCSDS "all purple").
    expect(m.variables.temp.files["0"]).toBe(textureUrl("gfs-temp"));
    expect(m.variables.sst.files["0"]).toBe(textureUrl("rtofs-sst")); // rtofs enabled > gfs
    expect(m.variables.wave.files["0"]).toBe(textureUrl("mosaic-wave")); // mosaic enabled > gfs
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
    expect(m.variables.temp.sourceId).toBe("gfs"); // ifs disabled → gfs wins
    expect(m.variables.humidity.sourceId).toBe("gfs");
    expect(m.variables.sst.runTimeUtc).toBe("2026-06-30T00:00:00.000Z");
  });
});

describe("composeManifest — regional nests", () => {
  const sv = (id: string, extra: any = {}) => ({ encoding: "scalar" as const, units: "x", files: { "0": id }, ...extra });

  const gfs: RunLike = {
    model: "gfs", run: new Date("2026-06-30T00:00:00Z"), generatedAt: new Date("2026-06-30T04:00:00Z"),
    bounds: [-180, -90, 180, 90], grid: { width: 1440, height: 721, res: 0.25 },
    steps: [{ validTime: "a", fhr: 0 }, { validTime: "b", fhr: 3 }],
    variables: { temp: sv("gfs-temp") },
  };
  // hrrr is a nest source in the registry (declares minZoom) — CONUS bbox.
  const hrrr: RunLike = {
    model: "hrrr", run: new Date("2026-06-30T01:00:00Z"), generatedAt: new Date("2026-06-30T02:30:00Z"),
    bounds: [-134, 21, -60, 53], grid: { width: 2600, height: 1100, res: 0.028 },
    steps: [{ validTime: "a", fhr: 0 }],
    variables: { temp: sv("hrrr-temp") },
  };
  // icon-d2 is a nest source too — Europe bbox, also supplies temp.
  const iconD2: RunLike = {
    model: "icon-d2", run: new Date("2026-06-30T00:00:00Z"),
    bounds: [-4, 43, 20, 58], grid: { width: 1215, height: 746, res: 0.02 },
    steps: [{ validTime: "a", fhr: 0 }],
    variables: { temp: sv("icon-temp") },
  };
  // mrms supplies the NEST-ONLY variable radar (no global base supplies it).
  const mrms: RunLike = {
    model: "mrms", run: new Date("2026-06-30T01:30:00Z"),
    bounds: [-130, 20, -60, 55], grid: { width: 3500, height: 1750, res: 0.02 },
    steps: [{ validTime: "a", fhr: 0 }],
    variables: { radar: sv("mrms-radar") },
  };

  it("keeps the GLOBAL base as the winner and attaches the nest (nest never wins base)", () => {
    const m = composeManifest([gfs, hrrr])!;
    // hrrr priority (30) > gfs (10), but nests are excluded from base selection.
    expect(m.variables.temp.files["0"]).toBe(textureUrl("gfs-temp"));
    expect(m.variables.temp.sourceId).toBe("gfs");
    expect(m.variables.temp.nests).toHaveLength(1);
    const nest = m.variables.temp.nests![0];
    expect(nest.sourceId).toBe("hrrr");
    expect(nest.files["0"]).toBe(textureUrl("hrrr-temp"));
    expect(nest.bbox).toEqual([-134, 21, -60, 53]);
    expect(nest.minZoom).toBe(3.5); // carried from the descriptor
    expect(nest.priority).toBe(30);
  });

  it("takes bounds/grid/steps from the GLOBAL base, never a regional nest", () => {
    const m = composeManifest([gfs, hrrr])!;
    expect(m.bounds).toEqual([-180, -90, 180, 90]); // not the CONUS bbox
    expect(m.grid.width).toBe(1440);
    expect(m.steps).toHaveLength(2); // gfs, not hrrr's single step
  });

  it("attaches every nest that supplies the variable", () => {
    const m = composeManifest([gfs, hrrr, iconD2])!;
    const ids = m.variables.temp.nests!.map((n) => n.sourceId).sort();
    expect(ids).toEqual(["hrrr", "icon-d2"]);
  });

  it("exposes a NEST-ONLY variable (radar) with an empty base so only nests render", () => {
    const m = composeManifest([gfs, mrms])!;
    expect(m.variables.radar).toBeDefined();
    expect(Object.keys(m.variables.radar.files)).toHaveLength(0); // nothing renders globally
    expect(m.variables.radar.sourceId).toBe("mrms");
    expect(m.variables.radar.nests).toHaveLength(1);
    expect(m.variables.radar.nests![0].files["0"]).toBe(textureUrl("mrms-radar"));
    expect(m.variables.radar.nests![0].bbox).toEqual([-130, 20, -60, 55]);
  });

  it("leaves single-source variables untouched (no nests key)", () => {
    const m = composeManifest([gfs])!;
    expect(m.variables.temp.files["0"]).toBe(textureUrl("gfs-temp"));
    expect(m.variables.temp.nests).toBeUndefined();
  });

  // icon-global is a nest source (declares minZoom 2) but its bbox spans the planet.
  const iconGlobal: RunLike = {
    model: "icon-global", run: new Date("2026-06-30T00:00:00Z"),
    bounds: [-180, -90, 179.75, 90], grid: { width: 2879, height: 1441, res: 0.125 },
    steps: [{ validTime: "a", fhr: 0 }],
    variables: { temp: sv("icon-global-temp") },
  };

  it("promotes a GLOBAL-coverage nest to the base when no true base supplies the variable", () => {
    // No gfs: temp is supplied only by nests. icon-global spans the globe, so it
    // becomes the always-on base (WITH files) — renders at every zoom, not only
    // past a nest's minZoom — while the regional icon-d2 stays a nest.
    const m = composeManifest([iconGlobal, iconD2])!;
    expect(m.variables.temp.files["0"]).toBe(textureUrl("icon-global-temp")); // base HAS files
    expect(m.variables.temp.sourceId).toBe("icon-global");
    // The promoted global base is NOT also listed as a nest (no double, coincident draw).
    const nestIds = (m.variables.temp.nests ?? []).map((n) => n.sourceId);
    expect(nestIds).toEqual(["icon-d2"]);
  });
});

describe("utcLabel", () => {
  it("formats an ISO stamp as day-month HH:MM UTC, same on repeat calls", () => {
    expect(utcLabel("2026-06-30T00:00:00Z")).toBe("30 Jun 00:00 UTC");
    expect(utcLabel("2026-06-30T00:00:00Z")).toBe("30 Jun 00:00 UTC");
    expect(utcLabel("2026-01-05T23:07:00+02:00")).toBe("05 Jan 21:07 UTC");
  });
  it("is empty for missing or unparseable input", () => {
    expect(utcLabel(undefined)).toBe("");
    expect(utcLabel("")).toBe("");
    expect(utcLabel("not a date")).toBe("");
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
    expect(f.generatedLabel).toBe("30 Jun 05:00 UTC");
    expect(f.updatedLabel).toBe("1h ago"); // rtofs generatedAt 05:00 vs now 06:00
  });

  it("shows a static dataset's vintage, never its ingest age", () => {
    // Elevation is timeless ETOPO terrain — its run/generatedAt is only when
    // `refresh:elevation` last ran, so no CREATED/RUN/age must reach air.
    const elev: RunLike = {
      model: "elevation", run: new Date("2026-05-01T00:00:00Z"), generatedAt: new Date("2026-05-01T00:00:00Z"),
      bounds: [-180, -90, 180, 90], grid: { width: 1440, height: 721, res: 0.25 },
      steps: [{ validTime: "a", fhr: 0 }],
      variables: { elevation: { encoding: "scalar", units: "m", sourceId: "etopo", files: { "0": "etopo-elev" } } },
    };
    const f = mapFreshness(composeManifest([elev])!, "elevation", now)!;
    expect(f.source).toBe("ETOPO 2022");
    expect(f.note).toBe("STATIC DATASET");
    expect(f.runLabel).toBe("");
    expect(f.generatedLabel).toBe("");
    expect(f.updatedLabel).toBe("");
  });

  it("returns null without a manifest", () => {
    expect(mapFreshness(null, "sst", now)).toBeNull();
  });
});

describe("manifestFingerprint / pickManifest", () => {
  const base = () =>
    ({
      model: "composite",
      run: "2026-09-09T18:00:00.000Z",
      generatedAt: "2026-09-09T18:40:00.000Z",
      steps: [{}, {}, {}],
      variables: {
        wind: { files: { "0": "a.png" }, nests: [{}, {}] },
        temp: { files: { "0": "b.png" } },
      },
    }) as never;

  it("keeps the previous object when the run renders identically", () => {
    // WEATHER_RUN fired ten times in twelve minutes for one run; each fresh
    // object rebuilt the whole weather stack.
    const prev = base();
    expect(pickManifest(prev, base())).toBe(prev);
  });

  it("takes the new one when anything the globe renders from changed", () => {
    const prev = base();
    const newRun = { ...(base() as object), run: "2026-09-10T00:00:00.000Z" } as never;
    expect(pickManifest(prev, newRun)).toBe(newRun);
    // A re-bake under the SAME run republishes texture ids — still a change.
    const rebaked = base() as unknown as { variables: Record<string, { files: Record<string, string> }> };
    rebaked.variables.wind.files["0"] = "a2.png";
    expect(pickManifest(prev, rebaked as never)).toBe(rebaked);
    // And a nest appearing counts.
    const nested = base() as unknown as { variables: Record<string, { nests?: unknown[] }> };
    nested.variables.temp.nests = [{}];
    expect(pickManifest(prev, nested as never)).toBe(nested);
  });

  it("never drops what is on screen for a failed fetch", () => {
    const prev = base();
    expect(pickManifest(prev, null)).toBe(prev);
    expect(manifestFingerprint(null)).toBe("");
  });
});
