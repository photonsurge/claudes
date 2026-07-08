import mongoose from "mongoose";
import { createDb } from "./index";
import { DEFAULT_CONTROL_STATE, MAIN_SCENE_ID } from "../control";
import { DEFAULT_DIRECTOR_CONFIG } from "../director";
import { BROADCAST_STATE_ID } from "./broadcast-state-model";

/**
 * The db facade wires ~35 repos onto one connection plus a handful of
 * logic-bearing convenience methods. Model registration works offline, so an
 * UNOPENED connection is enough — each test stubs the closure-shared
 * weatherRuns/broadcastState/directorConfig repos, so no query ever executes.
 */
const conn = mongoose.createConnection();
afterAll(async () => {
  await conn.destroy().catch(() => undefined);
});

const freshDb = () => createDb(conn);
const ok = <T>(data: T) => ({ success: true, data });
const missing = { success: false };
const HEX48 = /^[0-9a-f]{48}$/; // randomBytes(24).toString("hex")

describe("createDb wiring", () => {
  it("exposes every repo on the one shared connection", () => {
    const db = freshDb();
    expect(db.conn).toBe(conn);
    const repos = [
      "pings", "weatherRuns", "weatherTextures", "weatherFrames", "weatherForecastFrames",
      "climateYears", "cities", "alerts", "satelliteTles", "trackSnapshots", "quakes",
      "tideStations", "tideSeries", "seismoStations", "seismoSeries", "eventSummaries",
      "cables", "faults", "aurora", "satimg", "fires", "volcanoes", "countries", "regions",
      "areaWeatherReports", "geomag", "cams", "seaPoints", "ads", "aircraftMeta", "vehicles",
      "logs", "airLog", "users", "broadcastState", "directorConfig",
    ] as const;
    for (const key of repos) expect(db[key]).toBeDefined();
  });
});

describe("latestPublishedRun(sByModel)", () => {
  it("latestPublishedRun asks for exactly the newest published run", async () => {
    const db = freshDb();
    const getAll = jest.fn(async () => ok([{ model: "gfs", run: "2026-07-08T06" }]));
    (db.weatherRuns as any).getAll = getAll;
    const run = await db.latestPublishedRun();
    expect(getAll).toHaveBeenCalledWith({ published: true }, { sort: { run: -1 }, limit: 1 });
    expect(run).toMatchObject({ model: "gfs" });
  });

  it("latestPublishedRun is null when nothing is published or the read fails", async () => {
    const db = freshDb();
    (db.weatherRuns as any).getAll = jest.fn(async () => ok([]));
    expect(await db.latestPublishedRun()).toBeNull();
    (db.weatherRuns as any).getAll = jest.fn(async () => missing);
    expect(await db.latestPublishedRun()).toBeNull();
  });

  it("latestPublishedRunsByModel keeps only the first (newest) run per model, tiebroken by generatedAt in the query", async () => {
    const db = freshDb();
    const rows = [
      { model: "gfs", run: "2026-07-08T06" },
      { model: "rtofs", run: "2026-07-08T00" },
      { model: "gfs", run: "2026-07-08T00" }, // older duplicate — must lose
    ];
    const getAll = jest.fn(async () => ok(rows));
    (db.weatherRuns as any).getAll = getAll;
    const kept = await db.latestPublishedRunsByModel();
    // Re-bakes of the same cycle share a `run`; the generatedAt tiebreak makes
    // the newest bake sort first so the walk below keeps it.
    expect(getAll).toHaveBeenCalledWith({ published: true }, { sort: { run: -1, generatedAt: -1 } });
    expect(kept).toEqual([rows[0], rows[1]]);
  });
});

describe("watch tokens", () => {
  it("ensureWatchToken leaves a doc that already has one untouched", async () => {
    const db = freshDb();
    const updateByID = jest.fn();
    (db.broadcastState as any).updateByID = updateByID;
    const doc = { id: "default", watchToken: "existing" };
    expect(await db.ensureWatchToken(doc)).toBe(doc);
    expect(updateByID).not.toHaveBeenCalled();
  });

  it("ensureWatchToken backfills a 48-hex token onto a legacy doc and persists it", async () => {
    const db = freshDb();
    const updateByID = jest.fn(async (_id: string, patch: any) => ok({ id: "default", ...patch }));
    (db.broadcastState as any).updateByID = updateByID;
    const out = await db.ensureWatchToken({ id: "default" });
    expect(out.watchToken).toMatch(HEX48);
    expect(updateByID).toHaveBeenCalledWith("default", { watchToken: out.watchToken });
  });

  it("ensureWatchToken falls back to the in-memory token when the update returns no data", async () => {
    const db = freshDb();
    (db.broadcastState as any).updateByID = jest.fn(async () => missing);
    const out = await db.ensureWatchToken({ id: "default", name: "Main" });
    expect(out).toMatchObject({ id: "default", name: "Main" });
    expect(out.watchToken).toMatch(HEX48);
  });

  it("rotateSceneToken issues a fresh token for a named scene and persists it", async () => {
    const db = freshDb();
    (db.broadcastState as any).getByID = jest.fn(async () => ok({ id: "studio-b", watchToken: "old" }));
    const updateByID = jest.fn(async () => ok({}));
    (db.broadcastState as any).updateByID = updateByID;
    const token = await db.rotateSceneToken("studio-b");
    expect(token).toMatch(HEX48);
    expect(token).not.toBe("old");
    expect(updateByID).toHaveBeenCalledWith("studio-b", { watchToken: token });
  });

  it("rotateSceneToken is null for a scene that doesn't exist", async () => {
    const db = freshDb();
    (db.broadcastState as any).getByID = jest.fn(async () => missing);
    const updateByID = jest.fn();
    (db.broadcastState as any).updateByID = updateByID;
    expect(await db.rotateSceneToken("ghost")).toBeNull();
    expect(updateByID).not.toHaveBeenCalled();
  });
});

