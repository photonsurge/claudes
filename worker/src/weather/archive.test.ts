import {
  archiveEnabled,
  archiveFhrs,
  selectArchiveSteps,
  archiveRun,
  type ArchivableRun,
  type ArchiveDb,
} from "./archive";

const ENV_KEYS = ["WEATHER_ARCHIVE", "WEATHER_ARCHIVE_FHRS", "WEATHER_ARCHIVE_KEEP_DAYS"];
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

describe("archive config", () => {
  it("defaults on, f000+f003, keep forever", () => {
    expect(archiveEnabled()).toBe(true);
    expect(archiveFhrs()).toEqual([0, 3]);
  });

  it("respects env overrides", () => {
    process.env.WEATHER_ARCHIVE = "off";
    process.env.WEATHER_ARCHIVE_FHRS = "0, 6, junk, -3";
    expect(archiveEnabled()).toBe(false);
    expect(archiveFhrs()).toEqual([0, 6]);
  });
});

describe("selectArchiveSteps", () => {
  const steps = [0, 3, 6, 9].map((fhr) => ({
    fhr,
    validTime: new Date(Date.UTC(2026, 0, 1, fhr)).toISOString(),
  }));

  it("keeps only the wanted forecast hours", () => {
    expect(selectArchiveSteps(steps, [0, 3]).map((s) => s.fhr)).toEqual([0, 3]);
    expect(selectArchiveSteps(steps, [12])).toEqual([]);
  });
});

describe("archiveRun", () => {
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
    const db: ArchiveDb = {
      weatherTextures: {
        getByID: async (id: string) => ({ success: true, data: { data: Buffer.from(id) } }),
      },
      weatherFrames: {
        upsert: async (f: any) => {
          upserts.push(f);
          return { written: true };
        },
        pruneOlderThan: async () => 0,
      },
    };
    return { db, upserts };
  };

  it("archives only the eligible fhrs of every variable, with decode meta", async () => {
    const { db, upserts } = makeDb();
    const res = await archiveRun(db, run);
    expect(res.written).toBe(3); // temp f0+f3, wind f0 (f6 not eligible)
    const temp0 = upserts.find((f) => f.variable === "temp" && f.fhr === 0);
    expect(temp0.imageUnscale).toEqual([-90, 60]);
    expect(temp0.validTime.toISOString()).toBe("2026-01-01T00:00:00.000Z");
    expect(temp0.byteSize).toBeGreaterThan(0);
    const wind = upserts.find((f) => f.variable === "wind");
    expect(wind.vectorUnscale).toEqual([-40, 40]);
    expect(wind.encoding).toBe("uv");
  });

  it("skips empty/missing textures without failing the run", async () => {
    const { db, upserts } = makeDb();
    db.weatherTextures.getByID = async (id: string) =>
      id === "tex-t0"
        ? { success: false }
        : { success: true, data: { data: Buffer.from(id) } };
    const res = await archiveRun(db, run);
    expect(res.written).toBe(2);
    expect(upserts.some((f) => f.variable === "temp" && f.fhr === 0)).toBe(false);
  });

  it("does nothing when disabled", async () => {
    process.env.WEATHER_ARCHIVE = "off";
    const { db, upserts } = makeDb();
    const res = await archiveRun(db, run);
    expect(res.written).toBe(0);
    expect(upserts).toEqual([]);
  });
});
