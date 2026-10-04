import { DEFAULT_CONTROL_STATE, MAIN_SCENE_ID } from "../control";
import { DEFAULT_DIRECTOR_CONFIG } from "../director";
import { defaultShortFormat, sanitizeShortFormat, type ShortFormat } from "../short-format";
import { copyLookFrom, deleteFormat, duplicateFormat, formatIdForName, resolveFormatSource, saveFormat } from "./short-format-copy";

/**
 * An in-memory db with just what the format helpers touch: scene docs,
 * director configs (merge-on-save, like the real one), format settings and a
 * script count per format.
 */
function fakeDb(o: { scenes?: Record<string, any>; formats?: ShortFormat[]; scriptsByFormat?: Record<string, number> } = {}) {
  const scenes: Record<string, any> = { ...(o.scenes ?? {}) };
  const configs: Record<string, any> = {};
  const formats = new Map((o.formats ?? []).map((f) => [f.id, f]));
  const db = {
    getScene: jest.fn(async (id: string) => scenes[id] ?? null),
    getOrInitBroadcastState: jest.fn(async () => scenes[MAIN_SCENE_ID] ?? { id: MAIN_SCENE_ID, name: "Main" }),
    createScene: jest.fn(async (id: string, name: string, seed: any, opts: any = {}) => {
      scenes[id] = { ...(scenes[id] ?? { watchToken: `tok-${id}` }), ...seed, name, ...opts, id };
      return scenes[id];
    }),
    setSceneMeta: jest.fn(async (id: string, meta: any) => {
      scenes[id] = { ...scenes[id], ...meta };
      return true;
    }),
    deleteScene: jest.fn(async (id: string) => delete scenes[id]),
    getOrInitDirectorConfig: jest.fn(async (id: string) => ({ ...DEFAULT_DIRECTOR_CONFIG, ...(configs[id] ?? {}) })),
    saveDirectorConfig: jest.fn(async (id: string, patch: any) => (configs[id] = { ...(configs[id] ?? {}), ...patch })),
    deleteDirectorConfig: jest.fn(async (id: string) => delete configs[id]),
    shortFormats: {
      get: jest.fn(async (id: string) => formats.get(id) ?? null),
      upsert: jest.fn(async (f: ShortFormat) => (formats.set(f.id, f), f)),
      remove: jest.fn(async (id: string) => formats.delete(id)),
    },
    shortScripts: { countByFormat: jest.fn(async (id: string) => o.scriptsByFormat?.[id] ?? 0) },
  };
  return { db: db as any, scenes, configs, formats };
}

const windScene = { id: "wind", name: "Wind", watchToken: "tok-wind", showWind: false, basemap: "satellite", hidden: false };

describe("formatIdForName", () => {
  it("slugs the name behind the short- prefix", () => {
    expect(formatIdForName("UK Round-up!")).toBe("short-uk-round-up");
    expect(formatIdForName("  ")).toBe("");
  });
});

describe("resolveFormatSource", () => {
  it("prefers a format, else any scene (incl. main) as a channel, else null", async () => {
    const fmt = defaultShortFormat("short-a", "A");
    const { db } = fakeDb({ scenes: { wind: windScene, "short-a": { id: "short-a" } }, formats: [fmt] });
    expect(await resolveFormatSource(db, "short-a")).toEqual({ type: "format", format: fmt });
    expect(await resolveFormatSource(db, "wind")).toEqual({ type: "channel", sceneId: "wind" });
    expect(await resolveFormatSource(db, MAIN_SCENE_ID)).toEqual({ type: "channel", sceneId: MAIN_SCENE_ID });
    expect(await resolveFormatSource(db, "nope")).toBeNull();
    expect(await resolveFormatSource(db, "")).toBeNull();
  });
});

describe("duplicateFormat", () => {
  it("copies a channel's look and director into a new hidden short scene, with default settings", async () => {
    const f = fakeDb({ scenes: { wind: windScene } });
    f.configs.wind = { mode: "auto", skipNonce: 9, transitionSeconds: 7, script: { scriptId: "s", fromClip: 0, playNonce: 1, record: false } };
    const res = await duplicateFormat(f.db, { name: "Wind round-up", from: "wind" });
    expect(res).toEqual({ ok: true, format: defaultShortFormat("short-wind-round-up", "Wind round-up") });

    const scene = f.scenes["short-wind-round-up"];
    expect(scene).toMatchObject({ name: "Wind round-up", hidden: true, kind: "short", showWind: false, basemap: "satellite" });
    // A fresh token, never the source's — no link back.
    expect(scene.watchToken).toBe("tok-short-wind-round-up");
    const cfg = f.configs["short-wind-round-up"];
    expect(cfg).toMatchObject({ mode: "off", skipNonce: 0, transitionSeconds: 7 });
    expect(cfg).not.toHaveProperty("script");
  });

  it("from a format copies its short settings too, under the new id and name", async () => {
    const src = sanitizeShortFormat({ id: "short-a", name: "A", opener: { roundupDepth: "summary" }, close: { enabled: false } })!;
    const f = fakeDb({ scenes: { "short-a": { id: "short-a", name: "A", kind: "short", basemap: "dark" } }, formats: [src] });
    const res = await duplicateFormat(f.db, { name: "B", from: "short-a" });
    expect(res.ok && res.format).toEqual({ ...src, id: "short-b", name: "B" });
    expect(f.scenes["short-b"]).toMatchObject({ kind: "short", hidden: true, basemap: "dark" });
  });

  it("refuses an empty name, a taken id and a missing source", async () => {
    const f = fakeDb({ scenes: { wind: windScene, "short-taken": { id: "short-taken" } } });
    expect(await duplicateFormat(f.db, { name: " ", from: "wind" })).toMatchObject({ ok: false, code: "bad-name" });
    expect(await duplicateFormat(f.db, { name: "Taken", from: "wind" })).toMatchObject({ ok: false, code: "exists" });
    expect(await duplicateFormat(f.db, { name: "New", from: "ghost" })).toMatchObject({ ok: false, code: "no-source" });
    expect(f.db.createScene).not.toHaveBeenCalled();
    expect(f.db.shortFormats.upsert).not.toHaveBeenCalled();
  });
});

