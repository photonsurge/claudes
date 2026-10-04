jest.mock("@photonsurge/shared/db/index", () => ({ getAppDb: jest.fn() }));
jest.mock("../blog", () => ({ blogInfo: jest.fn(), blogErr: jest.fn() }));
import { UnrecoverableError } from "bullmq";
import { getAppDb } from "@photonsurge/shared/db/index";
import { DEFAULT_DIRECTOR_CONFIG } from "@photonsurge/shared/director";
import * as jobs from "./short-video";
import { generate, seedScenes } from "./short-video";

/** Japan with a round-up and nothing active — enough for a round-up video. */
function fakeDb() {
  const upsert = jest.fn(async (s: any) => s);
  const getOrInitDirectorConfig = jest.fn(async () => ({ ...DEFAULT_DIRECTOR_CONFIG }));
  const getByID = jest.fn(async () => ({ success: false, data: null }));
  const db = {
    getOrInitDirectorConfig,
    directorConfig: { getByID },
    broadcastState: { getByID: jest.fn(async () => ({ success: false, data: null })) },
    countries: { list: async () => [], get: async () => null },
    regions: { get: async () => null },
    countryRoundups: { latestForPlace: async (id: string) => (id === "jp" ? { summary: "x".repeat(300), inputs: {} } : null) },
    regionRoundups: { latestForPlace: async () => null },
    alerts: { list: async () => [], listByIds: async () => [] },
    quakes: { list: async () => [] },
    volcanoes: { list: async () => [] },
    shortScripts: { upsert },
  };
  return { db, upsert, getOrInitDirectorConfig, getByID };
}

const job = (data: unknown) => ({ id: "1", data: { domain: "x", type: "short-video", event: "generate", data } }) as any;

describe("short-video.generate", () => {
  it("saves a round-up draft for the shorts scene by default", async () => {
    const f = fakeDb();
    (getAppDb as jest.Mock).mockResolvedValue(f.db);
    const result = await generate(job({ scope: { type: "country", id: "japan" } }));
    expect(f.getOrInitDirectorConfig).toHaveBeenCalledWith("shorts");
    expect(f.upsert).toHaveBeenCalledTimes(1);
    const saved = f.upsert.mock.calls[0][0];
    expect(saved).toMatchObject({
      template: "lineup",
      status: "draft",
      scope: { type: "country", id: "japan" },
      include: { alerts: false, quakes: false, volcanoes: false },
      title: "Japan round-up",
    });
    expect(saved.clips[0]).toMatchObject({ target: "country:japan", leadSlide: "roundup", durationMs: 20_000 });
    expect(result).toEqual({ id: saved.id, title: "Japan round-up", clips: 2, durationMs: 26_000 });
  });

  it("honours the scene, the switches and a title override", async () => {
    const f = fakeDb();
    (getAppDb as jest.Mock).mockResolvedValue(f.db);
    await generate(job({ scope: { type: "country", id: "japan" }, include: { quakes: true }, sceneId: "other", title: " Mine " }));
    expect(f.getOrInitDirectorConfig).toHaveBeenCalledWith("other");
    expect(f.upsert.mock.calls[0][0]).toMatchObject({ title: "Mine", include: { alerts: false, quakes: true, volcanoes: false } });
  });

  it("rejects an unknown scope, and a round-up video with no round-up, saving nothing", async () => {
    const f = fakeDb();
    (getAppDb as jest.Mock).mockResolvedValue(f.db);
    await expect(generate(job({ scope: { type: "country", id: "atlantis" } }))).rejects.toThrow(/unknown country id "atlantis"/);
    await expect(generate(job({ scope: { type: "area", id: "europe" } }))).rejects.toThrow(/No usable round-up for Europe/);
    await expect(generate(job({}))).rejects.toThrow(/scope must be/);
    // Terminal, so BullMQ doesn't retry an answer only the operator can change.
    await expect(generate(job({}))).rejects.toBeInstanceOf(UnrecoverableError);
    expect(f.upsert).not.toHaveBeenCalled();
  });
});

describe("short-video.seedScenes", () => {
  /** A scene store that starts with whatever `existing` holds. */
  function sceneDb(existing: Record<string, { hidden?: boolean }> = {}) {
    const createScene = jest.fn(async () => true);
    const setSceneHidden = jest.fn(async () => true);
    const getOrInitDirectorConfig = jest.fn(async () => ({ ...DEFAULT_DIRECTOR_CONFIG }));
    const db = { getScene: async (id: string) => existing[id] ?? null, createScene, setSceneHidden, getOrInitDirectorConfig };
    return { db, createScene, setSceneHidden, getOrInitDirectorConfig };
  }
  const seedJob = (data?: unknown) => ({ id: "1", data: { domain: "x", type: "short-video", event: "seedScenes", data } }) as any;

  it("creates both scenes hidden, each with a director config", async () => {
    const f = sceneDb();
    (getAppDb as jest.Mock).mockResolvedValue(f.db);
    const result = await seedScenes(seedJob());
    expect(result.scenes.map((s) => [s.id, s.outcome])).toEqual([
      ["shorts", "created"],
      ["shorts-preview", "created"],
    ]);
    expect(f.createScene).toHaveBeenCalledTimes(2);
    for (const call of f.createScene.mock.calls as unknown as any[][]) expect(call[3]).toEqual({ hidden: true });
    expect(f.getOrInitDirectorConfig).toHaveBeenCalledWith("shorts");
    expect(f.getOrInitDirectorConfig).toHaveBeenCalledWith("shorts-preview");
  });

  it("never overwrites a scene that exists, but re-hides one made visible", async () => {
    const f = sceneDb({ shorts: { hidden: true }, "shorts-preview": { hidden: false } });
    (getAppDb as jest.Mock).mockResolvedValue(f.db);
    const result = await seedScenes(seedJob());
    expect(result.scenes.map((s) => s.outcome)).toEqual(["skipped", "marked hidden"]);
    expect(f.createScene).not.toHaveBeenCalled();
    expect(f.setSceneHidden).toHaveBeenCalledTimes(1);
    expect(f.setSceneHidden).toHaveBeenCalledWith("shorts-preview", true);
  });

  it("re-applies the preset look only when forced", async () => {
    const f = sceneDb({ shorts: { hidden: true }, "shorts-preview": { hidden: true } });
    (getAppDb as jest.Mock).mockResolvedValue(f.db);
    const result = await seedScenes(seedJob({ force: true }));
    expect(result.scenes.map((s) => s.outcome)).toEqual(["re-applied", "re-applied"]);
    expect(f.createScene).toHaveBeenCalledTimes(2);
  });
});

describe("jobs/short-video exports", () => {
  it("exports handlers only — the job loader registers every export", () => {
    expect(Object.keys(jobs).sort()).toEqual(["generate", "seedScenes"]);
  });
});
