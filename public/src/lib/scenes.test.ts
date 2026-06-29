import {
  CONTROL_STATE,
  SCENE_STATE,
  MAIN_SCENE_ID,
  DEFAULT_CONTROL_STATE,
} from "@photonsurge/shared/control";
import { emitSceneState, listScenes, createScene, deleteScene } from "./scenes";

describe("emitSceneState", () => {
  it("emits a scene envelope and persists for a named scene", () => {
    const emit = jest.fn();
    const persist = jest.fn();
    emitSceneState({ emit }, "atlantic", DEFAULT_CONTROL_STATE, persist);
    expect(emit).toHaveBeenCalledWith(SCENE_STATE, { id: "atlantic", state: DEFAULT_CONTROL_STATE });
    // A named scene must NOT fan the legacy CONTROL_STATE.
    expect(emit).not.toHaveBeenCalledWith(CONTROL_STATE, expect.anything());
    expect(persist).toHaveBeenCalledWith("atlantic", DEFAULT_CONTROL_STATE);
  });

  it("also fans legacy CONTROL_STATE for the main scene", () => {
    const emit = jest.fn();
    emitSceneState({ emit }, MAIN_SCENE_ID, DEFAULT_CONTROL_STATE, jest.fn());
    expect(emit).toHaveBeenCalledWith(SCENE_STATE, { id: MAIN_SCENE_ID, state: DEFAULT_CONTROL_STATE });
    expect(emit).toHaveBeenCalledWith(CONTROL_STATE, DEFAULT_CONTROL_STATE);
  });

  it("still persists when there is no socket", () => {
    const persist = jest.fn();
    emitSceneState(null, "x", DEFAULT_CONTROL_STATE, persist);
    expect(persist).toHaveBeenCalled();
  });
});

describe("scene CRUD wrappers", () => {
  const mockFetch = (impl: (url: string, init?: RequestInit) => Partial<Response>) => {
    global.fetch = jest.fn((url: string, init?: RequestInit) => {
      const r = impl(String(url), init);
      return Promise.resolve({
        ok: r.ok ?? true,
        status: r.status ?? 200,
        json: () => Promise.resolve((r as { _json?: unknown })._json ?? {}),
        ...r,
      } as Response);
    }) as unknown as typeof fetch;
  };

  afterEach(() => jest.restoreAllMocks());

  it("listScenes returns the parsed array, [] on failure", async () => {
    mockFetch(() => ({ _json: { scenes: [{ id: "default", name: "Main" }] } } as never));
    expect(await listScenes()).toEqual([{ id: "default", name: "Main" }]);

    mockFetch(() => ({ ok: false, status: 500 }));
    expect(await listScenes()).toEqual([]);
  });

  it("createScene returns the new id on 201 and the error on failure", async () => {
    mockFetch(() => ({ status: 201, _json: { id: "atlantic-wind" } } as never));
    expect(await createScene("Atlantic Wind")).toEqual({ id: "atlantic-wind" });

    mockFetch(() => ({ ok: false, status: 409, _json: { error: "exists" } } as never));
    expect(await createScene("Atlantic Wind")).toEqual({ error: "exists" });
  });

  it("deleteScene reports ok / error", async () => {
    mockFetch(() => ({ _json: { ok: true } } as never));
    expect(await deleteScene("atlantic-wind")).toEqual({ ok: true });

    mockFetch(() => ({ ok: false, status: 400, _json: { error: "protected" } } as never));
    expect(await deleteScene("default")).toEqual({ ok: false, error: "protected" });
  });
});
