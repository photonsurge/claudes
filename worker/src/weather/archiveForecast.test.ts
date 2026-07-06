import {
  forecastArchiveEnabled,
  selectForecastSteps,
  archiveForecastRun,
  type ForecastArchiveDb,
} from "./archiveForecast";
import type { ArchivableRun } from "./archive";

const ENV_KEYS = ["WEATHER_FORECAST_ARCHIVE"];
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("forecastArchiveEnabled", () => {
  it("defaults on", () => {
    expect(forecastArchiveEnabled()).toBe(true);
  });

  it("respects the off override", () => {
    process.env.WEATHER_FORECAST_ARCHIVE = "off";
    expect(forecastArchiveEnabled()).toBe(false);
  });
});

describe("selectForecastSteps", () => {
  it("keeps every step, no curation", () => {
    const steps = [0, 3, 6, 72].map((fhr) => ({
      fhr,
      validTime: new Date(Date.UTC(2026, 0, 1, fhr)).toISOString(),
    }));
    expect(selectForecastSteps(steps)).toEqual(steps);
  });
});

describe("archiveForecastRun", () => {
  const run: ArchivableRun = {
    id: "run-1",
    model: "gfs",
    run: new Date(Date.UTC(2026, 0, 1, 0)),
    bounds: [-180, -90, 180, 90],
    grid: { width: 1440, height: 721, res: 0.25 },
    steps: [0, 3, 6].map((fhr) => ({
      fhr,
      validTime: new Date(Date.UTC(2026, 0, 1, fhr)).toISOString(),
    })),
    variables: {
      temp: {
        encoding: "scalar",
        units: "°C",
        imageUnscale: [-90, 60],
        files: { "0": "tex-t0", "3": "tex-t3", "6": "tex-t6" },
      },
      wind: {
        encoding: "uv",
        units: "m/s",
        vectorUnscale: [-40, 40],
        files: { "0": "tex-w0" },
      },
    } as any,
  };

  const makeDb = () => {
    const upserts: any[] = [];
    const db: ForecastArchiveDb = {
      weatherTextures: {
        getByID: async (id: string) => ({ success: true, data: { data: Buffer.from(id) } }),
      },
      weatherForecastFrames: {
        upsert: async (f: any) => {
          upserts.push(f);
          return { written: true };
        },
        pruneOlderThan: async () => 0,
      },
    };
    return { db, upserts };
  };

  it("archives every step of every variable, with decode meta", async () => {
    const { db, upserts } = makeDb();
    const res = await archiveForecastRun(db, run);
    expect(res.written).toBe(4); // temp f0+f3+f6, wind f0
    const temp0 = upserts.find((f) => f.variable === "temp" && f.fhr === 0);
    expect(temp0.imageUnscale).toEqual([-90, 60]);
    expect(temp0.run.toISOString()).toBe("2026-01-01T00:00:00.000Z");
    expect(temp0.byteSize).toBeGreaterThan(0);
    const wind = upserts.find((f) => f.variable === "wind");
    expect(wind.vectorUnscale).toEqual([-40, 40]);
    expect(wind.encoding).toBe("uv");
  });

  it("skips empty/missing textures without failing the run", async () => {
    const { db, upserts } = makeDb();
    db.weatherTextures.getByID = async (id: string) =>
      id === "tex-t0" ? { success: false } : { success: true, data: { data: Buffer.from(id) } };
    const res = await archiveForecastRun(db, run);
    expect(res.written).toBe(3);
    expect(upserts.some((f) => f.variable === "temp" && f.fhr === 0)).toBe(false);
  });

  it("does nothing when disabled", async () => {
    process.env.WEATHER_FORECAST_ARCHIVE = "off";
    const { db, upserts } = makeDb();
    const res = await archiveForecastRun(db, run);
    expect(res.written).toBe(0);
    expect(upserts).toEqual([]);
  });

  it("prunes elapsed validTimes after archiving", async () => {
    const { db } = makeDb();
    let prunedCutoff: Date | null = null;
    db.weatherForecastFrames.pruneOlderThan = async (cutoff: Date) => {
      prunedCutoff = cutoff;
      return 2;
    };
    await archiveForecastRun(db, run);
    expect(prunedCutoff).not.toBeNull();
    expect((prunedCutoff as unknown as Date).getTime()).toBeLessThan(Date.now());
  });
});