describe("copyLookFrom", () => {
  it("re-copies look and director, keeping the format's settings, scene identity and play state", async () => {
    const fmt = sanitizeShortFormat({ id: "short-a", name: "A", close: { ms: 3_000 } })!;
    const f = fakeDb({
      scenes: { wind: windScene, "short-a": { id: "short-a", name: "A", kind: "short", hidden: true, watchToken: "keep", basemap: "dark" } },
      formats: [fmt],
    });
    f.configs["short-a"] = { mode: "script", script: { scriptId: "s1", fromClip: 0, playNonce: 5, record: false }, transitionSeconds: 2 };
    f.configs.wind = { mode: "auto", skipNonce: 3, transitionSeconds: 9 };

    expect(await copyLookFrom(f.db, "short-a", "wind")).toEqual({ ok: true, format: fmt });
    expect(f.scenes["short-a"]).toMatchObject({ id: "short-a", name: "A", kind: "short", hidden: true, watchToken: "keep", basemap: "satellite", showWind: false });
    expect(f.configs["short-a"]).toMatchObject({ mode: "script", transitionSeconds: 9, script: { scriptId: "s1" } });
    expect(f.db.shortFormats.upsert).not.toHaveBeenCalled();
  });

  it("refuses an unknown format, an unknown source and copying from itself", async () => {
    const fmt = defaultShortFormat("short-a", "A");
    const f = fakeDb({ scenes: { "short-a": { id: "short-a" } }, formats: [fmt] });
    expect(await copyLookFrom(f.db, "short-x", "short-a")).toMatchObject({ ok: false, code: "no-source" });
    expect(await copyLookFrom(f.db, "short-a", "ghost")).toMatchObject({ ok: false, code: "no-source" });
    expect(await copyLookFrom(f.db, "short-a", "short-a")).toMatchObject({ ok: false });
    expect(f.db.createScene).not.toHaveBeenCalled();
  });

  it("copies the main scene's look when asked", async () => {
    const fmt = defaultShortFormat("short-a", "A");
    const f = fakeDb({ scenes: { [MAIN_SCENE_ID]: { id: MAIN_SCENE_ID, name: "Main", basemap: "night" }, "short-a": { id: "short-a" } }, formats: [fmt] });
    await copyLookFrom(f.db, "short-a", MAIN_SCENE_ID);
    expect(f.scenes["short-a"].basemap).toBe("night");
    expect(f.scenes["short-a"].fhr).toBe(DEFAULT_CONTROL_STATE.fhr);
  });
});

describe("saveFormat", () => {
  it("keeps the scene's name in step with the format's", async () => {
    const f = fakeDb({ scenes: { "short-a": { id: "short-a", name: "Old" } } });
    await saveFormat(f.db, defaultShortFormat("short-a", "New"));
    expect(f.scenes["short-a"].name).toBe("New");
    await saveFormat(f.db, defaultShortFormat("short-a", "New"));
    expect(f.db.setSceneMeta).toHaveBeenCalledTimes(1);
  });
});

describe("deleteFormat", () => {
  it("refuses the default format and a format scripts use, saying how many", async () => {
    const f = fakeDb({ formats: [defaultShortFormat(), defaultShortFormat("short-a", "A")], scriptsByFormat: { "short-a": 3 } });
    expect(await deleteFormat(f.db, "shorts")).toMatchObject({ ok: false, code: "default" });
    const used = await deleteFormat(f.db, "short-a");
    expect(used).toMatchObject({ ok: false, code: "in-use", scripts: 3 });
    expect(!used.ok && used.error).toMatch(/3 scripts use this format/);
    expect(await deleteFormat(f.db, "short-x")).toMatchObject({ ok: false, code: "not-found" });
    expect(f.db.shortFormats.remove).not.toHaveBeenCalled();
  });

  it("removes the settings, the scene and its director config", async () => {
    const f = fakeDb({ scenes: { "short-a": { id: "short-a" } }, formats: [defaultShortFormat("short-a", "A")] });
    f.configs["short-a"] = { mode: "off" };
    expect(await deleteFormat(f.db, "short-a")).toEqual({ ok: true });
    expect(f.formats.has("short-a")).toBe(false);
    expect(f.scenes["short-a"]).toBeUndefined();
    expect(f.configs["short-a"]).toBeUndefined();
  });
});
