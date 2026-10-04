import { DEFAULT_DIRECTOR_CONFIG } from "@photonsurge/shared/director";
import { sanitizeShortFormat, type ShortFormat } from "@photonsurge/shared/short-format";
import { generateFormat, generateShortScript, sceneReadCps } from "./script-generate";

/** Japan with a round-up of `chars` characters and nothing active. */
function fakeDb(o: { chars?: number; readPaceCps?: unknown; sceneExists?: boolean; formats?: ShortFormat[] } = {}) {
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
    shortFormats: { get: async (id: string) => o.formats?.find((f) => f.id === id) ?? null },
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

describe("generateShortScript — formats", () => {
  const summaryFormat = sanitizeShortFormat({
    id: "short-brief",
    name: "Brief",
    template: { scope: japan, budgetMs: 40_000 },
    opener: { roundupDepth: "summary", tour: false, leadWithRoundup: false },
    close: { ms: 3_000 },
  })!;

  it("reads its scene's config and pace and records the format on the script", async () => {
    const f = fakeDb({ formats: [summaryFormat] });
    const script = await generateShortScript(f.db, { formatId: "short-brief" }, { dryRun: true });
    expect(f.getByID).toHaveBeenCalledWith("short-brief");
    expect(f.sceneGet).toHaveBeenCalledWith("short-brief");
    expect(script.formatId).toBe("short-brief");
    expect(script.scope).toEqual(japan);
  });

  it("lets the format's opener and close shape the lineup", async () => {
    const f = fakeDb({ formats: [summaryFormat] });
    const [opener, close] = (await generateShortScript(f.db, { formatId: "short-brief" }, { dryRun: true })).clips;
    expect(opener).toMatchObject({ roundupDepth: "summary", maxStops: 0 });
    expect(opener).not.toHaveProperty("leadSlide");
    expect(close.durationMs).toBe(3_000);
  });

  it("the request overrides the format's scope", async () => {
    const f = fakeDb({ formats: [summaryFormat] });
    await expect(generateShortScript(f.db, { formatId: "short-brief", scope: { type: "area", id: "nowhere" } }, { dryRun: true })).rejects.toThrow(
      /unknown area id/,
    );
  });

  it("works on the default format before it is seeded, and refuses another unknown one", async () => {
    const f = fakeDb();
    expect((await generateFormat(f.db)).id).toBe("shorts");
    await expect(generateFormat(f.db, "short-ghost")).rejects.toThrow(/no format "short-ghost"/);
  });

  it("says when neither the request nor the format names a scope", async () => {
    await expect(generateShortScript(fakeDb().db, {}, { dryRun: true })).rejects.toThrow(/names none/);
  });
});

describe("sceneReadCps", () => {
  it("clamps the scene's pace and falls back to the default", async () => {
    expect(await sceneReadCps(fakeDb({ readPaceCps: 99 }).db, "shorts")).toBe(24);
    expect(await sceneReadCps(fakeDb({ readPaceCps: "junk" }).db, "shorts")).toBe(15);
    expect(await sceneReadCps(fakeDb({ sceneExists: false }).db, "shorts")).toBe(15);
  });
});
