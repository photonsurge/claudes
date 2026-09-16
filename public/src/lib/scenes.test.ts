import {
  CONTROL_STATE,
  SCENE_STATE,
  MAIN_SCENE_ID,
  DEFAULT_CONTROL_STATE,
  type ControlState,
} from "@photonsurge/shared/control";
import { renderHook, act } from "@testing-library/react";
import {
  emitSceneState,
  emitScenePatch,
  listScenes,
  createScene,
  deleteScene,
  fetchSceneState,
  loadSceneState,
  rotateSceneToken,
  useSceneState,
} from "./scenes";

/** A socket whose handlers the hook tests fire by hand (SCENE_STATE, connect). */
const socketHandlers = new Map<string, (p?: unknown) => void>();
const fakeSocket = {
  on: (e: string, fn: (p?: unknown) => void) => socketHandlers.set(e, fn),
  off: (e: string) => socketHandlers.delete(e),
};
jest.mock("./socket-provider", () => ({ useSocket: () => ({ socket: fakeSocket, connected: true }) }));

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

describe("emitScenePatch", () => {
  it("sends ONLY the delta (never a full state) and persists it", () => {
    const emit = jest.fn();
    const persist = jest.fn();
    const patch: Partial<ControlState> = { widgetsOff: ["seismic"] };
    emitScenePatch({ emit }, "atlantic", patch, persist);
    // The SCENE_STATE envelope's `state` is the partial patch, not a full state.
    expect(emit).toHaveBeenCalledWith(SCENE_STATE, { id: "atlantic", state: patch });
    // A named scene must NOT fan the legacy CONTROL_STATE.
    expect(emit).not.toHaveBeenCalledWith(CONTROL_STATE, expect.anything());
    expect(persist).toHaveBeenCalledWith("atlantic", patch);
  });

  it("also fans the legacy CONTROL_STATE delta for the main scene", () => {
    const emit = jest.fn();
    const patch: Partial<ControlState> = { widgetsOff: ["leftDeck"] };
    emitScenePatch({ emit }, MAIN_SCENE_ID, patch, jest.fn());
    expect(emit).toHaveBeenCalledWith(SCENE_STATE, { id: MAIN_SCENE_ID, state: patch });
    expect(emit).toHaveBeenCalledWith(CONTROL_STATE, patch);
  });

  it("still persists the delta when there is no socket", () => {
    const persist = jest.fn();
    emitScenePatch(null, "x", { widgetsOff: [] }, persist);
    expect(persist).toHaveBeenCalledWith("x", { widgetsOff: [] });
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

  it("fetchSceneState flags a 401 as tokenError, distinct from other failures", async () => {
    mockFetch(() => ({ _json: { activeVariable: "temp" } } as never));
    expect(await fetchSceneState("default")).toEqual(
      expect.objectContaining({ tokenError: false, state: expect.objectContaining({ activeVariable: "temp" }) }),
    );

    mockFetch(() => ({ ok: false, status: 401 }));
    const { tokenError, state, ok } = await fetchSceneState("default", "bad-token");
    expect(tokenError).toBe(true);
    expect(ok).toBe(false);
    expect(state).toEqual(DEFAULT_CONTROL_STATE);

    mockFetch(() => ({ ok: false, status: 404 }));
    expect(await fetchSceneState("missing")).toEqual(expect.objectContaining({ tokenError: false, ok: false }));
  });

  it("loadSceneState is null on a transient failure (retry) but final on a 401", async () => {
    mockFetch(() => ({ ok: false, status: 503 }));
    expect(await loadSceneState("default")).toBeNull();
    global.fetch = jest.fn(async () => {
      throw new Error("refused");
    }) as unknown as typeof fetch;
    expect(await loadSceneState("default")).toBeNull();
    mockFetch(() => ({ ok: false, status: 401 }));
    expect(await loadSceneState("default", "x")).toEqual(expect.objectContaining({ tokenError: true }));
    mockFetch(() => ({ _json: { activeVariable: "temp" } }) as never);
    expect((await loadSceneState("default"))?.state.activeVariable).toBe("temp");
  });

  it("fetchSceneState appends the token as a query param", async () => {
    let calledUrl = "";
    mockFetch((url) => {
      calledUrl = url;
      return { _json: {} } as never;
    });
    await fetchSceneState("default", "abc123");
    expect(calledUrl).toBe("/api/scenes/default?token=abc123");
  });

  it("rotateSceneToken returns the new token or the error", async () => {
    mockFetch(() => ({ _json: { watchToken: "new-token" } } as never));
    expect(await rotateSceneToken("default")).toEqual({ token: "new-token" });

    mockFetch(() => ({ ok: false, status: 404, _json: { error: "no such scene" } } as never));
    expect(await rotateSceneToken("missing")).toEqual({ error: "no such scene" });
  });
});

describe("useSceneState (cold start + re-sync)", () => {
  /** Let pending promises + 0-ms timers settle under fake timers. */
  const flush = () => act(() => jest.advanceTimersByTimeAsync(0));
  const respond = (queue: (number | Partial<ControlState>)[]) => {
    global.fetch = jest.fn(async () => {
      const next = queue.shift() ?? 500;
      if (typeof next === "number") return { ok: false, status: next, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => next };
    }) as unknown as typeof fetch;
  };

  beforeEach(() => {
    jest.useFakeTimers();
    socketHandlers.clear();
  });
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it("keeps retrying a 5xx cold start instead of settling on DEFAULT_CONTROL_STATE", async () => {
    respond([504, 502, { audio: { ...DEFAULT_CONTROL_STATE.audio, enabled: true } }]);
    const { result } = renderHook(() => useSceneState("default", "tok"));
    await flush();
    expect(result.current.ready).toBe(false);
    expect(result.current.state.audio.enabled).toBe(false);
    await act(() => jest.advanceTimersByTimeAsync(2_000));
    expect(result.current.ready).toBe(false);
    await act(() => jest.advanceTimersByTimeAsync(4_000));
    expect(result.current.ready).toBe(true);
    expect(result.current.state.audio.enabled).toBe(true);
    expect(result.current.tokenError).toBe(false);
  });

  it("re-fetches the persisted scene on every socket (re)connect", async () => {
    respond([{ activeVariable: "temp" }, { activeVariable: "wind" }]);
    const { result } = renderHook(() => useSceneState("default"));
    await flush();
    expect(result.current.state.activeVariable).toBe("temp");
    act(() => socketHandlers.get("connect")?.());
    await flush();
    expect(result.current.state.activeVariable).toBe("wind");
  });

  it("a 401 is final: tokenError, no retry", async () => {
    respond([401, { activeVariable: "temp" }]);
    const { result } = renderHook(() => useSceneState("default", "bad"));
    await flush();
    expect(result.current.tokenError).toBe(true);
    await act(() => jest.advanceTimersByTimeAsync(60_000));
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});
