jest.mock("@photonsurge/shared/db/index", () => ({ getAppDb: jest.fn() }));
jest.mock("../blog", () => ({ blogInfo: jest.fn(), blogErr: jest.fn() }));
import { UnrecoverableError } from "bullmq";
import { getAppDb } from "@photonsurge/shared/db/index";
import { DEFAULT_DIRECTOR_CONFIG } from "@photonsurge/shared/director";
import { defaultShortFormat, sanitizeShortFormat, type ShortFormat } from "@photonsurge/shared/short-format";
import * as jobs from "./short-video";
import { generate, seedFormat } from "./short-video";

/** Japan with a round-up and nothing active — enough for a round-up video. */
function fakeDb(formats: ShortFormat[] = []) {
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
    shortFormats: { get: async (id: string) => formats.find((f) => f.id === id) ?? null },
  };
  return { db, upsert, getOrInitDirectorConfig, getByID };
}

const job = (data: unknown) => ({ id: "1", data: { domain: "x", type: "short-video", event: "generate", data } }) as any;

describe("short-video.generate", () => {
  it("saves a round-up draft in the default format, tuned by its shorts scene", async () => {
    const f = fakeDb();
    (getAppDb as jest.Mock).mockResolvedValue(f.db);
    const result = await generate(job({ scope: { type: "country", id: "japan" } }));
    expect(f.getOrInitDirectorConfig).toHaveBeenCalledWith("shorts");
    expect(f.upsert).toHaveBeenCalledTimes(1);
    const saved = f.upsert.mock.calls[0][0];
    expect(saved).toMatchObject({
      formatId: "shorts",
      template: "lineup",
      status: "draft",
      scope: { type: "country", id: "japan" },
      include: { alerts: false, quakes: false, volcanoes: false },
      title: "Japan round-up",
    });
    expect(saved.clips[0]).toMatchObject({ target: "country:japan", leadSlide: "roundup", durationMs: 20_000 });
    expect(result).toEqual({ id: saved.id, title: "Japan round-up", clips: 2, durationMs: 26_000 });
  });

  it("honours the format's scene, the switches and a title override", async () => {
    const f = fakeDb([defaultShortFormat("short-other", "Other")]);
    (getAppDb as jest.Mock).mockResolvedValue(f.db);
    await generate(job({ scope: { type: "country", id: "japan" }, include: { quakes: true }, formatId: "short-other", title: " Mine " }));
    expect(f.getOrInitDirectorConfig).toHaveBeenCalledWith("short-other");
    expect(f.upsert.mock.calls[0][0]).toMatchObject({
      formatId: "short-other",
      title: "Mine",
      include: { alerts: false, quakes: true, volcanoes: false },
    });
  });

  it("takes scope, switches and budget from the format's template when the request has none", async () => {
    const uk = sanitizeShortFormat({
      id: "short-japan",
      name: "Japan",
      template: { scope: { type: "country", id: "japan" }, include: { quakes: true } },
      close: { enabled: false },
    })!;
    const f = fakeDb([uk]);
    (getAppDb as jest.Mock).mockResolvedValue(f.db);
    await generate(job({ formatId: "short-japan" }));
    const saved = f.upsert.mock.calls[0][0];
    expect(saved).toMatchObject({ formatId: "short-japan", scope: { type: "country", id: "japan" }, include: { quakes: true } });
    // The format has no close: only the opener.
    expect(saved.clips).toHaveLength(1);
  });

  it("a several-places video names the places it left out; the format's openWithWorld applies", async () => {
    const main = sanitizeShortFormat({
      id: "short-main",
      name: "Main areas",
      template: { scope: { type: "places", places: [{ type: "area", id: "europe" }, { type: "country", id: "japan" }] }, openWithWorld: true },
    })!;
    const f = fakeDb([main]);
    (f.db as any).eventSummaries = { latest: async () => null }; // no fresh world round-up
    (getAppDb as jest.Mock).mockResolvedValue(f.db);
    const result = await generate(job({ formatId: "short-main" }));
    const saved = f.upsert.mock.calls[0][0];
    expect(saved.scope).toEqual(main.template.scope);
    expect(saved.clips.map((c: any) => c.target)).toEqual(["country:japan", "global:spin"]);
    expect(result.skipped).toEqual([
      { place: "area:europe", name: "Europe", reason: "no usable round-up" },
      { place: "world", name: "World", reason: "no fresh world round-up" },
    ]);
  });

  it("refuses an unknown format", async () => {
    const f = fakeDb();
    (getAppDb as jest.Mock).mockResolvedValue(f.db);
    await expect(generate(job({ formatId: "short-ghost", scope: { type: "globe" } }))).rejects.toThrow(/no format "short-ghost"/);
    expect(f.upsert).not.toHaveBeenCalled();
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

describe("short-video.seedFormat", () => {
  /** A scene + format store that starts with whatever it's given. */
  function seedDb(scene: Record<string, unknown> | null = null, settings: ShortFormat | null = null) {
    const createScene = jest.fn(async () => true);
    const setSceneMeta = jest.fn(async () => true);
    const getOrInitDirectorConfig = jest.fn(async () => ({ ...DEFAULT_DIRECTOR_CONFIG }));
    const upsert = jest.fn(async (f: ShortFormat) => f);
    const db = {
      getScene: async (id: string) => (id === "shorts" ? scene : null),
      createScene,
      setSceneMeta,
      getOrInitDirectorConfig,
      shortFormats: { get: async (id: string) => (id === "shorts" ? settings : null), upsert },
    };
    return { db, createScene, setSceneMeta, getOrInitDirectorConfig, upsert };
  }
  const seedJob = (data?: unknown) => ({ id: "1", data: { domain: "x", type: "short-video", event: "seedFormat", data } }) as any;

  it("creates the shorts scene hidden and short, with a director config, and the default settings", async () => {
    const f = seedDb();
    (getAppDb as jest.Mock).mockResolvedValue(f.db);
    const result = await seedFormat(seedJob());
    expect(result).toEqual({ id: "shorts", name: "Round-up", scene: "created", settings: "created" });
    expect(f.createScene).toHaveBeenCalledTimes(1);
    const call = (f.createScene.mock.calls as unknown as any[][])[0];
    expect(call[0]).toBe("shorts");
    expect(call[3]).toEqual({ hidden: true, kind: "short" });
    expect(f.getOrInitDirectorConfig).toHaveBeenCalledWith("shorts");
    expect(f.upsert).toHaveBeenCalledWith(defaultShortFormat());
  });

  it("never overwrites an existing scene, but marks it hidden and short and names it after the format", async () => {
    const f = seedDb({ id: "shorts", name: "Shorts · Render", hidden: true });
    (getAppDb as jest.Mock).mockResolvedValue(f.db);
    const result = await seedFormat(seedJob());
    expect(result).toMatchObject({ scene: "marked short", settings: "created" });
    expect(f.createScene).not.toHaveBeenCalled();
    expect(f.setSceneMeta).toHaveBeenCalledWith("shorts", { hidden: true, kind: "short" });
    expect(f.setSceneMeta).toHaveBeenCalledWith("shorts", { name: "Round-up" });
  });

  it("skips what already exists, keeping the operator's settings", async () => {
    const mine = defaultShortFormat("shorts", "My round-up");
    const f = seedDb({ id: "shorts", name: "My round-up", hidden: true, kind: "short" }, mine);
    (getAppDb as jest.Mock).mockResolvedValue(f.db);
    expect(await seedFormat(seedJob())).toEqual({ id: "shorts", name: "My round-up", scene: "skipped", settings: "skipped" });
    expect(f.setSceneMeta).not.toHaveBeenCalled();
    expect(f.upsert).not.toHaveBeenCalled();
  });

  it("re-applies the seed look only when forced, under the format's name", async () => {
    const mine = defaultShortFormat("shorts", "My round-up");
    const f = seedDb({ id: "shorts", name: "My round-up", hidden: true, kind: "short" }, mine);
    (getAppDb as jest.Mock).mockResolvedValue(f.db);
    expect(await seedFormat(seedJob({ force: true }))).toMatchObject({ scene: "re-applied", settings: "skipped" });
    expect((f.createScene.mock.calls as unknown as any[][])[0][1]).toBe("My round-up");
    expect(f.upsert).not.toHaveBeenCalled();
  });
});

describe("jobs/short-video exports", () => {
  it("exports handlers only — the job loader registers every export", () => {
    expect(Object.keys(jobs).sort()).toEqual(["generate", "runBatch", "seedFormat", "tick"]);
  });
});
