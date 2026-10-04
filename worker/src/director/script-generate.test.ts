import { DEFAULT_DIRECTOR_CONFIG } from "@photonsurge/shared/director";
import { generateShortScript, sceneReadCps } from "./script-generate";

/** Japan with a round-up of `chars` characters and nothing active. */
function fakeDb(o: { chars?: number; readPaceCps?: unknown; sceneExists?: boolean } = {}) {
  const upsert = jest.fn(async (s: any) => s);
  const getOrInitDirectorConfig = jest.fn(async () => ({ ...DEFAULT_DIRECTOR_CONFIG }));
  const getByID = jest.fn(async () => ({ success: false, data: null }));
  const sceneGet = jest.fn(async () =>
    o.sceneExists === false ? { success: false, data: null } : { success: true, data: { id: "shorts", readPaceCps: o.readPaceCps } },
  );
  const db = {
    getOrInitDirectorConfig,
    directorConfig: { getByID },
    broadcastState: { getByID: sceneGet },
    countries: { list: async () => [], get: async () => null },
    regions: { get: async () => null },
    countryRoundups: {
      latestForPlace: async (id: string) => (id === "jp" ? { summary: "x".repeat(o.chars ?? 300), inputs: {} } : null),
    },
    regionRoundups: { latestForPlace: async () => null },
    alerts: { list: async () => [], listByIds: async () => [] },
    quakes: { list: async () => [] },
    volcanoes: { list: async () => [] },
    shortScripts: { upsert },
  };
  return { db: db as any, upsert, getOrInitDirectorConfig, getByID, sceneGet };
}

const japan = { type: "country", id: "japan" };

describe("generateShortScript", () => {
  it("a dry run reads the config without initialising it and saves nothing", async () => {
    const f = fakeDb();
    const script = await generateShortScript(f.db, { scope: japan }, { dryRun: true });
    expect(script.clips).toHaveLength(2);
    expect(f.getByID).toHaveBeenCalledWith("shorts");
    expect(f.sceneGet).toHaveBeenCalledWith("shorts");
    expect(f.getOrInitDirectorConfig).not.toHaveBeenCalled();
    expect(f.upsert).not.toHaveBeenCalled();
  });

  it("sizes the round-up by the scene's read pace, not the default", async () => {
    // 600 characters: 40 s at the default 15 cps, 60 s at the scene's 10 cps.
    const slow = await generateShortScript(fakeDb({ chars: 600, readPaceCps: 10 }).db, { scope: japan }, { dryRun: true });
    expect(slow.clips[0].durationMs).toBe(60_000);
    const unset = await generateShortScript(fakeDb({ chars: 600, sceneExists: false }).db, { scope: japan }, { dryRun: true });
    expect(unset.clips[0].durationMs).toBe(40_000);
  });

  it("turns on only the switches that are literally true", async () => {
    const f = fakeDb();
    const script = await generateShortScript(f.db, { scope: japan, include: { quakes: true, alerts: "yes" } }, { dryRun: true });
    expect(script.include).toEqual({ alerts: false, quakes: true, volcanoes: false });
  });

  it("rejects a malformed scope and an unknown area", async () => {
    const f = fakeDb();
    await expect(generateShortScript(f.db, { scope: { type: "planet" } })).rejects.toThrow(/scope must be/);
    await expect(generateShortScript(f.db, { scope: { type: "area", id: "nowhere" } })).rejects.toThrow(/unknown area id "nowhere"/);
    expect(f.upsert).not.toHaveBeenCalled();
  });
});

describe("sceneReadCps", () => {
  it("clamps the scene's pace and falls back to the default", async () => {
    expect(await sceneReadCps(fakeDb({ readPaceCps: 99 }).db, "shorts")).toBe(24);
    expect(await sceneReadCps(fakeDb({ readPaceCps: "junk" }).db, "shorts")).toBe(15);
    expect(await sceneReadCps(fakeDb({ sceneExists: false }).db, "shorts")).toBe(15);
  });
});