describe("broadcast state singleton", () => {
  it("returns the existing singleton (token already ensured)", async () => {
    const db = freshDb();
    const doc = { id: BROADCAST_STATE_ID, name: "Main", watchToken: "tok" };
    (db.broadcastState as any).getByID = jest.fn(async () => ok(doc));
    const upsertByID = jest.fn();
    (db.broadcastState as any).upsertByID = upsertByID;
    expect(await db.getOrInitBroadcastState()).toBe(doc);
    expect(upsertByID).not.toHaveBeenCalled();
  });

  it("seeds the singleton from DEFAULT_CONTROL_STATE named 'Main' when absent", async () => {
    const db = freshDb();
    (db.broadcastState as any).getByID = jest.fn(async () => missing);
    const seeded = { id: BROADCAST_STATE_ID, name: "Main" };
    const upsertByID = jest.fn(async () => ok(seeded));
    (db.broadcastState as any).upsertByID = upsertByID;
    expect(await db.getOrInitBroadcastState()).toBe(seeded);
    expect(upsertByID).toHaveBeenCalledWith(BROADCAST_STATE_ID, {
      ...DEFAULT_CONTROL_STATE,
      name: "Main",
    });
  });
});

describe("director config", () => {
  it("merges a stored config over the defaults without re-seeding", async () => {
    const db = freshDb();
    (db.directorConfig as any).getByID = jest.fn(async () => ok({ mode: "auto" }));
    const upsertByID = jest.fn();
    (db.directorConfig as any).upsertByID = upsertByID;
    const cfg = await db.getOrInitDirectorConfig("studio-b");
    expect(cfg.mode).toBe("auto"); // stored value wins
    expect(cfg.kinds).toEqual(DEFAULT_DIRECTOR_CONFIG.kinds); // defaults fill the rest
    expect(upsertByID).not.toHaveBeenCalled();
  });

  it("seeds and returns a copy of the defaults when absent", async () => {
    const db = freshDb();
    (db.directorConfig as any).getByID = jest.fn(async () => missing);
    const upsertByID = jest.fn(async () => ok({}));
    (db.directorConfig as any).upsertByID = upsertByID;
    const cfg = await db.getOrInitDirectorConfig("studio-b");
    expect(cfg).toEqual(DEFAULT_DIRECTOR_CONFIG);
    expect(cfg).not.toBe(DEFAULT_DIRECTOR_CONFIG); // a copy, not the shared constant
    expect(upsertByID).toHaveBeenCalledWith("studio-b", { ...DEFAULT_DIRECTOR_CONFIG });
  });

  it("autoDirectorScenes returns the ids of scenes whose director is on auto", async () => {
    const db = freshDb();
    const getAll = jest.fn(async () => ok([{ id: "default" }, { id: "studio-b" }]));
    (db.directorConfig as any).getAll = getAll;
    expect(await db.autoDirectorScenes()).toEqual(["default", "studio-b"]);
    expect(getAll).toHaveBeenCalledWith({ mode: "auto" }, { limit: 0 });
  });
});

describe("scenes", () => {
  it("listScenes puts the main scene first, then named scenes alphabetically, with name fallbacks", async () => {
    const db = freshDb();
    const docs = [
      { id: "zeta", name: "Zeta", updated: "2026-07-01" },
      { id: MAIN_SCENE_ID, watchToken: "tok" }, // legacy main doc without a name
      { id: "alpha", name: "Alpha", updatedAt: "2026-07-02" },
    ];
    (db.broadcastState as any).getAll = jest.fn(async () => ok(docs));
    const scenes = await db.listScenes();
    expect(scenes.map((s) => s.id)).toEqual([MAIN_SCENE_ID, "alpha", "zeta"]);
    expect(scenes[0].name).toBe("Main"); // fallback name for the main scene
    expect(scenes[1].updatedAt).toBe("2026-07-02"); // `updated` OR legacy `updatedAt`
    expect(scenes[2].updatedAt).toBe("2026-07-01");
  });

  it("createScene seeds from DEFAULT_CONTROL_STATE, letting the seed override, and stamps the name", async () => {
    const db = freshDb();
    const upsertByID = jest.fn(async () => ok({ id: "studio-b" }));
    (db.broadcastState as any).upsertByID = upsertByID;
    const created = await db.createScene("studio-b", "Studio B", { showAlerts: false } as any);
    expect(created).toEqual({ id: "studio-b" });
    const [id, payload] = upsertByID.mock.calls[0] as any[];
    expect(id).toBe("studio-b");
    expect(payload).toEqual({ ...DEFAULT_CONTROL_STATE, showAlerts: false, name: "Studio B" });
  });

  it("deleteScene refuses to delete the main scene but removes named ones", async () => {
    const db = freshDb();
    const deleteByID = jest.fn(async () => ({ success: true }));
    (db.broadcastState as any).deleteByID = deleteByID;
    expect(await db.deleteScene(MAIN_SCENE_ID)).toBe(false);
    expect(deleteByID).not.toHaveBeenCalled();
    expect(await db.deleteScene("studio-b")).toBe(true);
    expect(deleteByID).toHaveBeenCalledWith("studio-b");
  });
});
